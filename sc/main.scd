// CatharsisField ─ SuperCollider 音響エンジン（Tier 1 コア + Tier 2 SuperDirt）
// 設計正本: docs/architecture.md
// 起動: sclang sc/main.scd（IDE 不要・headless 動作）
// 受信 OSC :57120（sclang 既定 langPort） / 送信 OSC :12000（Processing へ /sc/amp）

// ─────────────────────────────────────────────
// チューニング定数（上部集約 ─ ここだけ触れば全体の質感を調整できる）
// ─────────────────────────────────────────────
~masterVolume  = 0.9;    // マスター音量（Limiter 前段）
~reverbMix     = 0.33;   // リバーブのドライ/ウェット（0=ドライ 1=ウェット）
~reverbRoom    = 0.86;   // 残響の広さ
~reverbDamp    = 0.25;   // 残響の高域減衰
~ampSendRate   = 30;     // /sc/amp 送出レート（Hz）
// ポート契約の正本は docs/architecture.md（変更時はそちらを先に更新）
~processingPort = 12000; // Processing の受信ポート
~superDirtPort  = 57120; // SuperDirt が Tidal からの dirt メッセージを受けるポート（sclang langPort と同一）

s = Server.default;
s.options.numBuffers = 1024 * 16;  // Pluck/SuperDirt 用に多めに確保
s.options.memSize    = 1024 * 64;  // リアルタイムメモリ（KB）
s.options.numInputBusChannels = 0; // 出力専用アプリ。入力を開かず、入出力デバイスのサンプルレート不一致を回避

