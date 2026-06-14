import { basename } from 'node:path';
import type { DocType } from '@/lib/domain';
import { aggregate } from './aggregate';
import { classifyDocType } from './classify';
import { crossCheck } from './crosscheck';
import { getExtractor } from './extract';
import { mergeRoster, supplementRoster } from './extract/roster';
import { detectFormat, ingest } from './ingest';
import type {
  AggregatedPerson,
  Extractor,
  IngestResult,
  PersonWithSource,
  RawPerson,
} from './types';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface PipelineFile {
  filepath: string;
  folderCategory?: string | null;
  /** Stable document id (the worker passes the DB row id; tests can omit it). */
  documentId?: string;
}

export interface DocResult {
  documentId: string;
  filepath: string;
  filename: string;
  folderCategory: string | null;
  docType: DocType;
  ingest: IngestResult;
  persons: PersonWithSource[];
}

export interface PipelineResult {
  documents: DocResult[];
  aggregates: AggregatedPerson[];
}

export interface RunOptions {
  applicantName?: string;
  /** Defaults to the env-selected extractor (stub unless EXTRACTOR_MODE=vlm). */
  extractor?: Extractor;
  /**
   * 텍스트층이 없는 PDF 페이지(이미지 표 — 예: 공동연구개발기관 표)를 PNG로 렌더해 경로를 돌려준다.
   * 워커가 네이티브 렌더러(render.ts)를 주입한다(앱/테스트엔 미주입 → 네이티브 의존성 분리).
   */
  renderPage?: (filepath: string, pageNumber: number) => Promise<string | null>;
}

/** 한 문서에서 비전 OCR로 렌더할 무텍스트 페이지 최대 수(VLM 페이로드·지연 제한). */
const MAX_VISION_PAGES = 4;

/** Run all 4 stages over an applicant's files and return per-doc + aggregated results. */
export async function runPipeline(
  files: PipelineFile[],
  options: RunOptions = {},
): Promise<PipelineResult> {
  const extractor = options.extractor ?? getExtractor();
  const documents: DocResult[] = [];
  const allPersons: PersonWithSource[] = [];

  let autoId = 0;
  for (const file of files) {
    const filename = basename(file.filepath);
    const documentId = file.documentId ?? `doc-${++autoId}`;

    // Per-document resilience: a single bad file (corrupt PDF, or a VLM that's down/timing out for
    // an image doc) must NOT abort the whole applicant. Text docs still extract via the stub; a
    // failed doc degrades to 0 persons and gets a needs_vision flag downstream for a human.
    let ing: IngestResult;
    try {
      ing = await ingest(file.filepath, detectFormat(filename) ?? undefined);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[pipeline] ingest failed for ${filename}: ${errMsg(err)}`);
      documents.push({
        documentId,
        filepath: file.filepath,
        filename,
        folderCategory: file.folderCategory ?? null,
        docType: 'unknown',
        ingest: {
          format: detectFormat(filename) ?? 'pdf',
          filepath: file.filepath,
          pages: [],
          pageCount: 0,
          hasTextLayer: false,
          note: `ingest 실패: ${errMsg(err)}`,
        },
        persons: [],
      });
      continue;
    }

    const firstPageText = ing.pages.find((p) => p.hasText)?.text ?? ing.pages[0]?.text ?? '';
    const { docType } = classifyDocType({
      filename,
      folderCategory: file.folderCategory,
      firstPageText,
    });

    const imagePaths = ing.pages
      .map((p) => p.imagePath)
      .filter((x): x is string => Boolean(x));

    // 텍스트층이 없는 PDF 페이지(이미지로만 된 표 — 공동연구개발기관/연구진 명단 등)는 렌더해 VLM
    // 비전으로 OCR한다. pdfjs가 한 글자도 못 뽑는 표가 통째로 누락되던 문제를 메운다(워커에서만 동작).
    if (options.renderPage && ing.format === 'pdf') {
      const imagePages = ing.pages.filter((p) => !p.hasText && !p.imagePath).slice(0, MAX_VISION_PAGES);
      for (const p of imagePages) {
        const path = await options.renderPage(file.filepath, p.pageNumber);
        if (path) imagePaths.push(path);
      }
    }

    let raw: RawPerson[] = [];
    try {
      raw = await extractor.extract({
        docType,
        pages: ing.pages,
        filename,
        selfName: options.applicantName,
        imagePaths,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[pipeline] extract failed for ${filename} (${extractor.name}): ${errMsg(err)}`);
      raw = [];
    }

    // 정형 명단(참여연구진·공동연구개발기관·참여자 명단·저자 블록)의 결정적 추출. 추출기 성공/실패와
    // 무관하게 항상 union — 7B가 긴 표를 놓치거나 컨텍스트 한도(16k)로 통째로 실패해도 명단을 확보한다.
    const supplement = supplementRoster(ing.pages, docType, options.applicantName);
    if (supplement.length > 0) {
      const before = raw.length;
      raw = mergeRoster(raw, supplement);
      if (raw.length > before) {
        // eslint-disable-next-line no-console
        console.warn(`[pipeline] 결정적 명단 보강 ${raw.length - before}명 — ${filename}`);
      }
    }

    // crossCheck runs per document (printed anchor ↔ seal/signature). NO-OP for non-thesis and
    // currently for thesis too (no seal/signature names until Phase 1.5b OCR). Advisory only.
    const persons: PersonWithSource[] = crossCheck(
      raw.map((r) => ({ ...r, documentId, filename, docType })),
    );
    allPersons.push(...persons);

    documents.push({
      documentId,
      filepath: file.filepath,
      filename,
      folderCategory: file.folderCategory ?? null,
      docType,
      ingest: ing,
      persons,
    });
  }

  const aggregates = aggregate(allPersons, { selfName: options.applicantName });
  return { documents, aggregates };
}
