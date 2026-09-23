// CatharsisField ─ Web Audio 音響エンジン
//
// 元は sc/main.scd の写像（chargeDrone/dropBoom/shockwave/shimmer/popPluck/master）。
// Phase 9-1 でウェブ版独自に拡張した（ネイティブ版は旧仕様のまま）:
//   - ビルドアップ: 溜め中のノイズライザー + 拍に揃った加速スネアロール
//   - 解放前の無音: 着弾まで全体（Strudel 層を含む）をダッキング
//   - 着弾の量子化: 強い解放は Strudel の次の 16 分へ揃える
//   - 着弾音の多層化: 小型スピーカーでも聞こえる帯域（クリック・胴・倍音）を重ねる
//   - ドロップ区間: 着弾後 1〜2 小節、拍に揃ったキック + ベース + Strudel 層のポンピング
// Phase 9-2:
//   - 段階チャージの和音、オーバーチャージの Shepard トーン + 放電ノイズ
//   - 心拍の位相の公開（クリティカル判定用）、爆発の種類別レイヤー（金の鐘 / 暴発のクラッシュ）

import type { AudioEngine, BurstStyle, ReleaseParams, ReleaseTiming } from "./engine";
import type { StrudelClock } from "./pattern";

// ---- チューニング定数 ----
const MASTER_VOLUME = 0.9;   // ~masterVolume
const REVERB_MIX = 0.33;     // ~reverbMix
const REVERB_SECONDS = 2.6;  // FreeVerb2 room 0.86 相当の減衰感
const DRONE_LAG = 0.12;      // level 追従の平滑化（SC の .lag(0.12)）

const FALLBACK_CPS = 100 / 60 / 4; // Strudel 層が無いときの自前クロック（pattern.ts の setcps と同値）
const INHALE_SEC_MIN = 0.04;   // level=0 の解放 → 着弾の最短待ち（吸い込み演出の長さ）
const INHALE_SEC_MAX = 0.14;   // level=1 の最短待ち。これに量子化待ち（最大 16 分 1 つ）が加わる
const QUANTIZE_MIN_LEVEL = 0.35; // これ以上の解放だけ量子化 + ドロップ区間を付ける
const DROP_LONG_LEVEL = 0.7;   // これ以上はドロップ 2 小節（未満は 1 小節）
const CHARGE_CUT_SEC = 0.025;  // 解放時に溜め音を切る速さ

const ROLL_LOOKAHEAD_SEC = 0.12; // スネアロールの先読みスケジュール幅
const ROLL_TIMER_MS = 25;

const SHEPARD_VOICES = 7;        // オクターブ間隔の正弦波の本数
const SHEPARD_BASE_HZ = 40;      // 最低声部の基準周波数
const SHEPARD_CENTER_OCT = 3.6;  // 音量ピークの位置（基準からのオクターブ数 ≒ 480Hz）
const SHEPARD_SIGMA_OCT = 1.3;   // 音量の山の幅

// ペンタトニック（C マイナーペンタ = 0,3,5,7,10）─ sc/main.scd と同一
const PENTA = [0, 3, 5, 7, 10];
const midicps = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const SHIMMER_FREQS = [72, 84].flatMap((b) => PENTA.map((d) => midicps(b + d)));
const POP_FREQS = [60, 72].flatMap((b) => PENTA.map((d) => midicps(b + d)));
const DROP_BASS_STEPS = [0, 0, 12, 0, 3, 0, -2, -5]; // 8 分ごとの C2 からの半音差（裏拍で鳴らす）
// 段階チャージの和音（SHIMMER_FREQS のバンク内の音。段階ごとに 1 段上へ）
const TIER_CHORDS = [
  [72, 75, 79],
  [75, 79, 82],
  [79, 84, 87, 91],
].map((chord) => chord.map(midicps));

const choose = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const linlin = (x: number, a: number, b: number, c: number, d: number) =>
  c + ((Math.min(Math.max(x, a), b) - a) / (b - a)) * (d - c);
const linexp = (x: number, a: number, b: number, c: number, d: number) =>
  c * Math.pow(d / c, (Math.min(Math.max(x, a), b) - a) / (b - a));

// パターン層（Strudel）と共有する連続値
export const controlSignals = { charge: 0, energy: 0 };