s.waitForBoot {
	var superDirtClass;

	// ── バス確保 ──
	~fxBus    = Bus.audio(s, 2);    // 全音源を集約する共有 FX（リバーブ）バス
	~levelBus = Bus.control(s, 1);  // /charge/level を書き込む溜めレベル（0..1）
	~levelBus.set(0);

	// ── Processing への送信先 ──
	~processingAddr = NetAddr("127.0.0.1", ~processingPort);

	// ── OSC の正規化 x（0..1、欠損時 0.5）を pan（-1..1）へ写す共通ヘルパ ──
	~xToPan = { |x| ((x ? 0.5) * 2) - 1 };

	// ── ペンタトニック音列（C マイナーペンタ = 度数 0,3,5,7,10）──
	~pentaDegrees = [0, 3, 5, 7, 10];
	~shimmerFreqs = [72, 84].collect({ |b| ~pentaDegrees + b }).flatten.midicps; // 高域シャワー
	~popFreqs     = [60, 72].collect({ |b| ~pentaDegrees + b }).flatten.midicps; // 中域クリック

	// ═══════════ SynthDef 群 ═══════════

	// 溜めドローン: デチューン鋸波2基+サブサイン。level で基音/LPF/音量/心拍速度が追従
	SynthDef(\chargeDrone, { |out, levelBus, gate = 1|
		var level  = In.kr(levelBus, 1).lag(0.12);
		var freq   = level.linexp(0, 1, 40, 80);            // 基音 40→80Hz
		var cutoff = level.linexp(0, 1, 200, 4000);         // LPF 200→4000Hz
		var saws   = Mix(Saw.ar([freq * 0.994, freq * 1.007])) * 0.5;
		var sub    = SinOsc.ar(freq * 0.5) * 0.5;
		var beat   = level.linlin(0, 1, 0.8, 3.0);          // 心拍速度 0.8→3Hz
		var pulse  = Decay2.kr(Impulse.kr(beat), 0.02, 0.16);
		var heart  = (pulse * 0.7) + 0.3;                   // 0.3..1.0 の心拍様振幅 LFO
		var vol    = level.linlin(0, 1, 0.06, 0.6);         // 音量も level 追従
		var env    = EnvGen.kr(Env.asr(1.5, 1, 1.6), gate, doneAction: 2);
		var sig    = LPF.ar(saws + sub, cutoff) * heart * vol * env;
		Out.ar(out, sig ! 2);
	}).add;

	// サブベース・ドロップ: 60→28Hz ピッチエンベロープ、~5s 減衰、tanh で太らせる
	SynthDef(\dropBoom, { |out, amp = 0.8, pan = 0|
		var pitch = EnvGen.kr(Env([60, 28], [0.6], \exp));
		var aenv  = EnvGen.kr(Env.perc(0.004, 5.0, curve: -4.5), doneAction: 2);
		var sig   = SinOsc.ar(pitch);
		sig = (sig * (1.6 + (amp * 3))).tanh;               // ソフトクリップで倍音付与・肉厚化
		sig = sig * aenv * amp * 0.9;
		Out.ar(out, Pan2.ar(sig, pan));
	}).add;

	// 衝撃波: WhiteNoise を BPF で 8kHz→200Hz スイープ、0.6s。空気の壁感
	SynthDef(\shockwave, { |out, amp = 0.6, pan = 0|
		var sweep = EnvGen.kr(Env([8000, 200], [0.6], \exp));
		var aenv  = EnvGen.kr(Env.perc(0.004, 0.6, curve: -3), doneAction: 2);
		var sig   = BPF.ar(WhiteNoise.ar, sweep, 0.6) * 3.0; // BPF の帯域損失を補償
		sig = sig * aenv * amp;
		Out.ar(out, Pan2.ar(sig, pan));
	}).add;

	// シャワー: ペンタトニックのプラック単発（Karplus-Strong）。/release で群として撒く
	SynthDef(\shimmer, { |out, freq = 440, amp = 0.2, pan = 0|
		var env = EnvGen.kr(Env.perc(0.001, 2.2, curve: -3.5), doneAction: 2);
		var sig = Pluck.ar(WhiteNoise.ar, Impulse.kr(0), freq.reciprocal, freq.reciprocal, 3.0, 0.5);
		sig = sig * env * amp;
		Out.ar(out, Pan2.ar(sig, pan));
	}).add;

	// ポップ: 短クリック用の軽いプラック単発（連打の小気味よい破裂）
	SynthDef(\popPluck, { |out, freq = 440, amp = 0.4, pan = 0|
		var env = EnvGen.kr(Env.perc(0.001, 0.28, curve: -4), doneAction: 2);
		var sig = Pluck.ar(WhiteNoise.ar, Impulse.kr(0), freq.reciprocal, freq.reciprocal, 0.45, 0.42);
		sig = sig * env * amp;
		Out.ar(out, Pan2.ar(sig, pan));
	}).add;

	// マスター: FX バス集約 → FreeVerb2 → Limiter → Out(0)。振幅を SendReply で 30Hz 送出
	SynthDef(\master, { |in, out = 0, mix = 0.33, room = 0.86, damp = 0.25, amp = 0.9, sendRate = 30|
		var sig = In.ar(in, 2);
		sig = FreeVerb2.ar(sig[0], sig[1], mix: mix, room: room, damp: damp);
		sig = Limiter.ar(sig * amp, 0.95);
		SendReply.kr(Impulse.kr(sendRate), '/sc/ampReply', Amplitude.kr(sig.sum * 0.5, 0.01, 0.2));
		Out.ar(out, sig);
	}).add;

	s.sync;  // 全 SynthDef の登録完了を待つ

	// ── ノードツリー: 音源グループの後段にマスターを置き実行順を保証 ──
	~srcGroup = Group.new(s);
	~fxGroup  = Group.after(~srcGroup);
	~master   = Synth(\master, [\in, ~fxBus, \out, 0,
		\mix, ~reverbMix, \room, ~reverbRoom, \damp, ~reverbDamp,
		\amp, ~masterVolume, \sendRate, ~ampSendRate], ~fxGroup);

	// ═══════════ OSCdef 群（受信 :57120）═══════════

	// /charge/start x y : 溜めドローンを低音量から起動
	OSCdef(\chargeStart, { |msg|
		~levelBus.set(0);
		if(~chargeSynth.notNil) { ~chargeSynth.release };
		~chargeSynth = Synth(\chargeDrone, [\out, ~fxBus, \levelBus, ~levelBus], ~srcGroup);
	}, '/charge/start');

	// /charge/level level : 溜めレベルを制御バスへ書き込み（ドローンが追従）
	OSCdef(\chargeLevel, { |msg|
		~levelBus.set(msg[1].clip(0, 1));
	}, '/charge/level');

	// /release level x y : ドローンを解放 → ドロップ+衝撃波+シャワー群を発火
	OSCdef(\release, { |msg|
		var level = msg[1].clip(0, 1);
		var pan = ~xToPan.(msg[2]);
		if(~chargeSynth.notNil) { ~chargeSynth.release; ~chargeSynth = nil };
		Synth(\dropBoom,  [\out, ~fxBus, \amp, level.linlin(0, 1, 0.3, 0.95), \pan, pan * 0.3], ~srcGroup);
		Synth(\shockwave, [\out, ~fxBus, \amp, level.linlin(0, 1, 0.25, 0.7),  \pan, pan * 0.5], ~srcGroup);
		// シャワー群: 初期密度 ∝ level、3 秒かけて密度が減衰
		Routine({
			var t = 0, total = 3.0;
			var baseDensity = level.linlin(0, 1, 3, 14);    // 初期密度（notes/sec）
			while({ t < total }, {
				var frac = 1 - (t / total);
				var density = (baseDensity * frac).max(0.8);
				var wait = density.reciprocal;
				Synth(\shimmer, [\out, ~fxBus,
					\freq, ~shimmerFreqs.choose,
					\amp, level.linlin(0, 1, 0.08, 0.22) * frac.max(0.25),
					\pan, 1.0.rand2], ~srcGroup);
				t = t + wait;
				wait.wait;
			});
		}).play;
	}, '/release');

	// /pop x y : 短クリックの軽いプラック
	OSCdef(\pop, { |msg|
		Synth(\popPluck, [\out, ~fxBus,
			\freq, ~popFreqs.choose,
			\amp, 0.4,
			\pan, ~xToPan.(msg[1]) * 0.6], ~srcGroup);
	}, '/pop');

	// /sc/ampReply : SendReply を受け Processing へ /sc/amp を転送（30Hz、疎結合の唯一の音→視覚線）
	OSCdef(\ampForward, { |msg|
		~processingAddr.sendMsg('/sc/amp', msg[3].clip(0, 1));
	}, '/sc/ampReply');

	s.sync;

	// ═══════════ Tier 2: SuperDirt（クラス存在ガード付き）═══════════
	// 未導入環境でコンパイルエラーにしないため、クラス名を直接書かず asClass 経由で参照する
	superDirtClass = \SuperDirt.asClass;
	if(superDirtClass.notNil) {
		"[CatharsisField] SuperDirt を検出 ─ Tier 2 を起動します".postln;
		~dirt = superDirtClass.new(2, s);
		~dirt.loadSoundFiles;
		s.sync;
		~dirt.start(~superDirtPort, 0 ! 12);
		"[CatharsisField] SuperDirt 起動完了（port 57120）".postln;
	} {
		"[CatharsisField] SuperDirt 未導入 ─ Tier 1（カスタム SynthDef のみ）で動作".postln;
	};

	s.sync;
	"════════════════════════════════════════".postln;
	"CatharsisField audio ready".postln;
	("  受信 OSC :" ++ NetAddr.langPort.asString ++ "  /charge/start /charge/level /release /pop").postln;
	("  送信 OSC :" ++ ~processingPort.asString ++ " /sc/amp（マスター振幅 " ++ ~ampSendRate.asString ++ "Hz）").postln;
	"════════════════════════════════════════".postln;
};
