/**
 * Shared domain vocabulary for the conflict-of-interest extractor.
 *
 * These string unions are the contract between the pipeline stages, the DB schema, and the
 * UI. Format (how a file is read) and doc-type (what is extracted) are deliberately
 * separate axes — see the 4-stage pipeline in the README.
 */

export const SOURCE_FORMATS = ['pdf', 'image', 'hwp', 'text'] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];

export const DOC_TYPES = [
  'degree_thesis',
  'representative_research',
  'journal_article',
  'hindex',
  'unknown',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const ROLES = [
  'supervisor',
  'co_supervisor',
  'committee',
  'department_head',
  'principal_investigator',
  'research_staff',
  'coauthor',
  // internal-employee roles (Phase 2 workstream, modelled now for completeness)
  'division_head',
  'office_head',
  'project_manager',
] as const;
export type Role = (typeof ROLES)[number];

export const SOURCE_KINDS = ['printed', 'handwritten', 'seal', 'signature'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const REVIEW_STATUSES = ['pending', 'confirmed', 'rejected', 'edited'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Whether a printed name is backed by a co-located seal/signature. */
export const VERIFICATION_STATUSES = ['confirmed', 'mismatch', 'unverifiable'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const FLAG_TYPES = [
  'seal',
  'handwriting',
  'signature',
  'low_confidence',
  'ambiguous',
  'needs_vision',
] as const;
export type FlagType = (typeof FLAG_TYPES)[number];

export const FLAG_TYPE_LABELS_KO: Record<FlagType, string> = {
  seal: '도장',
  handwriting: '손글씨',
  signature: '서명',
  low_confidence: '저신뢰',
  ambiguous: '동명이인/약어',
  needs_vision: '비전 판독 필요',
};

export const JOB_STATUSES = ['queued', 'running', 'done', 'error'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Korean display labels — the reviewers read these, not the machine keys. */
export const ROLE_LABELS_KO: Record<Role, string> = {
  supervisor: '지도교수',
  co_supervisor: '부지도교수',
  committee: '심사위원',
  department_head: '학과장',
  principal_investigator: '책임자',
  research_staff: '참여연구진',
  coauthor: '공저자',
  division_head: '부서장',
  office_head: '실장',
  project_manager: '과제책임자',
};

export const DOC_TYPE_LABELS_KO: Record<DocType, string> = {
  degree_thesis: '학위논문',
  representative_research: '대표연구실적',
  journal_article: '학술논문',
  hindex: '구글스칼라(hindex)',
  unknown: '미분류',
};

/** A rectangular region on a page image (normalized 0..1 or pixel — caller's convention). */
export interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
  page?: number;
}

/** A name candidate for human disambiguation (n-best / near-duplicate). score: 0..1. */
export interface NameCandidate {
  name: string;
  score: number;
}

/**
 * A non-printed mark DETECTED on a page (not read). The system flags "there is a seal/signature
 * here" + where, so a human can eyeball the crop — it does NOT try to read 전서체 seals.
 */
export interface DocumentMark {
  type: 'seal' | 'signature' | 'handwriting';
  /** Normalized 0..1 region on the page image. */
  bbox: Bbox;
  page: number;
  confidence?: number | null;
  /** Path to the cropped region image (filled by the worker after cropping). */
  cropPath?: string | null;
}

/** Where an aggregated person was found — the provenance shown next to each name. */
export interface SourceRef {
  documentId: string;
  filename: string;
  docType: DocType;
  page: number;
  role: Role;
  sourceKind: SourceKind;
  confidence: number;
  /** The line/snippet the name came from (shown as a hover snippet in the review UI). */
  evidence?: string;
}