export class CatharsisAudioEngine implements AudioEngine {
  private ctx!: AudioContext;
  private fxIn!: GainNode;        // 残響ありの合流点（SC の ~fxBus 相当）
  private dryIn!: GainNode;       // 残響なしの合流点（低域の濁り回避。着弾の胴・ドロップ）
  private strudelPump!: GainNode; // Strudel 層の入口。キックに合わせてポンピング
  private duck!: GainNode;        // 全体ダッキング（解放 → 着弾の無音）
  private analyser!: AnalyserNode;
  private analyserBuf!: Float32Array<ArrayBuffer>;
  private noiseBuf!: AudioBuffer; // 使い回すホワイトノイズ
  private tanhCurve!: Float32Array<ArrayBuffer>;
  private exciterCurve!: Float32Array<ArrayBuffer>; // 非対称の歪み（偶数倍音 ─ 小型スピーカーで低音を「聞かせる」）

  private clock: StrudelClock | null = null;
  private fallbackOrigin = 0;

  // 溜め中のライブノード（ドローン + ライザー + スネアロール）
  private drone: {
    saws: OscillatorNode[];
    sub: OscillatorNode;
    lpf: BiquadFilterNode;
    vol: GainNode;      // level 追従音量
    beatGain: GainNode; // 心拍振幅（パルスをスケジュール）
    out: GainNode;      // ASR エンベロープ（ドローン・ライザー・ロールの合流点）
    riser: AudioBufferSourceNode;
    riserBpf: BiquadFilterNode;
    riserGain: GainNode;
    beatTimer: number | null;
    rollTimer: number | null;
    nextRollTime: number;
    level: number;
    lastBeatAt: number;   // 直近の心拍の時刻（ctx 時間）
    beatInterval: number; // その時点の心拍間隔（秒）
    shepard: {
      oscs: OscillatorNode[];
      gains: GainNode[];
      mix: GainNode;
      phase: number;      // 0..1（1 オクターブ分の上昇位置）
      lastUpdate: number;
    } | null;
  } | null = null;

  private dropBus: GainNode | null = null; // 進行中のドロップ区間（次の溜めで止める）

