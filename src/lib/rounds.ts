import { inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { applicants, experts, jobs, personAggregates, type Expert } from '@/db/schema';
import {
  assembleConflicts,
  type CoiType,
  type ConflictPersonInput,
  type ConflictSource,
  type ExpertConflict,
} from '@/lib/experts';
import { filterExperts } from '@/lib/invite';
import { nameKey } from '@/lib/names';

/**
 * 회차(또는 사용자가 고른 면접 진출자) 단위 제척·섭외 — 인사팀 실사용 흐름.
 *
 * 지원자 1명 단위가 아니라 **선택한 지원자들의 제척 대상 합집합**을 전문가 풀에서 제거하고, 남은
 * (아무에게도 제척되지 않은) 전문가를 면접위원 섭외 후보로 제시한다. 전문가 풀(`experts`)은
 * `scripts/import-experts.ts` 로 **전체 교체** 적재되는 외부 명단으로, 추후 원장 추천 명단(같은 포맷)
 * 으로 교체해 그대로 사용할 수 있다 — 이 모듈은 항상 *현재 적재된 풀*을 대조 기준으로 쓴다.
 */

export interface RoundApplicant {
  id: string;
  name: string;
  externalId: string | null;
  fieldDae: string | null;
  fieldMid: string | null;
  jobStatus: string | null;
}

export interface RoundSummary {
  round: string | null;
  applicants: RoundApplicant[];
}

/** 제척된 전문가 1명에 대해, 어느 지원자와 왜 걸렸는지(지원자별 근거). */
export interface RoundConflictApplicant {
  applicantId: string;
  applicantName: string;
  matchedNames: string[];
  coiTypes: CoiType[];
  confidence: 'high' | 'low';
  sources: ConflictSource[];
}

/** 회차 합집합 제척 — 전문가 1명 × 그와 충돌한 모든 지원자. */
export interface RoundConflict {
  expert: Expert;
  /** 어느 한 지원자와라도 high 매칭이면 high(제척 확실성↑). */
  confidence: 'high' | 'low';
  homonymCount: number;
  byApplicant: RoundConflictApplicant[];
}

const jobStatusSub = sql<
  string | null
>`(select status from ${jobs} where json_extract(${jobs.payload}, '$.applicantId') = ${applicants.id} order by ${jobs.createdAt} desc limit 1)`;

/** 회차별 지원자 묶음(최신 회차 먼저, 미상은 맨 뒤). */
export async function getRounds(): Promise<RoundSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: applicants.id,
      name: applicants.name,
      externalId: applicants.externalId,
      round: applicants.recruitmentRound,
      fieldDae: applicants.fieldDae,
      fieldMid: applicants.fieldMid,
      jobStatus: jobStatusSub,
    })
    .from(applicants)
    .orderBy(applicants.name);

  const byRound = new Map<string, RoundApplicant[]>();
  for (const r of rows) {
    const key = r.round ?? '';
    if (!byRound.has(key)) byRound.set(key, []);
    byRound.get(key)!.push({
      id: r.id,
      name: r.name,
      externalId: r.externalId,
      fieldDae: r.fieldDae,
      fieldMid: r.fieldMid,
      jobStatus: r.jobStatus,
    });
  }
  return [...byRound.entries()]
    .sort((a, b) => {
      if (a[0] === '') return 1; // 미상 맨 뒤
      if (b[0] === '') return -1;
      return b[0].localeCompare(a[0]); // 최신 회차 먼저
    })
    .map(([round, apps]) => ({ round: round || null, applicants: apps }));
}

/** 한 회차의 지원자 목록(통합 뷰의 기본 스코프). */
export async function getRoundApplicants(round: string): Promise<RoundApplicant[]> {
  const all = await getRounds();
  return all.find((r) => (r.round ?? '') === round)?.applicants ?? [];
}

/**
 * 전문가별 제척을 지원자 간 합집합으로 병합(순수 — 단위 테스트 대상). 한 전문가가 여러 지원자와
 * 충돌하면 한 행으로 묶고 지원자별 근거를 누적한다. 정렬: 확인필요(low) 먼저 → 충돌 지원자 많은 순 →
 * 이름순(사람이 우선 검토할 순서).
 */
