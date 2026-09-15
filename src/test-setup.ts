import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());

// Intl の日本語ロケールは、ワーカーごとに最初の1回だけ読み込みが重い。Cloudflare のビルド環境では
// formatYen のテストがこれで 1.9〜11.7 秒かかり、5 秒のタイムアウトで落ちてデプロイが止まったことがある
// （2回目以降の formatNumber は数ミリ秒）。テスト本体の時間に含めないよう、ここで先に1回使っておく。
new Intl.NumberFormat("ja-JP").format(0);

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

if (typeof window !== "undefined" && typeof (window as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (window as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof Element !== "undefined" && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