  async start(): Promise<void> {
    if (this.ctx) { await this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    await this.ctx.resume();
    this.fallbackOrigin = this.ctx.currentTime;

    // ---- master: [fxIn → dry/reverb] + dryIn + strudelPump → master → duck → limiter → destination ----
    this.fxIn = this.ctx.createGain();
    this.dryIn = this.ctx.createGain();
    this.strudelPump = this.ctx.createGain();
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
    this.duck = this.ctx.createGain();

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyserBuf = new Float32Array(this.analyser.fftSize);

    this.fxIn.connect(dry).connect(master);
    this.fxIn.connect(reverb).connect(wet).connect(master);
    this.dryIn.connect(master);
    this.strudelPump.connect(master);
    master.connect(this.duck).connect(limiter);
    limiter.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // ---- 使い回し素材 ----
    this.noiseBuf = this.buildNoiseBuffer(2.0);
    this.tanhCurve = this.buildCurve(2048, (x) => Math.tanh(x));
    this.exciterCurve = this.buildCurve(2048, (x) => Math.tanh(x + 0.6) - Math.tanh(0.6));
    this.buildPluckBank(); // KS プラック 20 音をオフライン合成（数十 ms・ゲート直後なので許容）

    // ---- パターン層（Strudel・オプショナル）─ 失敗しても本体は動く ----
    const { startPatternLayer } = await import("./pattern");
    void startPatternLayer(this.ctx, this.strudelPump).then((clock) => {
      this.clock = clock;
    });
  }

  // ============ 拍グリッド（Strudel スケジューラと同じ時間軸） ============

  // Strudel が動いていればその換算式、無ければ自前クロック。1 cycle = 1 小節（4 拍）
  private gridParams(): { cps: number; n0: number; s0: number } {
    const c = this.clock;
    if (c && c.started && typeof c.seconds_at_cps_change === "number" && c.cps > 0) {
      return { cps: c.cps, n0: c.num_cycles_at_cps_change, s0: c.seconds_at_cps_change + (c.latency ?? 0) };
    }
    return { cps: FALLBACK_CPS, n0: 0, s0: this.fallbackOrigin };
  }

  // time 以降で最初の「1 小節を division 等分した拍」の時刻
  private nextGridTime(time: number, division: number): number {
    const { cps, n0, s0 } = this.gridParams();
    const cycle = (time - s0) * cps + n0;
    const snapped = Math.ceil(cycle * division - 1e-6) / division;
    return (snapped - n0) / cps + s0;
  }

  // [from, to) の division 分割グリッド時刻と、そのグリッド番号（小節内の位置判定用）
  private gridTimes(from: number, to: number, division: number): { time: number; index: number }[] {
    const { cps, n0, s0 } = this.gridParams();
    const out: { time: number; index: number }[] = [];
    let step = Math.ceil(((from - s0) * cps + n0) * division - 1e-6);
    for (;;) {
      const time = (step / division - n0) / cps + s0;
      if (time >= to) break;
      out.push({ time, index: step });
      step++;
    }
    return out;
  }

  private barSeconds(): number {
    return 1 / this.gridParams().cps;
  }

  // ============ 溜め（\chargeDrone の写像 + ライザー + スネアロール） ============

  chargeStart(_x: number, _y: number): void {
    if (!this.ctx) return;
    this.stopDrone(0.05); // 連打で残っていたら即始末
    this.stopDrop(0.35);  // 前回のドロップ区間は溜め直しで退場させる
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

    // ライザー: ループするノイズを帯域通過。中心周波数と音量が level で上がる
    const riser = this.ctx.createBufferSource();
    riser.buffer = this.noiseBuf;
    riser.loop = true;
    const riserBpf = this.ctx.createBiquadFilter();
    riserBpf.type = "bandpass";
    riserBpf.frequency.value = 400;
    riserBpf.Q.value = 2;
    const riserGain = this.ctx.createGain();
    riserGain.gain.value = 0;
    riser.connect(riserBpf).connect(riserGain).connect(out);
    riser.start(t);

    this.drone = {
      saws, sub, lpf, vol, beatGain, out, riser, riserBpf, riserGain,
      beatTimer: null, rollTimer: null, nextRollTime: t, level: 0,
      lastBeatAt: t, beatInterval: 1 / 0.8, shepard: null,
    };
    this.scheduleHeartbeat();
    this.drone.rollTimer = window.setInterval(() => this.scheduleRoll(), ROLL_TIMER_MS);
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

    this.drone.riserBpf.frequency.setTargetAtTime(linexp(l, 0, 1, 400, 9000), t, DRONE_LAG);
    this.drone.riserBpf.Q.setTargetAtTime(linlin(l, 0, 1, 2, 7), t, DRONE_LAG);
    // 満充填時に着弾と同じ音量まで上がると落差が消えるため、ライザーは控えめに（9-1 の実測: 満充填で振幅 0.99）
    this.drone.riserGain.gain.setTargetAtTime(0.14 * l * l, t, DRONE_LAG);
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
    d.lastBeatAt = t;
    d.beatInterval = 1 / rate;
    d.beatTimer = window.setTimeout(() => this.scheduleHeartbeat(), 1000 / rate);
  }

  // スネアロール: 拍に揃えて先読みスケジュール。level で 4 分 → 8 分 → 16 分 → 32 分と細かくなる（EDM のビルドアップ）
  private scheduleRoll(): void {
    const d = this.drone;
    if (!d) return;
    const now = this.ctx.currentTime;
    if (d.level < 0.12) {
      d.nextRollTime = now;
      return;
    }
    const division = d.level < 0.35 ? 4 : d.level < 0.6 ? 8 : d.level < 0.85 ? 16 : 32;
    const horizon = now + ROLL_LOOKAHEAD_SEC;
    let t = this.nextGridTime(Math.max(d.nextRollTime, now + 0.005), division);
    while (t < horizon) {
      this.rollHit(t, d.level, d.out);
      t = this.nextGridTime(t + 0.001, division);
    }
    d.nextRollTime = t;
  }

  private rollHit(t: number, level: number, dest: AudioNode): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bpf = this.ctx.createBiquadFilter();
    bpf.type = "bandpass";
    bpf.frequency.value = linexp(level, 0, 1, 1200, 3400);
    bpf.Q.value = 1.1;
    const env = this.ctx.createGain();
    const amp = 0.05 + 0.3 * Math.pow(level, 1.6);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(amp, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
    src.connect(bpf).connect(env).connect(dest);
    const offset = Math.random() * 1.5; // ノイズバッファの読み出し位置をずらして毎打の質感を変える
    src.start(t, offset);
    src.stop(t + 0.09);
  }

  private stopDrone(releaseSec: number): void {
    const d = this.drone;
    if (!d) return;
    this.drone = null;
    if (d.beatTimer !== null) clearTimeout(d.beatTimer);
    if (d.rollTimer !== null) clearInterval(d.rollTimer);
    const t = this.ctx.currentTime;
    d.out.gain.cancelScheduledValues(t);
    d.out.gain.setValueAtTime(d.out.gain.value, t);
    d.out.gain.setTargetAtTime(0.0001, t, Math.max(releaseSec, 0.02) / 3);
    const stopAt = t + Math.max(releaseSec, 0.02) * 2 + 0.1;
    [...d.saws, d.sub].forEach((o) => o.stop(stopAt));
    d.riser.stop(stopAt);
    d.shepard?.oscs.forEach((o) => o.stop(stopAt));
  }

  getHeartbeatPhase(): number {
    const d = this.drone;
    if (!this.ctx || !d) return 1;
    return Math.min(Math.max((this.ctx.currentTime - d.lastBeatAt) / d.beatInterval, 0), 1);
  }

  // 段階チャージ: 閾値を越えるたびに 1 段高い和音 + 低い一撃
  tierUp(tier: number): void {
    if (!this.ctx) return;
    const chord = TIER_CHORDS[Math.min(Math.max(tier, 1), TIER_CHORDS.length) - 1];
    chord.forEach((freq, i) => {
      this.pluck(freq, 0.18 + tier * 0.03, (i / (chord.length - 1)) * 1.2 - 0.6, 2.2, this.ctx.currentTime + i * 0.025);
    });
    const t = this.ctx.currentTime;
    this.kick(t, 0.22 + tier * 0.08, this.dryIn);
    this.noiseHit(t, "highpass", 6000, 0.7, 0.12 + tier * 0.04, 0.35, this.fxIn);
  }

  // オーバーチャージ: 終わりなく昇り続けて聞こえる Shepard トーン（緊張の上限を外す）+ 放電ノイズ
  overcharge(amount: number): void {
    const d = this.drone;
    if (!this.ctx || !d) return;
    const o = Math.min(Math.max(amount, 0), 1);
    const t = this.ctx.currentTime;
    if (o <= 0) {
      if (d.shepard) d.shepard.mix.gain.setTargetAtTime(0, t, 0.05);
      return;
    }
    if (!d.shepard) d.shepard = this.createShepard(d.out, t);
    const s = d.shepard;
    const dt = Math.max(t - s.lastUpdate, 0);
    s.lastUpdate = t;
    s.phase = (s.phase + dt * (0.25 + 0.9 * o)) % 1; // 上昇速度も加速
    for (let i = 0; i < SHEPARD_VOICES; i++) {
      const octave = i + s.phase;
      const weight = Math.exp(-0.5 * ((octave - SHEPARD_CENTER_OCT) / SHEPARD_SIGMA_OCT) ** 2);
      s.oscs[i].frequency.setTargetAtTime(SHEPARD_BASE_HZ * Math.pow(2, octave), t, 0.02);
      s.gains[i].gain.setTargetAtTime(weight, t, 0.03);
    }
    s.mix.gain.setTargetAtTime(0.09 + 0.1 * o, t, 0.08);
    // 放電のパチパチ（確率は満了に近づくほど上がる）
    if (Math.random() < 0.08 + 0.45 * o) {
      this.noiseHit(t, "highpass", 3500 + Math.random() * 4000, 0.8, 0.05 + 0.12 * o, 0.015 + Math.random() * 0.03, d.out);
    }
  }

  private createShepard(dest: AudioNode, t: number): NonNullable<NonNullable<typeof this.drone>["shepard"]> {
    const mix = this.ctx.createGain();
    mix.gain.value = 0;
    mix.connect(dest);
    const oscs: OscillatorNode[] = [];
    const gains: GainNode[] = [];
    for (let i = 0; i < SHEPARD_VOICES; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = SHEPARD_BASE_HZ * Math.pow(2, i);
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(mix);
      osc.start(t);
      oscs.push(osc);
      gains.push(gain);
    }
    return { oscs, gains, mix, phase: 0, lastUpdate: t };
  }

  private stopDrop(releaseSec: number): void {
    const bus = this.dropBus;
    if (!bus) return;
    this.dropBus = null;
    const t = this.ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.setTargetAtTime(0, t, releaseSec / 3);
    this.strudelPump.gain.cancelScheduledValues(t);
    this.strudelPump.gain.setTargetAtTime(1, t, 0.05);
    window.setTimeout(() => bus.disconnect(), (releaseSec * 3 + 0.2) * 1000);
  }

  // ============ 解放 ============
  //
  // 1. 溜め音を即カット + 全体をダッキング（無音の間）
  // 2. 着弾時刻を決める: 吸い込みの最短待ち → 強い解放は次の 16 分へ量子化
  // 3. 着弾時刻に着弾音・衝撃音・シャワー・ドロップ区間を予約し、ダッキングを戻す
  release(params: ReleaseParams): ReleaseTiming {
    if (!this.ctx) return { impactDelaySec: INHALE_SEC_MIN, dropSec: 0 };
    const l = Math.min(Math.max(params.level, 0), 1);
    const power = Math.max(params.power, l);
    // 弾き方向があれば定位もそちらへ寄せる
    const pan = Math.min(Math.max(params.x * 2 - 1 + params.directionX * params.directionAmount * 0.6, -1), 1);
    const now = this.ctx.currentTime;
    controlSignals.charge = 0;
    controlSignals.energy = 1;

    this.stopDrone(CHARGE_CUT_SEC);

    const isBig = l >= QUANTIZE_MIN_LEVEL;
    let impact = now + linlin(l, 0, 1, INHALE_SEC_MIN, INHALE_SEC_MAX);
    if (isBig) impact = this.nextGridTime(impact, 16);

    // 無音の間（着弾の直前まで）。弱い解放は間が短すぎて聞き分けられないので掛けない
    const g = this.duck.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if (isBig) {
      g.linearRampToValueAtTime(0, now + 0.02);
      g.setValueAtTime(0, impact - 0.003);
    }
    g.linearRampToValueAtTime(1, impact);

    // 威力 1 超過ぶん（オーバーチャージ・クリティカル）は音量でなく層の追加で表す（リミッターで潰れるため）
    this.impactHit(linlin(power, 0, 1, 0.3, 0.95), pan * 0.3, impact);
    this.shockwave(linlin(power, 0, 1, 0.25, 0.7), pan * 0.5, impact);
    if (params.style === "critical") this.criticalBell(impact, pan);
    if (params.style === "overload") this.overloadCrash(impact, pan);
    window.setTimeout(() => this.shimmerShower(Math.min(power, 1.3)), (impact - now) * 1000);

    let dropSec = 0;
    if (isBig) {
      dropSec = this.barSeconds() * (l >= DROP_LONG_LEVEL || params.style !== "normal" ? 2 : 1);
      this.dropSection(impact, dropSec, l);
    }

    const outputLatency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return { impactDelaySec: impact - now + outputLatency, dropSec };
  }

  // 着弾音: 帯域ごとに層を分け、小型スピーカー（〜150Hz 以下がほぼ出ない）でも重さが伝わるようにする
  //   sub     : 150→48→32Hz のピッチ降下 sine を tanh で歪ませる（ヘッドホン・大型スピーカー向けの本体）
  //   exciter : 同じ sine を非対称に歪ませ 110Hz 以上だけ通す（倍音で低音を「感じさせる」）
  //   body    : 220→110Hz の三角波（胴鳴り）
  //   click   : 2kHz 以上のノイズ 20ms（アタックの輪郭 ─ スマホで一番効く）
  //   crack   : 1.8kHz 帯域のノイズ（破裂感。残響へ送る）
  //   tail    : 旧 dropBoom の長い 60→28Hz（余韻）
  private impactHit(amp: number, pan: number, t: number): void {
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.dryIn);

    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.18);
    osc.frequency.exponentialRampToValueAtTime(32, t + 1.6);
    osc.start(t);
    osc.stop(t + 2.8);

