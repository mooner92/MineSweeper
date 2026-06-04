import { basename } from 'node:path';
import type { DocType } from '@/lib/domain';
import { aggregate } from './aggregate';
import { classifyDocType } from './classify';
import { crossCheck } from './crosscheck';
import { getExtractor } from './extract';
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
}

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
