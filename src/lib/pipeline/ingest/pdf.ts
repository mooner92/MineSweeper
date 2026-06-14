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

// 명단 섹션이 부록(예: 162쪽 보고서의 121쪽 '참여자 인적사항')에 박혀 윈도우 밖에 있는 경우가 많다.
// 전체 페이지 텍스트를 훑어(렌더 없이, 714쪽 ≈ 5초) 명단 섹션 헤더가 있는 페이지를 윈도우에 더한다.
// 인용문헌/참고자료(논문 인용 목록)는 매칭되지 않도록 명단 전용 키워드만 쓴다. 공백은 pdfjs가 글자
// 사이에 끼우므로 \s* 허용. 추가 페이지는 cap으로 제한(VLM 페이로드·지연 방어).
const ROSTER_PAGE_RE =
  /참여\s*연구\s*진|참여\s*자?\s*명단|참여\s*자?\s*인적\s*사항|연구진\s*명단|공동\s*연구\s*개발\s*기관|참여\s*인력/;
const ROSTER_PAGE_CAP = 12;

/** 윈도우 밖에서 명단 섹션 헤더가 보이는 페이지 번호(1-based). texts[i] = (i+1)쪽 텍스트. */
export function rosterPageNumbers(
  texts: string[],
  windowSet: Set<number>,
  cap = ROSTER_PAGE_CAP,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < texts.length && out.length < cap; i++) {
    const pageNo = i + 1;
    if (!windowSet.has(pageNo) && ROSTER_PAGE_RE.test(texts[i])) out.push(pageNo);
  }
  return out;
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
    // 전체 페이지 텍스트를 한 번 훑는다(렌더 없이 텍스트만 — 714쪽 ≈ 5초). 명단이 부록 등 윈도우
    // 밖에 있어도 찾기 위함. 무거운 다운스트림(추출/비전)은 그대로 윈도우+명단 페이지로만 제한한다.
    const texts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      texts.push(
        content.items
          .map((it) => it.str ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      );
    }
    const windowSet = new Set(windowPageNumbers(doc.numPages));
    const keep = [...new Set([...windowSet, ...rosterPageNumbers(texts, windowSet)])].sort(
      (a, b) => a - b,
    );
    for (const i of keep) {
      const text = texts[i - 1];
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
