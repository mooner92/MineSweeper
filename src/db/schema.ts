import { relations } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type {
  Bbox,
  DocType,
  ExpertField,
  FlagType,
  JobStatus,
  NameCandidate,
  ReviewStatus,
  Role,
  SourceFormat,
  SourceKind,
  SourceRef,
  VerificationStatus,
} from '@/lib/domain';

const uuid = () => crypto.randomUUID();

const createdAt = () =>
  integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date());

/** Local login account (Phase-1 auth — no external IdP). Password = scrypt hash, "salt:hex". */
export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(uuid),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
});

/** One applicant (지원자). `name` is used to detect/exclude the applicant themself. */
export const applicants = sqliteTable('applicants', {
  id: text('id').primaryKey().$defaultFn(uuid),
  name: text('name').notNull(),
  // 지원번호 (e.g. "2401-000050") parsed from the zip/folder — the stable dedup key. A re-upload with
  // the same external_id REPLACES the prior applicant (see api/upload). Null when not parseable
  // (multiple NULLs are allowed by the unique index; the constraint backstops concurrent uploads).
  externalId: text('external_id').unique(),
  recruitmentRound: text('recruitment_round'),
  // 섭외 후보 기본 필터로 쓰는 지원자 연구 분야(인사팀이 선택해 저장 → 재방문 시 유지). 자동 추출 아님.
  fieldDae: text('field_dae'),
  fieldMid: text('field_mid'),
  createdAt: createdAt(),
});

/** One attached document. folder=category, [tag]/content => doc_type. */
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey().$defaultFn(uuid),
  applicantId: text('applicant_id')
    .notNull()
    .references(() => applicants.id, { onDelete: 'cascade' }),
  folderCategory: text('folder_category'),
  docType: text('doc_type').$type<DocType>().notNull().default('unknown'),
  sourceFormat: text('source_format').$type<SourceFormat>().notNull(),
  filename: text('filename').notNull(),
  title: text('title'),
  filepath: text('filepath').notNull(),
  pageCount: integer('page_count').notNull().default(0),
  hasTextLayer: integer('has_text_layer', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
});

