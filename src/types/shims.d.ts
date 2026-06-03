// pdfjs-dist v4 ships ESM; the Node-friendly legacy build has no bundled types for this
// subpath. We only use it through a small typed wrapper (src/lib/pipeline/ingest/pdf.ts),
// so declaring it as `any` here keeps `tsc --noEmit` green without loosening the wrapper.
declare module 'pdfjs-dist/legacy/build/pdf.mjs';
