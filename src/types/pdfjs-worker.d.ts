// pdfjs-dist はワーカー本体の型を同梱していない。pdfText.ts で import して
// globalThis.pdfjsWorker に置く（メインスレッドで動かす）ためだけに宣言する。
declare module "pdfjs-dist/build/pdf.worker.min.mjs";
