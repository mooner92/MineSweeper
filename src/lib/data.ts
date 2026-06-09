import { count, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  applicants,
  documents,
  extractedPersons,
  jobs,
  personAggregates,
  reviewFlags,
  type Applicant,
  type Document,
  type Job,
  type PersonAggregate,
  type ReviewFlag,
} from '@/db/schema';
import type { Bbox, DocType, SourceFormat } from '@/lib/domain';

export interface ApplicantSummary {
  id: string;
  name: string;
  round: string | null;
  createdAt: Date;
  total: number;
  needsHuman: number;
}

export async function getApplicants(): Promise<ApplicantSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: applicants.id,
      name: applicants.name,
      round: applicants.recruitmentRound,
      createdAt: applicants.createdAt,
      total: count(personAggregates.id),
      needsHuman: sql<number>`coalesce(sum(case when ${personAggregates.needsHuman} then 1 else 0 end), 0)`,
    })
    .from(applicants)
    .leftJoin(personAggregates, eq(personAggregates.applicantId, applicants.id))
    .groupBy(applicants.id)
    .orderBy(desc(applicants.createdAt));
  return rows.map((r) => ({ ...r, total: Number(r.total), needsHuman: Number(r.needsHuman) }));
}

export interface ReviewData {
  applicant: Applicant;
  aggregates: PersonAggregate[];
  documents: Document[];
  job: Job | null;
}

export async function getApplicantReview(id: string): Promise<ReviewData | null> {
  const db = getDb();
  const applicant = (
    await db.select().from(applicants).where(eq(applicants.id, id)).limit(1)
  )[0];
  if (!applicant) return null;

  const aggregates = await db
    .select()
    .from(personAggregates)
    .where(eq(personAggregates.applicantId, id))
    .orderBy(personAggregates.isSelf, desc(personAggregates.needsHuman), personAggregates.canonicalName);

  const docs = await db.select().from(documents).where(eq(documents.applicantId, id));

  const job =
    (
      await db
        .select()
        .from(jobs)
        .where(sql`json_extract(${jobs.payload}, '$.applicantId') = ${id}`)
        .orderBy(desc(jobs.createdAt))
        .limit(1)
    )[0] ?? null;

  return { applicant, aggregates, documents: docs, job };
}

/** A candidate name in an 동명이인/약어(ambiguous) flag, with the files/pages where it appeared. */
export interface CandidateRef {
  name: string;
  sources: { documentId: string; filename: string; docType: DocType; page: number }[];
}

export interface QueueItem {
  flag: ReviewFlag;
  applicantId: string;
  applicantName: string | null;
  documentId: string | null;
  filename: string | null;
  sourceFormat: SourceFormat | null;
  personName: string | null;
  bbox: Bbox | null;
  /** For ambiguous flags: each candidate name + the source files/pages to compare. */
  candidates?: CandidateRef[];
}

export async function getReviewQueue(): Promise<QueueItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      flag: reviewFlags,
      applicantName: applicants.name,
      filename: documents.filename,
      sourceFormat: documents.sourceFormat,
      personName: extractedPersons.nameRaw,
      bbox: extractedPersons.regionBbox,
    })
    .from(reviewFlags)
    .leftJoin(applicants, eq(reviewFlags.applicantId, applicants.id))
    .leftJoin(documents, eq(reviewFlags.documentId, documents.id))
    .leftJoin(extractedPersons, eq(reviewFlags.personId, extractedPersons.id))
    .where(eq(reviewFlags.status, 'open'))
    .orderBy(reviewFlags.applicantId, desc(reviewFlags.createdAt));

  // For 동명이인/약어(ambiguous) flags, attach the source files/pages of each candidate name so the
  // reviewer can open the originals side by side. The candidate names are the flag's label
  // ("정민 / 정민호"); their sources live on person_aggregates.
  const ambiguousApps = [
    ...new Set(rows.filter((r) => r.flag.flagType === 'ambiguous').map((r) => r.flag.applicantId)),
  ];
  const sourcesByName = new Map<string, CandidateRef['sources']>();
  if (ambiguousApps.length > 0) {
    const aggs = await db
      .select({
        applicantId: personAggregates.applicantId,
        canonicalName: personAggregates.canonicalName,
        sources: personAggregates.sources,
      })
      .from(personAggregates)
      .where(inArray(personAggregates.applicantId, ambiguousApps));
    for (const a of aggs) {
      sourcesByName.set(
        `${a.applicantId}::${a.canonicalName}`,
        (a.sources ?? []).map((s) => ({
          documentId: s.documentId,
          filename: s.filename,
          docType: s.docType,
          page: s.page,
        })),
      );
    }
  }

  return rows.map((r) => {
    let candidates: CandidateRef[] | undefined;
    if (r.flag.flagType === 'ambiguous' && r.flag.label) {
      candidates = r.flag.label.split(' / ').map((name) => {
        const n = name.trim();
        return { name: n, sources: sourcesByName.get(`${r.flag.applicantId}::${n}`) ?? [] };
      });
    }
    return {
      flag: r.flag,
      applicantId: r.flag.applicantId,
      applicantName: r.applicantName,
      documentId: r.flag.documentId,
      filename: r.filename,
      sourceFormat: r.sourceFormat,
      personName: r.personName,
      bbox: r.bbox ?? null,
      candidates,
    };
  });
}
