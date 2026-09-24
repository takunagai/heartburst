// ============================================================
// i18n.ts ─ 日英の表示文字の辞書と切り替え
//
// - 言語の決定: 端末に記憶した選択 → 無ければ navigator.languages に ja* があれば日本語、それ以外は英語
// - HTML の固定文字は data-i18n="キー"（textContent）と data-i18n-attr="属性:キー;属性:キー" で辞書を指す。
//   切り替え時に一括で差し替える。HTML の初期文字は日本語（スクリプトが動かない環境でも読める）
// - 動的な文字（マイクの状態・場面の一文・入力ダイアログ）は表示のたびに t() で引く
// - 言語トグルは data-lang-option="ja" / "en" のボタン。どこに置いても initI18n が拾う
// ============================================================

export type Lang = "ja" | "en";

const STORAGE_KEY = "heartburst.lang";

const MESSAGES = {
  "page.title": { ja: "Heartburst ─ 溜めて、放つ。", en: "Heartburst ─ Hold. Let go." },
  "page.description": {
    ja: "溜めて、放つ。胸の内を弾けさせるインタラクティブ・アート ─ Heartburst",
    en: "Hold it in, then let it burst. An interactive art piece about catharsis ─ Heartburst",
  },

  "overlay.text": { ja: "長押しで溜めて、離して解き放つ", en: "Hold to charge. Let go to release." },
  "overlay.note": { ja: "音が鳴ります・音量にご注意ください", en: "Sound on ─ mind your volume" },
  "overlay.start.tap": { ja: "タップしてスタート", en: "Tap to Start" },
  "overlay.start.click": { ja: "クリックしてスタート", en: "Click to Start" },
  "overlay.howto": { ja: "How to Play", en: "How to Play" },
  "lang.group": { ja: "言語", en: "Language" },

  "help.aria": { ja: "遊び方を見る", en: "How to play" },

  "voice.off": { ja: "声で溜める", en: "Voice charge" },
  "voice.on": { ja: "声で溜める：オン", en: "Voice charge: ON" },
  "voice.preparing": { ja: "マイクを準備中", en: "Preparing mic…" },
  "voice.denied": { ja: "マイクが許可されていません", en: "Mic permission denied" },
  "voice.unavailable": { ja: "マイクを使えません", en: "Mic unavailable" },
  "voice.title": {
    ja: "マイクの音量だけを使います（録音・送信はしません）",
    en: "Only the loudness of your mic is used (nothing is recorded or sent)",
  },

  "word.toggle": { ja: "言葉を書いて、壊す", en: "Write it, break it" },
  "word.placeholder": { ja: "モヤモヤを書いて Enter", en: "Type what weighs on you, then Enter" },
  "word.aria": { ja: "壊したい言葉", en: "Words to break" },

  "manual.title": { ja: "遊び方", en: "How to Play" },
  "manual.close": { ja: "閉じる", en: "Close" },
  "manual.basics": { ja: "基本", en: "Basics" },
  "manual.hold": { ja: "長押しで溜める", en: "Hold to charge" },
  "manual.hold.sub": { ja: "長いほど強い", en: "longer is stronger" },
  "manual.release": { ja: "離すと爆発", en: "Let go to explode" },
  "manual.release.sub": { ja: "一瞬の静寂のあとに", en: "after a hush" },
  "manual.tap": { ja: "短くタップ", en: "Tap" },
  "manual.tap.sub": { ja: "音が鳴り、光の種が残る", en: "a note sounds, a seed of light stays" },
  "manual.more": { ja: "もっと遊ぶ", en: "More" },
  "manual.critical": { ja: "金の輪が光る瞬間に離す → クリティカル", en: "Let go as the gold ring flashes → Critical" },
  "manual.overload": { ja: "満タンのまま押し続ける → 暴発", en: "Keep holding at full charge → Overload" },
  "manual.flick": { ja: "離す瞬間に弾く → その方向へ飛ぶ", en: "Flick as you let go → blast that way" },
  "manual.chain": { ja: "爆発で種を巻き込む → 連鎖して旋律に", en: "Catch seeds in a blast → a chain melody" },
  "manual.finale": { ja: "強い解放 7 回（画面下の点）→ 大団円", en: "7 strong releases (dots below) → Finale" },
  "manual.extras": { ja: "右下のボタン", en: "Buttons" },
  "manual.word": { ja: "言葉を書いて、壊す ─ 言葉を粒子にして砕く", en: "Write it, break it ─ shatter your words" },
  "manual.voice": { ja: "声で溜める ─ 叫んで溜め、黙ると爆発", en: "Voice charge ─ shout to charge, hush to blast" },
  "manual.footer": {
    ja: "音が鳴ります ・ 入力した言葉と声は送信・保存しません",
    en: "Sound on · Your words and voice are never sent or stored",
  },

  "scene.night": { ja: "もう一度、夜へ", en: "Night, once more" },
  "scene.dawn": { ja: "夜が明ける", en: "Dawn breaks" },
  "scene.aurora": { ja: "光が満ちる", en: "Light overflows" },
  "scene.abyss": { ja: "深く、静かに", en: "Deep and still" },
} satisfies Record<string, Record<Lang, string>>;

export type MessageKey = keyof typeof MESSAGES;

let currentLang: Lang = "ja";
const listeners: ((lang: Lang) => void)[] = [];

export function t(key: MessageKey): string {
  return MESSAGES[key][currentLang];
}

export function getLang(): Lang {
  return currentLang;
}

export function onLangChange(listener: (lang: Lang) => void): void {
  listeners.push(listener);
}

function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "ja" || stored === "en") return stored;
  } catch {
    // 記憶を読めない環境（プライベートブラウズ等）は自動選択へ
  }
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  return preferred.some((lang) => lang?.toLowerCase().startsWith("ja")) ? "ja" : "en";
}

export function setLang(lang: Lang): void {
  currentLang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // 記憶できなくても今回の表示は切り替わる
  }
  applyToDom();
  for (const listener of listeners) listener(lang);
}

function applyToDom(): void {
  document.documentElement.lang = currentLang;
  document.title = t("page.title");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("page.description"));

  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n as MessageKey);
  });
  // data-i18n-attr="aria-label:help.aria;title:voice.title"
  document.querySelectorAll<HTMLElement>("[data-i18n-attr]").forEach((element) => {
    for (const pair of (element.dataset.i18nAttr ?? "").split(";")) {
      const [attribute, key] = pair.split(":");
      if (attribute && key) element.setAttribute(attribute.trim(), t(key.trim() as MessageKey));
    }
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lang-option]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.langOption === currentLang));
  });
}

export function initI18n(): void {
  currentLang = detectLang();
  applyToDom();
  document.querySelectorAll<HTMLButtonElement>("[data-lang-option]").forEach((button) => {
    // 導入画面の上に置くトグルは、押しても作品が始まらないよう pointerdown を止める
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", () => setLang(button.dataset.langOption === "en" ? "en" : "ja"));
  });
}
