// ============================================================
// manual.ts ─ 遊び方（説明カード）の開閉と初回案内
//
// - 入口: 導入画面の "How to Play"（押しても作品は始まらない）と、ゲーム中の「?」、キーボードの ?
// - ネイティブ <dialog> + showModal(): Esc で閉じる・フォーカスの閉じ込め・背景は標準に任せる
// - 閉じ方: ×・背景のタップ・Esc。閉じたら開く前の要素へフォーカスを戻す（showModal の標準動作）
// - 初回案内: 最初の爆発のあとに「?」を一度だけ脈打たせる。案内済みかどうかだけを端末に記録
// ============================================================

const HINT_STORAGE_KEY = "heartburst.helpHinted";

let dialog: HTMLDialogElement | null = null;
let isHintDone = false;

function readHintDone(): boolean {
  try {
    return localStorage.getItem(HINT_STORAGE_KEY) === "1";
  } catch {
    return false; // 記憶を読めない環境では毎回案内しても害はない
  }
}

function markHintDone(): void {
  isHintDone = true;
  try {
    localStorage.setItem(HINT_STORAGE_KEY, "1");
  } catch {
    // 記憶できなくても今回のセッションでは二度案内しない
  }
}

export function isManualOpen(): boolean {
  return dialog?.open ?? false;
}

export function openManual(): void {
  if (!dialog || dialog.open) return;
  dialog.showModal();
  markHintDone(); // 自分で開いた人には案内しない
  document.getElementById("help-button")?.classList.remove("is-hinting");
}

export function closeManual(): void {
  dialog?.close();
}

// 最初の爆発のあとに呼ぶ。まだ案内していなければ「?」を脈打たせる
export function hintHelpOnce(): void {
  if (isHintDone) return;
  markHintDone();
  const button = document.getElementById("help-button");
  if (!button) return;
  button.classList.add("is-hinting");
  button.addEventListener("animationend", () => button.classList.remove("is-hinting"), { once: true });
}

export function initManual(): void {
  dialog = document.getElementById("manual") as HTMLDialogElement | null;
  if (!dialog) return;
  isHintDone = readHintDone();

  // 導入画面は pointerdown で作品が始まるので、このボタンでは伝播を止める
  const overlayButton = document.getElementById("overlay-howto");
  overlayButton?.addEventListener("pointerdown", (event) => event.stopPropagation());
  overlayButton?.addEventListener("click", openManual);

  document.getElementById("help-button")?.addEventListener("click", openManual);
  dialog.querySelector(".manual-close")?.addEventListener("click", closeManual);

  // カードの外（背景）をタップしたら閉じる。<dialog> 自体が背景領域まで広がるので、target が dialog なら外側
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeManual();
  });
  // カード上の操作が作品側（window の pointer 系リスナー）へ届かないように
  dialog.addEventListener("pointerdown", (event) => event.stopPropagation());

  window.addEventListener("keydown", (event) => {
    if (event.key !== "?" || isManualOpen()) return;
    if (document.activeElement instanceof HTMLInputElement) return; // 言葉の入力中は ? を文字として扱う
    openManual();
  });
}