    const drive = this.ctx.createGain();
    drive.gain.value = 1.8 + amp * 3;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.tanhCurve;
    const subEnv = this.envelope(t, amp * 0.85, 0.003, 2.6);
    osc.connect(drive).connect(shaper).connect(subEnv).connect(panner);

    const exDrive = this.ctx.createGain();
    exDrive.gain.value = 3 + amp * 3;
    const exShaper = this.ctx.createWaveShaper();
    exShaper.curve = this.exciterCurve;
    const exHpf = this.ctx.createBiquadFilter();
    exHpf.type = "highpass";
    exHpf.frequency.value = 110;
    const exEnv = this.envelope(t, amp * 0.45, 0.003, 0.9);
    osc.connect(exDrive).connect(exShaper).connect(exHpf).connect(exEnv).connect(panner);

    const body = this.ctx.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(220, t);
    body.frequency.exponentialRampToValueAtTime(110, t + 0.12);
    body.start(t);
    body.stop(t + 0.3);
    body.connect(this.envelope(t, amp * 0.5, 0.002, 0.22)).connect(panner);

    this.noiseHit(t, "highpass", 2000, 0.7, amp * 0.8, 0.02, panner);
    this.noiseHit(t, "bandpass", 1800, 0.9, amp * 1.4, 0.28, this.fxIn);

