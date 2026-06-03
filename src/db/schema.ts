import { relations } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type {
  Bbox,
  DocType,
  FlagType,
  JobStatus,
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

/** One applicant (지원자). `name` is used to detect/exclude the applicant themself. */
export const applicants = sqliteTable('applicants', {
  id: text('id').primaryKey().$defaultFn(uuid),
  name: text('name').notNull(),
  recruitmentRound: text('recruitment_round'),
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
