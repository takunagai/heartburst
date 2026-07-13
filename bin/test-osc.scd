// OSC 注入テスト: Processing の代わりに溜め→解放シーケンスを SC(57120) と Tidal(6010) へ送る
// 使い方: sclang bin/test-osc.scd（sc/main.scd と Tidal を起動した状態で別プロセスとして実行）
(
var sc = NetAddr("127.0.0.1", 57120);
var tidal = NetAddr("127.0.0.1", 6010);
fork {
	"test: pop x3".postln;
	3.do {
		sc.sendMsg("/pop", 0.5, 0.5);
		0.25.wait;
	};
	1.wait;

	"test: charge 3s".postln;
	sc.sendMsg("/charge/start", 0.5, 0.5);
	90.do { |i|
		var level = ((i + 1) / 90).min(1.0);
		sc.sendMsg("/charge/level", level);
		tidal.sendMsg("/ctrl", "charge", level.asFloat);
		(1/30).wait;
	};

	"test: release (level 1.0)".postln;
	sc.sendMsg("/release", 1.0, 0.5, 0.5);
	tidal.sendMsg("/ctrl", "charge", 0.0);
	90.do { |i|
		var energy = 1.0 - ((i + 1) / 90);
		tidal.sendMsg("/ctrl", "energy", energy.asFloat);
		(1/30).wait;
	};
	tidal.sendMsg("/ctrl", "energy", 0.0);

	"test: done ─ 8 秒後に終了".postln;
	8.wait;
	0.exit;
};
)