    // 余韻（旧 dropBoom。音量は控えめにして sub と住み分ける）
    const tail = this.ctx.createOscillator();
    tail.type = "sine";
    tail.frequency.setValueAtTime(60, t);
    tail.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    tail.start(t);
    tail.stop(t + 5.2);
    tail.connect(this.envelope(t + 0.05, amp * 0.4, 0.05, 5.0)).connect(this.fxIn);
  }

  // クリティカル: 金属的な鐘（非整数倍音の正弦波）+ 高域のきらめき
  private criticalBell(t: number, pan: number): void {
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan * 0.5;
    panner.connect(this.fxIn);
    const base = midicps(84); // C6
    [1, 2.76, 5.4, 8.93].forEach((ratio, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = base * ratio;
      osc.start(t);
      osc.stop(t + 3.2);
      osc.connect(this.envelope(t, 0.2 / (i + 1), 0.002, 2.8 / (1 + i * 0.6))).connect(panner);
    });
    [96, 99, 103].forEach((m, i) => this.pluck(midicps(m - 12), 0.14, (i - 1) * 0.7, 2.2, t + 0.06 + i * 0.05));
  }

  // 暴発: 長いクラッシュ + 追加の超低域 + 歪んだ下降音（制御を失った感じ）
  private overloadCrash(t: number, pan: number): void {
    this.noiseHit(t, "highpass", 4500, 0.6, 0.55, 2.6, this.fxIn);
    this.noiseHit(t + 0.01, "bandpass", 700, 0.5, 0.5, 0.9, this.fxIn);
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 1.4);
    osc.start(t);
    osc.stop(t + 1.6);
    const lpf = this.ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.setValueAtTime(3000, t);
    lpf.frequency.exponentialRampToValueAtTime(200, t + 1.4);
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    osc.connect(lpf).connect(this.envelope(t, 0.28, 0.003, 1.4)).connect(panner).connect(this.dryIn);
  }

  private shockwave(amp: number, pan: number, t: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;

    const bpf = this.ctx.createBiquadFilter();
    bpf.type = "bandpass";
    bpf.Q.value = 1.67; // SC の rq 0.6 相当
    bpf.frequency.setValueAtTime(8000, t);
    bpf.frequency.exponentialRampToValueAtTime(200, t + 0.6);

    const env = this.envelope(t, amp * 3.0, 0.004, 0.6); // BPF の帯域損失を補償

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;

    src.connect(bpf).connect(env).connect(panner).connect(this.fxIn);
    src.start(t);
    src.stop(t + 0.7);
  }

  // ドロップ区間: 着弾を 1 拍目とみなし、以後の 4 分にキック、裏の 8 分にベース。
  // キックごとに Strudel 層を沈めてポンピング（サイドチェイン風）させる
  private dropSection(impact: number, lengthSec: number, level: number): void {
    const bus = this.ctx.createGain();
    bus.connect(this.dryIn);
    this.dropBus = bus;
    const end = impact + lengthSec;
    const kickAmp = linlin(level, 0, 1, 0.45, 0.7);

    const pump = this.strudelPump.gain;
    pump.cancelScheduledValues(impact);
    this.pumpAt(impact, 0.2);

    for (const { time } of this.gridTimes(impact + 0.05, end, 4)) {
      this.kick(time, kickAmp, bus);
      this.pumpAt(time, 0.35);
    }
    for (const { time, index } of this.gridTimes(impact + 0.02, end, 8)) {
      if (index % 2 === 0) continue; // 裏拍だけ
      const step = DROP_BASS_STEPS[Math.floor(index / 2) % DROP_BASS_STEPS.length];
      this.bassNote(time, midicps(36 + step), linlin(level, 0, 1, 0.14, 0.24), bus);
    }
    // 区間の最後は 1 小節の半分で自然に抜ける（次の溜めが来なければ Strudel 層の余韻へ）
    bus.gain.setValueAtTime(1, end - 0.05);
    bus.gain.linearRampToValueAtTime(0.0001, end + 0.4);
  }

  private pumpAt(t: number, depth: number): void {
    const pump = this.strudelPump.gain;
    pump.setValueAtTime(depth, t);
    pump.setTargetAtTime(1, t + 0.03, 0.09);
  }

  private kick(t: number, amp: number, dest: AudioNode): void {
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.11);
    osc.start(t);
    osc.stop(t + 0.5);
    const drive = this.ctx.createGain();
    drive.gain.value = 2.2;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.tanhCurve;
    osc.connect(drive).connect(shaper).connect(this.envelope(t, amp, 0.002, 0.42)).connect(dest);

    const exDrive = this.ctx.createGain();
    exDrive.gain.value = 3;
    const exShaper = this.ctx.createWaveShaper();
    exShaper.curve = this.exciterCurve;
    const exHpf = this.ctx.createBiquadFilter();
    exHpf.type = "highpass";
    exHpf.frequency.value = 120;
    osc.connect(exDrive).connect(exShaper).connect(exHpf).connect(this.envelope(t, amp * 0.35, 0.002, 0.2)).connect(dest);

    this.noiseHit(t, "highpass", 2500, 0.7, amp * 0.35, 0.012, dest);
  }

  private bassNote(t: number, freq: number, amp: number, dest: AudioNode): void {
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    osc.start(t);
    osc.stop(t + 0.3);
    const lpf = this.ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.Q.value = 4;
    lpf.frequency.setValueAtTime(1600, t);
    lpf.frequency.exponentialRampToValueAtTime(220, t + 0.2);
    osc.connect(lpf).connect(this.envelope(t, amp, 0.004, 0.24)).connect(dest);
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

  // 二次爆発: パチパチと弾けるノイズの粒 + 高いきらめき。種類で音色を変える
  sparkBurst(x: number, intensity: number, style: BurstStyle): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const pan = Math.min(Math.max(x * 2 - 1, -1), 1);
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.fxIn);
    const grains = 5 + Math.floor(intensity * 6);
    for (let i = 0; i < grains; i++) {
      const when = t + Math.random() * 0.14;
      this.noiseHit(when, "highpass", 3000 + Math.random() * 5000, 0.8, 0.06 + 0.1 * intensity, 0.01 + Math.random() * 0.025, panner);
    }
    if (style === "overload") {
      this.noiseHit(t, "bandpass", 900, 0.7, 0.25 * intensity, 0.18, panner);
      this.kick(t, 0.18 * intensity, this.dryIn);
    } else {
      const upper = SHIMMER_FREQS.slice(SHIMMER_FREQS.length / 2);
      this.pluck(choose(upper), (style === "critical" ? 0.16 : 0.1) * intensity, pan, 2.2, t + 0.01);
      if (style === "critical") this.pluck(choose(upper), 0.1 * intensity, -pan, 2.2, t + 0.07);
    }
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

  private pluck(freq: number, amp: number, pan: number, decaySec: number, when?: number): void {
    const buf = this.pluckBank.get(this.pluckKey(freq, decaySec));
    if (!buf) return;
    const t = when ?? this.ctx.currentTime;
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

  // ============ 部品 ============

  // 指数エンベロープ（t で立ち上がり attack 秒でピーク、release 秒で -80dB）
  private envelope(t: number, peak: number, attack: number, release: number): GainNode {
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    return env;
  }

  private noiseHit(
    t: number, type: BiquadFilterType, freq: number, q: number, amp: number, decay: number, dest: AudioNode,
  ): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    src.connect(filter).connect(this.envelope(t, amp, 0.001, decay)).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + decay + 0.05);
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

  // 入力 -4..4 を写像する WaveShaper カーブ
  private buildCurve(n: number, fn: (x: number) => number): Float32Array<ArrayBuffer> {
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      curve[i] = fn((i / (n - 1)) * 8 - 4);
    }
    return curve;
  }
}
