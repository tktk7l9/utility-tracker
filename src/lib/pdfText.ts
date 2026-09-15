// ブラウザで PDF からテキストを抜き出す（PDF.js）。ブラウザ専用の呼び出し層のためカバレッジ計測対象外。
// 解析は pdfBill.ts の純関数が行う。PDF はどこにも送らず、この端末の中だけで読む。
//
// - PDF.js は通常ワーカーを別ファイルで起動するが、バンドラ（Turbopack）と CSP の都合を避けるため、
//   ワーカー本体を import して globalThis.pdfjsWorker に置き、メインスレッドで動かす（1ページの請求書なら十分速い）。
// - エルピオの請求書は日本語フォントを埋め込まず、定義済み CMap（UniJIS-UCS2-H）で文字を表す。
//   CMap が無いと日本語が1文字も取れないので、public/cmaps（dev/build 前に pdfjs-dist からコピー）から読ませる。

export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs")]);
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;

  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    cMapUrl: new URL("/cmaps/", window.location.href).href,
    cMapPacked: true,
    useWasm: false,
  });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join(""));
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}
