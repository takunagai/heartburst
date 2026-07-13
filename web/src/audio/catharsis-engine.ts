// CatharsisField ─ Web Audio 音響エンジン（sc/main.scd の写像）
// 対応表: chargeDrone/dropBoom/shockwave/shimmer/popPluck/master → 各セクション
// チューニング値はネイティブ版 sc/main.scd と揃える（変更時は両方更新）

import type { AudioEngine } from "./engine";

// ---- チューニング定数（sc/main.scd 冒頭と対応） ----
const MASTER_VOLUME = 0.9;   // ~masterVolume
const REVERB_MIX = 0.33;     // ~reverbMix
const REVERB_SECONDS = 2.6;  // FreeVerb2 room 0.86 相当の減衰感
const DRONE_LAG = 0.12;      // level 追従の平滑化（SC の .lag(0.12)）

// ペンタトニック（C マイナーペンタ = 0,3,5,7,10）─ sc/main.scd と同一
const PENTA = [0, 3, 5, 7, 10];
const midicps = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const SHIMMER_FREQS = [72, 84].flatMap((b) => PENTA.map((d) => midicps(b + d)));
const POP_FREQS = [60, 72].flatMap((b) => PENTA.map((d) => midicps(b + d)));

const choose = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const linlin = (x: number, a: number, b: number, c: number, d: number) =>
  c + ((Math.min(Math.max(x, a), b) - a) / (b - a)) * (d - c);
const linexp = (x: number, a: number, b: number, c: number, d: number) =>
  c * Math.pow(d / c, (Math.min(Math.max(x, a), b) - a) / (b - a));

// パターン層（Strudel）と共有する連続値
export const controlSignals = { charge: 0, energy: 0 };

export class CatharsisAudioEngine implements AudioEngine {
  private ctx!: AudioContext;
  private fxIn!: GainNode;        // 全音源の合流点（SC の ~fxBus 相当）
  private analyser!: AnalyserNode;
  private analyserBuf!: Float32Array<ArrayBuffer>;
  private noiseBuf!: AudioBuffer; // 使い回すホワイトノイズ
  private tanhCurve!: Float32Array<ArrayBuffer>;

  // chargeDrone のライブノード
  private drone: {
    saws: OscillatorNode[];
    sub: OscillatorNode;
    lpf: BiquadFilterNode;
    vol: GainNode;      // level 追従音量
    beatGain: GainNode; // 心拍振幅（パルスをスケジュール）
    out: GainNode;      // ASR エンベロープ
    beatTimer: number | null;
    level: number;
  } | null = null;