export function mergeRoundConflicts(
  perApplicant: Array<{ applicantId: string; applicantName: string; conflicts: ExpertConflict[] }>,
): RoundConflict[] {
  const byExpert = new Map<string, RoundConflict>();
  for (const { applicantId, applicantName, conflicts } of perApplicant) {
    for (const c of conflicts) {
      let rc = byExpert.get(c.expert.id);
      if (!rc) {
        rc = { expert: c.expert, confidence: 'low', homonymCount: c.homonymCount, byApplicant: [] };
        byExpert.set(c.expert.id, rc);
      }
      rc.byApplicant.push({
        applicantId,
        applicantName,
        matchedNames: c.matchedNames,
        coiTypes: c.coiTypes,
        confidence: c.confidence,
        sources: c.sources,
      });
      if (c.confidence === 'high') rc.confidence = 'high';
      rc.homonymCount = Math.max(rc.homonymCount, c.homonymCount);
    }
  }
  return [...byExpert.values()].sort(
    (a, b) =>
      Number(a.confidence === 'high') - Number(b.confidence === 'high') ||
      b.byApplicant.length - a.byApplicant.length ||
      a.expert.name.localeCompare(b.expert.name, 'ko'),
  );
}

/** 선택 지원자들의 관계자 × 현재 풀 → 전문가별 제척 합집합. 쿼리 2회(aggregates+experts). */
export async function getRoundConflicts(applicantIds: string[]): Promise<RoundConflict[]> {
  if (applicantIds.length === 0) return [];
  const db = getDb();
  const [apps, aggs] = await Promise.all([
    db
      .select({ id: applicants.id, name: applicants.name })
      .from(applicants)
      .where(inArray(applicants.id, applicantIds)),
    db
      .select({
        applicantId: personAggregates.applicantId,
        name: personAggregates.canonicalName,
        roles: personAggregates.roles,
        affiliation: personAggregates.affiliation,
        sources: personAggregates.sources,
        isSelf: personAggregates.isSelf,
        finalStatus: personAggregates.finalStatus,
      })
      .from(personAggregates)
      .where(inArray(personAggregates.applicantId, applicantIds)),
  ]);
  const appName = new Map(apps.map((a) => [a.id, a.name]));

  // 본인·제외(rejected) 관계자는 대조에서 뺀다(제척 입력 모집단과 동일 규칙).
  const byApp = new Map<string, ConflictPersonInput[]>();
  for (const a of aggs) {
    if (a.isSelf || a.finalStatus === 'rejected') continue;
    const list = byApp.get(a.applicantId) ?? [];
    list.push({ name: a.name, roles: a.roles, affiliation: a.affiliation, sources: a.sources });
    byApp.set(a.applicantId, list);
  }
  if (byApp.size === 0) return [];

  // 이름키가 일치하는 풀 전문가만 한 번에 로드(전 지원자 공통).
  const keys = [
    ...new Set(
      [...byApp.values()]
        .flat()
        .map((p) => nameKey(p.name))
        .filter(Boolean),
    ),
  ];
  const matched = keys.length
    ? await db.select().from(experts).where(inArray(experts.nameKey, keys))
    : [];

  return mergeRoundConflicts(
    [...byApp.entries()].map(([applicantId, persons]) => ({
      applicantId,
      applicantName: appName.get(applicantId) ?? applicantId,
      conflicts: assembleConflicts(persons, matched),
    })),
  );
}

/**
 * 통합 뷰 한 번 계산 — 제척 합집합(conflicts)과 섭외 가능 전문가(items)를 함께 반환한다.
 * conflicts 를 한 번만 계산해 두 패널·내보내기가 재사용한다(중복 쿼리 방지).
 * 섭외 가능 = 풀 − 제척 합집합, 분야(대/중)·이름·소속 검색 적용.
 */
export async function getRoundCandidates(opts: {
  applicantIds: string[];
  dae?: string | null;
  mid?: string | null;
  q?: string | null;
  limit?: number;
}): Promise<{
  conflicts: RoundConflict[];
  items: Expert[];
  total: number;
  excludedCount: number;
  poolTotal: number;
}> {
  const db = getDb();
  const [all, conflicts] = await Promise.all([
    db.select().from(experts),
    getRoundConflicts(opts.applicantIds),
  ]);
  const conflictedIds = new Set(conflicts.map((c) => c.expert.id));
  const { items, total } = filterExperts(all, {
    invitedIds: new Set(),
    conflictedIds,
    dae: opts.dae,
    mid: opts.mid,
    q: opts.q,
    limit: opts.limit,
  });
  return { conflicts, items, total, excludedCount: conflictedIds.size, poolTotal: all.length };
}
