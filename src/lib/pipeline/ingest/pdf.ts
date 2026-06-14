import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { IngestResult, PageBundle } from '@/lib/pipeline/types';

// Page window parsed for text. Names mostly live in the FRONT matter (저자/연구진/인준 블록), but
// 연구보고서 양식에 따라 참여연구진 명단·감사의 글이 맨 뒤에 붙기도 한다 — so parse 앞 N + 뒤 M pages
// and skip the middle (parsing all pages of 수백~수천 쪽 reports was wasted CPU and the main
// slowness). Tunable via PDF_FRONT_PAGES / PDF_BACK_PAGES; legacy PDF_MAX_PAGES = front fallback.
const envInt = (v: string | undefined, fallback: number): number => {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback; // typo'd env must not zero the window
};
const FRONT_PAGES = envInt(process.env.PDF_FRONT_PAGES ?? process.env.PDF_MAX_PAGES, 8);
const BACK_PAGES = envInt(process.env.PDF_BACK_PAGES, 4);

/** 1-based page numbers in the front/back window — deduped, ascending; short docs yield all pages. */
export function windowPageNumbers(numPages: number, front = FRONT_PAGES, back = BACK_PAGES): number[] {
  const nums = new Set<number>();
  for (let i = 1; i <= Math.min(front, numPages); i++) nums.add(i);
  for (let i = Math.max(1, numPages - back + 1); i <= numPages; i++) nums.add(i);
  return [...nums].sort((a, b) => a - b);
}

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
    for (const i of windowPageNumbers(doc.numPages)) {
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