  async start(): Promise<void> {
    if (this.ctx) { await this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    await this.ctx.resume();

    // ---- master: fxIn → [dry, convolver reverb] → limiter → destination ----
    this.fxIn = this.ctx.createGain();
    const dry = this.ctx.createGain();
    dry.gain.value = 1 - REVERB_MIX;
    const wet = this.ctx.createGain();
    wet.gain.value = REVERB_MIX;
    const reverb = this.ctx.createConvolver();
    reverb.buffer = this.buildImpulseResponse(REVERB_SECONDS);

    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    const master = this.ctx.createGain();
    master.gain.value = MASTER_VOLUME;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyserBuf = new Float32Array(this.analyser.fftSize);

    this.fxIn.connect(dry).connect(master);
    this.fxIn.connect(reverb).connect(wet).connect(master);
    master.connect(limiter);
    limiter.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // ---- 使い回し素材 ----
    this.noiseBuf = this.buildNoiseBuffer(2.0);
    this.tanhCurve = this.buildTanhCurve(2048);
    this.buildPluckBank(); // KS プラック 20 音をオフライン合成（数十 ms・ゲート直後なので許容）

    // ---- パターン層（Strudel・オプショナル）─ 失敗しても本体は動く ----
    const { startPatternLayer } = await import("./pattern");
    void startPatternLayer(this.ctx);
  }

  // ============ chargeDrone（\chargeDrone の写像） ============

  chargeStart(_x: number, _y: number): void {
    if (!this.ctx) return;
    this.stopDrone(0.05); // 連打で残っていたら即始末
    const t = this.ctx.currentTime;

    const lpf = this.ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.value = 200;
    lpf.Q.value = 0.7;

    const vol = this.ctx.createGain();
    vol.gain.value = 0.06;
    const beatGain = this.ctx.createGain();
    beatGain.gain.value = 0.3;
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(1.0, t + 1.5); // ASR attack 1.5s

    const mkOsc = (type: OscillatorType, freq: number) => {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.start();
      return o;
    };
    const saws = [mkOsc("sawtooth", 40 * 0.994), mkOsc("sawtooth", 40 * 1.007)];
    const sub = mkOsc("sine", 20);
    const sawMix = this.ctx.createGain();
    sawMix.gain.value = 0.25; // 2 本合算で 0.5 相当
    saws.forEach((o) => o.connect(sawMix));
    const subMix = this.ctx.createGain();
    subMix.gain.value = 0.5;
    sub.connect(subMix);

    sawMix.connect(lpf);
    subMix.connect(lpf);
    lpf.connect(vol).connect(beatGain).connect(out).connect(this.fxIn);

    this.drone = { saws, sub, lpf, vol, beatGain, out, beatTimer: null, level: 0 };
    this.scheduleHeartbeat();
  }

  chargeLevel(level: number): void {
    if (!this.ctx || !this.drone) return;
    const l = Math.min(Math.max(level, 0), 1);
    this.drone.level = l;
    controlSignals.charge = l;

    const t = this.ctx.currentTime;
    const freq = linexp(l, 0, 1, 40, 80);
    const cutoff = linexp(l, 0, 1, 200, 4000);
    const volume = linlin(l, 0, 1, 0.06, 0.6);

    this.drone.saws[0].frequency.setTargetAtTime(freq * 0.994, t, DRONE_LAG);
    this.drone.saws[1].frequency.setTargetAtTime(freq * 1.007, t, DRONE_LAG);
    this.drone.sub.frequency.setTargetAtTime(freq * 0.5, t, DRONE_LAG);
    this.drone.lpf.frequency.setTargetAtTime(cutoff, t, DRONE_LAG);
    this.drone.vol.gain.setTargetAtTime(volume, t, DRONE_LAG);
  }

  // 心拍: level で速度 0.8→3Hz のパルス（SC の Impulse+Decay2 相当を逐次スケジュール）
  private scheduleHeartbeat(): void {
    if (!this.drone) return;
    const d = this.drone;
    const rate = linlin(d.level, 0, 1, 0.8, 3.0);
    const t = this.ctx.currentTime;
    // パルス: 0.3 底上げ + 0.7 の減衰パルス
    d.beatGain.gain.cancelScheduledValues(t);
    d.beatGain.gain.setValueAtTime(1.0, t);
    d.beatGain.gain.setTargetAtTime(0.3, t + 0.02, 0.08);
    d.beatTimer = window.setTimeout(() => this.scheduleHeartbeat(), 1000 / rate);
  }

  private stopDrone(releaseSec: number): void {
    const d = this.drone;
    if (!d) return;
    this.drone = null;
    if (d.beatTimer !== null) clearTimeout(d.beatTimer);
    const t = this.ctx.currentTime;
    d.out.gain.cancelScheduledValues(t);
    d.out.gain.setTargetAtTime(0.0001, t, Math.max(releaseSec, 0.02) / 3);
    const stopAt = t + Math.max(releaseSec, 0.02) * 2 + 0.1;
    [...d.saws, d.sub].forEach((o) => o.stop(stopAt));
  }

  // ============ release（\dropBoom + \shockwave + shimmer 群） ============

  release(level: number, x: number, _y: number): void {
    if (!this.ctx) return;
    const l = Math.min(Math.max(level, 0), 1);
    const pan = (x * 2 - 1);
    controlSignals.charge = 0;
    controlSignals.energy = 1;

    this.stopDrone(1.6); // SC の Env.asr release 1.6s
    this.dropBoom(linlin(l, 0, 1, 0.3, 0.95), pan * 0.3);
    this.shockwave(linlin(l, 0, 1, 0.25, 0.7), pan * 0.5);
    this.shimmerShower(l);
  }

  private dropBoom(amp: number, pan: number): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(60, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.6);

    // tanh ソフトクリップ: drive を前段ゲインで与える（SC: (sig*(1.6+amp*3)).tanh）
    const drive = this.ctx.createGain();
    drive.gain.value = 1.6 + amp * 3;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.tanhCurve;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(amp * 0.9, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 5.0);

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;

    osc.connect(drive).connect(shaper).connect(env).connect(panner).connect(this.fxIn);
    osc.start(t);
    osc.stop(t + 5.2);
  }

