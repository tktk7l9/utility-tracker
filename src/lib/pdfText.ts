// Extracts text from PDFs in the browser (PDF.js). Excluded from coverage as a browser-only call layer.
// Parsing is done by the pure functions in pdfBill.ts. PDFs are never sent anywhere; they are read only on this device.
//
// - PDF.js normally starts its worker from a separate file, but to avoid bundler (Turbopack) and CSP issues,
//   we import the worker itself, put it on globalThis.pdfjsWorker and run it on the main thread (fast enough for a one-page bill).
// - LPIO bills do not embed a Japanese font and encode characters with a predefined CMap (UniJIS-UCS2-H).
//   Without the CMap not a single Japanese character comes out, so load it from public/cmaps (copied from pdfjs-dist before dev/build).

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
