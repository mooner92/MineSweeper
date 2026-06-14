import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import {
  applicants,
  corrections,
  documents,
  extractedPersons,
  invitations,
  personAggregates,
  reviewFlags,
} from '@/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 지원자 삭제(사용자 확정 동작) — 추출 결과·문서·검토 플래그·초빙 명단을 모두 정리하고 업로드 폴더를
 * 제거한다. FK cascade에 의존하지 않고 자식 행을 명시적으로 지운다. 되돌릴 수 없으므로 UI에서 확인받는다.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const db = getDb();
  const id = params.id;
  const exists = (
    await db.select({ id: applicants.id }).from(applicants).where(eq(applicants.id, id)).limit(1)
  )[0];
  if (!exists) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const docs = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.applicantId, id));
  const docIds = docs.map((d) => d.id);
  if (docIds.length > 0) {
    await db.delete(extractedPersons).where(inArray(extractedPersons.documentId, docIds));
  }
  await db.delete(documents).where(eq(documents.applicantId, id));
  await db.delete(personAggregates).where(eq(personAggregates.applicantId, id));
  await db.delete(reviewFlags).where(eq(reviewFlags.applicantId, id));
  await db.delete(corrections).where(eq(corrections.applicantId, id));
  await db.delete(invitations).where(eq(invitations.applicantId, id));
  await db.delete(applicants).where(eq(applicants.id, id));

  // 업로드 폴더(있으면) 제거 — 경로는 DB가 정한 applicantId 디렉터리뿐이라 사용자 입력 아님.
  try {
    rmSync(join(process.env.UPLOAD_DIR ?? './data/uploads', id), { recursive: true, force: true });
  } catch {
    /* 폴더가 이미 없으면 무시 */
  }
  return NextResponse.json({ ok: true });
}