  private shockwave(amp: number, pan: number): void {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;

    const bpf = this.ctx.createBiquadFilter();
    bpf.type = "bandpass";
    bpf.Q.value = 1.67; // SC の rq 0.6 相当
    bpf.frequency.setValueAtTime(8000, t);
    bpf.frequency.exponentialRampToValueAtTime(200, t + 0.6);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(amp * 3.0, t + 0.004); // BPF の帯域損失を補償
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;

    src.connect(bpf).connect(env).connect(panner).connect(this.fxIn);
    src.start(t);
    src.stop(t + 0.7);
  }

  // シャワー: 密度 ∝ level から 3 秒で減衰（sc/main.scd の Routine と同ロジック）
  private shimmerShower(level: number): void {
    const total = 3.0;
    const baseDensity = linlin(level, 0, 1, 3, 14);
    let elapsed = 0;
    const tick = () => {
      if (elapsed >= total) return;
      const frac = 1 - elapsed / total;
      const density = Math.max(baseDensity * frac, 0.8);
      const amp = linlin(level, 0, 1, 0.08, 0.22) * Math.max(frac, 0.25);
      this.pluck(choose(SHIMMER_FREQS), amp, Math.random() * 2 - 1, 2.2);
      const wait = 1 / density;
      elapsed += wait;
      window.setTimeout(tick, wait * 1000);
    };
    tick();
  }

  pop(x: number, _y: number): void {
    if (!this.ctx) return;
    this.pluck(choose(POP_FREQS), 0.4, (x * 2 - 1) * 0.6, 0.28);
  }

  // Karplus-Strong プラック（\shimmer / \popPluck の写像）
  //
  // DelayNode のフィードバックループは Web Audio の最小遅延 128 サンプル制約により
  // 約 344Hz 超の音程が作れない（今回のペンタ音列はほぼ全滅）うえ、ループ内
  // BiquadFilter が不安定警告を出す。そこで KS は起動時に JS でオフライン合成し、
  // AudioBuffer バンクとして保持 → 発音は再生のみ（音程正確・再生コスト極小）
  private pluckBank = new Map<string, AudioBuffer>();

  private pluckKey(freq: number, decaySec: number): string {
    return `${freq.toFixed(2)}:${decaySec}`;
  }

  private buildPluckBank(): void {
    for (const f of SHIMMER_FREQS) this.pluckBank.set(this.pluckKey(f, 2.2), this.renderKarplusStrong(f, 2.2));
    for (const f of POP_FREQS) this.pluckBank.set(this.pluckKey(f, 0.28), this.renderKarplusStrong(f, 0.28));
  }

  // 古典 KS: ノイズ 1 周期のリングバッファを「隣接平均 × フィードバック」で巡回
  private renderKarplusStrong(freq: number, decaySec: number): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * (decaySec + 0.3));
    const buf = this.ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    const period = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
    const feedback = Math.pow(0.001, period / sr / decaySec); // decaySec 後 -60dB
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const cur = ring[idx];
      const next = ring[(idx + 1) % period];
      out[i] = cur;
      ring[idx] = feedback * 0.5 * (cur + next); // 平均 = 1 次 LPF（弦の高域減衰）
      idx = (idx + 1) % period;
    }
    return buf;
  }

  private pluck(freq: number, amp: number, pan: number, decaySec: number): void {
    const buf = this.pluckBank.get(this.pluckKey(freq, decaySec));
    if (!buf) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.value = amp;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    src.connect(gain).connect(panner).connect(this.fxIn);
    src.start(t);
  }

  // ============ パターン層向け・視覚フィードバック ============

  setEnergy(energy: number): void {
    controlSignals.energy = Math.min(Math.max(energy, 0), 1);
  }

  getAmp(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.analyserBuf);
    let sum = 0;
    for (let i = 0; i < this.analyserBuf.length; i++) sum += this.analyserBuf[i] ** 2;
    const rms = Math.sqrt(sum / this.analyserBuf.length);
    return Math.min(rms * 2.5, 1); // /sc/amp と同レンジ感に正規化
  }

  // ============ 素材生成 ============

  private buildNoiseBuffer(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    return buf;
  }

  // 生成 IR: 指数減衰するデコリレートしたステレオノイズ（外部ファイル不要のリバーブ）
  private buildImpulseResponse(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
      }
    }
    return buf;
  }

  private buildTanhCurve(n: number): Float32Array<ArrayBuffer> {
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 8 - 4; // -4..4
      curve[i] = Math.tanh(x);
    }
    return curve;
  }
}