/** Raw per-document extraction. One row per (person, document, role) occurrence. */
export const extractedPersons = sqliteTable('extracted_persons', {
  id: text('id').primaryKey().$defaultFn(uuid),
  documentId: text('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  nameRaw: text('name_raw').notNull(),
  nameNormalized: text('name_normalized').notNull(),
  nameEn: text('name_en'),
  nameKo: text('name_ko'),
  nameInitials: text('name_initials'),
  role: text('role').$type<Role>().notNull(),
  affiliation: text('affiliation'),
  isSelf: integer('is_self', { mode: 'boolean' }).notNull().default(false),
  sourceKind: text('source_kind').$type<SourceKind>().notNull().default('printed'),
  sourcePage: integer('source_page').notNull().default(1),
  regionBbox: text('region_bbox', { mode: 'json' }).$type<Bbox | null>(),
  cropPath: text('crop_path'),
  ocrEngine: text('ocr_engine'),
  ocrConfidence: real('ocr_confidence'),
  nameCandidates: text('name_candidates', { mode: 'json' }).$type<NameCandidate[] | null>(),
  confidence: real('confidence').notNull().default(0),
  needsHuman: integer('needs_human', { mode: 'boolean' }).notNull().default(true),
  verificationStatus: text('verification_status').$type<VerificationStatus>(),
  reviewStatus: text('review_status').$type<ReviewStatus>().notNull().default('pending'),
  createdAt: createdAt(),
});

/** Applicant-level dedup: one row per real person, roles unioned across documents. */
export const personAggregates = sqliteTable('person_aggregates', {
  id: text('id').primaryKey().$defaultFn(uuid),
  applicantId: text('applicant_id')
    .notNull()
    .references(() => applicants.id, { onDelete: 'cascade' }),
  canonicalName: text('canonical_name').notNull(),
  nameNormalized: text('name_normalized').notNull(),
  roles: text('roles', { mode: 'json' }).$type<Role[]>().notNull().default([]),
  sources: text('sources', { mode: 'json' }).$type<SourceRef[]>().notNull().default([]),
  nameCandidates: text('name_candidates', { mode: 'json' }).$type<NameCandidate[]>().notNull().default([]),
  affiliation: text('affiliation'),
  isSelf: integer('is_self', { mode: 'boolean' }).notNull().default(false),
  needsHuman: integer('needs_human', { mode: 'boolean' }).notNull().default(true),
  finalStatus: text('final_status').$type<ReviewStatus>().notNull().default('pending'),
  createdAt: createdAt(),
});

export interface JobPayload {
  applicantId: string;
}

/** Background batch queue. The worker polls this table. */
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey().$defaultFn(uuid),
  type: text('type').notNull().default('process_applicant'),
  status: text('status').$type<JobStatus>().notNull().default('queued'),
  payload: text('payload', { mode: 'json' }).$type<JobPayload>().notNull(),
  progress: integer('progress').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  createdAt: createdAt(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** "검토 필요 큐" — seal / handwriting / ambiguous items, gathered for fast human review. */
export const reviewFlags = sqliteTable('review_flags', {
  id: text('id').primaryKey().$defaultFn(uuid),
  // Either a person-level flag (seal/handwriting/...) or a document-level flag (needs_vision).
  personId: text('person_id').references(() => extractedPersons.id, { onDelete: 'cascade' }),
  documentId: text('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  applicantId: text('applicant_id')
    .notNull()
    .references(() => applicants.id, { onDelete: 'cascade' }),
  flagType: text('flag_type').$type<FlagType>().notNull(),
  label: text('label'),
  cropPath: text('crop_path'),
  status: text('status').$type<'open' | 'resolved'>().notNull().default('open'),
  createdAt: createdAt(),
});

/** Audit log of human corrections — future training data + accuracy tracking. */
export const corrections = sqliteTable('corrections', {
  id: text('id').primaryKey().$defaultFn(uuid),
  applicantId: text('applicant_id')
    .notNull()
    .references(() => applicants.id, { onDelete: 'cascade' }),
  personId: text('person_id'),
  field: text('field').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  action: text('action').$type<'confirm' | 'edit' | 'reject' | 'exclude'>().notNull(),
  createdAt: createdAt(),
});

/**
 * KEI 심사위원 후보 전문가 풀(외부 명단). 지원자의 관계자(지도교수·심사위원·공저자 등)와 이름이
 * 일치하면 그 전문가는 해당 지원자 심사에서 **제척** 대상이다. PII(이름·연락처)를 담으므로 DB는
 * 절대 커밋하지 않는다(.gitignore). 적재는 scripts/import-experts.ts, 재실행 시 전체 교체.
 */
export const experts = sqliteTable(
  'experts',
  {
    // 외부 KEI 전문가 ID(예: '82260238') — 명단의 안정적 식별자, 재적재 시 동일 키로 교체.
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    // 매칭 키(= nameKey(name)) — 관계자 이름과 대조한다. 동명이인은 같은 키로 묶인다.
    nameKey: text('name_key').notNull(),
    affiliation: text('affiliation'),
    position: text('position'),
    email: text('email'),
    phone: text('phone'),
    // 등록된 분류체계 경로들(한 전문가가 세부분야 여러 개). 섭외 분야필터·표시용.
    fields: text('fields', { mode: 'json' }).$type<ExpertField[]>().notNull().default([]),
    // 등록일자 원문 문자열(타임존 변환 회피).
    registeredAt: text('registered_at'),
    createdAt: createdAt(),
  },
  (t) => ({ nameKeyIdx: index('experts_name_key_idx').on(t.nameKey) }),
);

/**
 * 초빙(섭외) 명단 — 지원자별로 인사팀이 풀에서 골라 담은 면접위원 후보. **변질 방지**가 핵심이라
 * 담는 시점의 전문가 정보를 스냅샷으로 박아둔다(풀 재적재·전문가 레코드 변경에 영향받지 않음).
 * 삭제는 soft delete(removedAt)로 변경 이력을 남긴다 — 활성 명단 = removedAt IS NULL.
 */
export const invitations = sqliteTable('invitations', {
  id: text('id').primaryKey().$defaultFn(uuid),
  applicantId: text('applicant_id')
    .notNull()
    .references(() => applicants.id, { onDelete: 'cascade' }),
  // 풀 전문가 ID(대조용 참조일 뿐 FK 아님 — 풀 재적재가 명단을 건드리면 안 되므로).
  expertId: text('expert_id').notNull(),
  // 담은 시점의 스냅샷(이 값이 곧 산출물 — 풀이 바뀌어도 불변).
  name: text('name').notNull(),
  affiliation: text('affiliation'),
  position: text('position'),
  email: text('email'),
  phone: text('phone'),
  fields: text('fields', { mode: 'json' }).$type<ExpertField[]>().notNull().default([]),
  createdAt: createdAt(),
  // null = 활성. 값이 있으면 명단에서 빠진 것(이력 보존).
  removedAt: integer('removed_at', { mode: 'timestamp' }),
});

// --- relations (for the convenient db.query.* API used by the review UI) ---

export const applicantsRelations = relations(applicants, ({ many }) => ({
  documents: many(documents),
  aggregates: many(personAggregates),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  applicant: one(applicants, {
    fields: [documents.applicantId],
    references: [applicants.id],
  }),
  persons: many(extractedPersons),
}));

export const extractedPersonsRelations = relations(extractedPersons, ({ one }) => ({
  document: one(documents, {
    fields: [extractedPersons.documentId],
    references: [documents.id],
  }),
}));

export const personAggregatesRelations = relations(personAggregates, ({ one }) => ({
  applicant: one(applicants, {
    fields: [personAggregates.applicantId],
    references: [applicants.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type Applicant = typeof applicants.$inferSelect;
export type NewApplicant = typeof applicants.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type ExtractedPerson = typeof extractedPersons.$inferSelect;
export type NewExtractedPerson = typeof extractedPersons.$inferInsert;
export type PersonAggregate = typeof personAggregates.$inferSelect;
export type NewPersonAggregate = typeof personAggregates.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type ReviewFlag = typeof reviewFlags.$inferSelect;
export type NewReviewFlag = typeof reviewFlags.$inferInsert;
export type Correction = typeof corrections.$inferSelect;
export type NewCorrection = typeof corrections.$inferInsert;
export type Expert = typeof experts.$inferSelect;
export type NewExpert = typeof experts.$inferInsert;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
