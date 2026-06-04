import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { IngestResult, PageBundle } from '@/lib/pipeline/types';

// Cap pages parsed for text. Names live in the front matter (저자/연구진/인준 블록), and the
// extractor only sends the first ~12k chars to the VLM anyway — so parsing all pages of a huge
// report (수백~수천 쪽) is wasted CPU and the main slowness. Tunable via PDF_MAX_PAGES.
const MAX_PAGES = Number(process.env.PDF_MAX_PAGES ?? 20);
/** Below this many characters on a page, we treat it as having no usable text layer. */
const MIN_TEXT_CHARS = 12;

interface PdfTextItem {
  str?: string;
}
interface PdfPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
}
interface PdfDoc {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}
interface PdfjsModule {
  getDocument(opts: {
    data: Uint8Array;
    isEvalSupported?: boolean;
    useSystemFonts?: boolean;
    verbosity?: number;
  }): { promise: Promise<PdfDoc> };
  GlobalWorkerOptions?: { workerSrc: string };
}

let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    // Legacy build runs on the main thread via a "fake worker" that imports the worker module.
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((m: unknown) => {
      const mod = m as PdfjsModule;
      try {
        if (mod.GlobalWorkerOptions) {
          const require = createRequire(import.meta.url);
          mod.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
        }
      } catch {
        /* no-op — getDocument falls back and we degrade gracefully below */
      }
      return mod;
    });
  }
  return pdfjsPromise;
}

/**
 * Extract the text layer from a PDF. Scanned PDFs (no text) are flagged (hasTextLayer=false)
 * rather than throwing — the worker routes those to vision / human review.
 */
export async function ingestPdf(filepath: string): Promise<IngestResult> {
  const buf = await readFile(filepath);
  const data = new Uint8Array(buf); // copy so pdfjs cannot detach the underlying buffer
  const pages: PageBundle[] = [];
  let hasTextLayer = false;

  try {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: true,
      verbosity: 0,
    }).promise;
    const n = Math.min(doc.numPages, MAX_PAGES);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => it.str ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const hasText = text.length >= MIN_TEXT_CHARS;
      if (hasText) hasTextLayer = true;
      pages.push({ pageNumber: i, text, hasText });
    }
    return {
      format: 'pdf',
      filepath,
      pages,
      pageCount: doc.numPages,
      hasTextLayer,
      note: hasTextLayer ? undefined : 'scanned: no text layer (vision required)',
    };
  } catch (err) {
    // Corrupt / unreadable PDF — degrade gracefully to a single vision page.
    return {
      format: 'pdf',
      filepath,
      pages: [{ pageNumber: 1, text: '', hasText: false, imagePath: filepath }],
      pageCount: 1,
      hasTextLayer: false,
      note: `pdf parse failed: ${(err as Error).message}`,
    };
  }
}
