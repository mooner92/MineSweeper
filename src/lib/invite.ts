import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  applicants,
  experts,
  invitations,
  personAggregates,
  type Expert,
  type Invitation,
} from '@/db/schema';
import { findExpertConflicts } from '@/lib/experts';

/**
 * 초빙(섭외) 워크플로 — 인사팀이 전문가 풀에서 면접위원 후보를 골라 담는다. 후보에서는 제척 대상
 * (관계자와 이름 일치)과 이미 담은 인원을 제외한다. 담는 순간 전문가 정보를 스냅샷으로 박아 명단이
 * 풀 변경에 영향받지 않게 한다(변질 방지). 삭제는 soft delete로 이력을 남긴다.
 */

/** 전문가 풀 분류체계(대분류 → 중분류 목록) — 섭외 후보 필터 드롭다운용. */
export async function getExpertCategories(): Promise<Array<{ dae: string; mids: string[] }>> {
  const db = getDb();
  const rows = await db.select({ fields: experts.fields }).from(experts);
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const f of r.fields) {
      if (!f.dae) continue;
      if (!map.has(f.dae)) map.set(f.dae, new Set());
      if (f.mid) map.get(f.dae)!.add(f.mid);
    }
  }
  return [...map]
    .map(([dae, mids]) => ({ dae, mids: [...mids].sort((a, b) => a.localeCompare(b, 'ko')) }))
    .sort((a, b) => a.dae.localeCompare(b.dae, 'ko'));
}

/** 이 지원자의 제척 대상 전문가 ID 집합(관계자와 이름이 일치하는 풀 전문가) — 섭외 후보에서 제외. */
export async function getConflictedExpertIds(applicantId: string): Promise<Set<string>> {
  const db = getDb();
  const aggs = await db
    .select({
      name: personAggregates.canonicalName,
      roles: personAggregates.roles,
      isSelf: personAggregates.isSelf,
      finalStatus: personAggregates.finalStatus,
    })
    .from(personAggregates)
    .where(eq(personAggregates.applicantId, applicantId));
  const persons = aggs
    .filter((a) => !a.isSelf && a.finalStatus !== 'rejected')
    .map((a) => ({ name: a.name, roles: a.roles }));
  const conflicts = await findExpertConflicts(persons);
  return new Set(conflicts.map((c) => c.expert.id));
}

export interface CandidateQuery {
  applicantId: string;
  dae?: string | null;
  mid?: string | null;
  q?: string | null;
  limit?: number;
}

/**
 * 순수 후보 필터(DB 무관, 단위 테스트 대상) — 제척·기담음 제외 후 분야(대/중분류)·이름·소속·분야명
 * 검색을 적용하고 이름순으로 상위 limit명만 반환한다. total은 자른 뒤가 아니라 필터 후 전체 수.
 */
export function filterExperts(
  all: Expert[],
  opts: {
    invitedIds: Set<string>;
    conflictedIds: Set<string>;
    dae?: string | null;
    mid?: string | null;
    q?: string | null;
    limit?: number;
  },
): { items: Expert[]; total: number } {
  const { invitedIds, conflictedIds, dae, mid, q, limit = 60 } = opts;
  const ql = (q ?? '').trim().toLowerCase();
  let pool = all.filter((e) => !invitedIds.has(e.id) && !conflictedIds.has(e.id));
  if (dae) pool = pool.filter((e) => e.fields.some((f) => f.dae === dae));
  if (mid) pool = pool.filter((e) => e.fields.some((f) => f.mid === mid));
  if (ql) {
    pool = pool.filter(
      (e) =>
        e.name.toLowerCase().includes(ql) ||
        (e.affiliation ?? '').toLowerCase().includes(ql) ||
        e.fields.some((f) => `${f.dae} ${f.mid} ${f.sub} ${f.det}`.toLowerCase().includes(ql)),
    );
  }
  const total = pool.length;
  pool.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { items: pool.slice(0, limit), total };
}

/** 섭외 후보 검색 — 제척·기담음 제외, 분야(대/중분류)·이름·소속·분야명 검색. 상위 limit명만 반환. */
export async function getInviteCandidates(
  opts: CandidateQuery,
): Promise<{ items: Expert[]; total: number }> {
  const { applicantId, dae, mid, q, limit = 60 } = opts;
  const db = getDb();
  const [all, invited, conflictedIds] = await Promise.all([
    db.select().from(experts),
    getInvitations(applicantId),
    getConflictedExpertIds(applicantId),
  ]);
  return filterExperts(all, {
    invitedIds: new Set(invited.map((i) => i.expertId)),
    conflictedIds,
    dae,
    mid,
    q,
    limit,
  });
}

/** 지원자의 활성 초빙 명단(담은 순서). */
export async function getInvitations(applicantId: string): Promise<Invitation[]> {
  const db = getDb();
  return db
    .select()
    .from(invitations)
    .where(and(eq(invitations.applicantId, applicantId), isNull(invitations.removedAt)))
    .orderBy(invitations.createdAt);
}

/** 풀 전문가를 초빙 명단에 담는다(스냅샷 저장). 이미 활성이면 무시. */
export async function addInvitation(applicantId: string, expertId: string): Promise<void> {
  const db = getDb();
  const existing = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.applicantId, applicantId),
        eq(invitations.expertId, expertId),
        isNull(invitations.removedAt),
      ),
    );
  if (existing.length > 0) return;
  const e = (await db.select().from(experts).where(eq(experts.id, expertId)))[0];
  if (!e) throw new Error(`expert not found: ${expertId}`);
  await db.insert(invitations).values({
    applicantId,
    expertId,
    name: e.name,
    affiliation: e.affiliation,
    position: e.position,
    email: e.email,
    phone: e.phone,
    fields: e.fields,
  });
}

/** 초빙 명단에서 뺀다(soft delete — 이력 보존). */
export async function removeInvitation(applicantId: string, expertId: string): Promise<void> {
  const db = getDb();
  await db
    .update(invitations)
    .set({ removedAt: new Date() })
    .where(
      and(
        eq(invitations.applicantId, applicantId),
        eq(invitations.expertId, expertId),
        isNull(invitations.removedAt),
      ),
    );
}

/** 섭외 후보 기본 필터로 쓸 지원자 분야를 저장(재방문 시 유지). */
export async function setApplicantField(
  applicantId: string,
  dae: string | null,
  mid: string | null,
): Promise<void> {
  const db = getDb();
  await db
    .update(applicants)
    .set({ fieldDae: dae, fieldMid: mid })
    .where(eq(applicants.id, applicantId));
}
