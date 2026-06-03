import type { Bbox, DocType, Role, SourceFormat, SourceKind } from '@/lib/domain';

/** A normalized page: text (may be empty) plus an optional image to view/extract from. */
export interface PageBundle {
  pageNumber: number;
  text: string;
  hasText: boolean;
  /** Path to a page image (for image formats / scanned pages) — used for vision + crops. */
  imagePath?: string;
}

/** Stage 1 output — format-agnostic. */
export interface IngestResult {
  format: SourceFormat;
  filepath: string;
  pages: PageBundle[];
  pageCount: number;
  hasTextLayer: boolean;
  /** Human-readable note, e.g. "scanned: no text layer" or "hwp: unsupported". */
  note?: string;
}

/** Stage 3 output — one occurrence of a person in one document. */
export interface RawPerson {
  nameRaw: string;
  role: Role;
  affiliation?: string | null;
  sourceKind: SourceKind;
  sourcePage: number;
  /** 0..1 extraction confidence. */
  confidence: number;
  isSelf?: boolean;
  regionBbox?: Bbox | null;
  ocrEngine?: string | null;
  ocrConfidence?: number | null;
  /** The snippet/line the name came from (provenance / debugging). */
  evidence?: string;
}

/** Input to a Stage 3 extractor for a single document. */
export interface ExtractInput {
  docType: DocType;
  pages: PageBundle[];
  filename: string;
  /** Applicant name, used to tag is_self. */
  selfName?: string;
  /** Page images for vision-based extraction (scanned PDFs / hindex). */
  imagePaths?: string[];
}

/** Pluggable Stage 3 extractor. Implementations: deterministic stub, on-prem VLM client. */
export interface Extractor {
  readonly name: string;
  extract(input: ExtractInput): Promise<RawPerson[]>;
}

/** A RawPerson enriched with its document provenance — the input to Stage 4. */
export interface PersonWithSource extends RawPerson {
  documentId: string;
  filename: string;
  docType: DocType;
}

/** Stage 4 output — one real person, roles/sources unioned across documents. */
export interface AggregatedPerson {
  canonicalName: string;
  nameNormalized: string;
  roles: Role[];
  sources: import('@/lib/domain').SourceRef[];
  affiliation: string | null;
  isSelf: boolean;
  needsHuman: boolean;
}
