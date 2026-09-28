// pdfjs-dist does not ship types for the worker itself. Declared only so pdfText.ts can import it
// and put it on globalThis.pdfjsWorker (to run it on the main thread).
declare module "pdfjs-dist/build/pdf.worker.min.mjs";
