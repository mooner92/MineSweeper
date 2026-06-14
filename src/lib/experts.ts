import { count, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { experts, type Expert } from '@/db/schema';
import { sharedInstitution } from '@/lib/checks';
import type { DocType, Role, SourceRef } from '@/lib/domain';
import { nameKey } from '@/lib/names';

/**
 * 전문가 풀 대조 — 지원자의 관계자(지도교수·심사위원·공저자·연구진)와 **이름(nameKey)이 일치**하는
 * 풀 전문가는 그 지원자 심사에서 제척 대상이다. 정책(사용자 확정): 재현율 우선 — 이름이 같으면 모두
 * 띄우고, **유형(COI 타입)·근거(문서·페이지)·동명이인 신뢰도**를 함께 보여 사람이 확정한다(자동 차단 없음).
 *
 * 표준 벤치마킹(NSF PAPPG COA / NIH / COPE): 제척을 '이름 일치'가 아니라 '유형이 있는 사유'로 다룬다.
 */
export interface CoiType {
  /** NSF식 코드 — G(사제)·A(공저)·C(공동과제)·R(심사). 산출물/필터용. */
  code: string;
  label: string;
}

/** 역할 → 제척 유형. 미정의 역할은 '유형 미상'(강제 분류 금지). */
const ROLE_COI: Partial<Record<Role, CoiType>> = {
  supervisor: { code: 'G', label: '사제(지도)' },
  co_supervisor: { code: 'G', label: '사제(부지도)' },
  committee: { code: 'R', label: '심사' },
  department_head: { code: 'R', label: '심사(학과장)' },
  principal_investigator: { code: 'C', label: '공동과제' },
  project_manager: { code: 'C', label: '공동과제' },
  research_staff: { code: 'C', label: '공동연구' },
  coauthor: { code: 'A', label: '공저' },
};

/** 역할 집합 → 중복 없는 COI 유형 목록(코드 기준 dedup). */
export function coiTypesFromRoles(roles: Role[]): CoiType[] {
  const byCode = new Map<string, CoiType>();
  for (const r of roles) {
    const t = ROLE_COI[r] ?? { code: '?', label: '유형 미상' };
    if (!byCode.has(t.code)) byCode.set(t.code, t);
  }
  return [...byCode.values()];
}

/** 제척 근거 — 어느 문서 몇 쪽에서 어떤 역할로 일치했는지(원문 링크·점프용). */
export interface ConflictSource {
  documentId: string;
  page: number;
  docType: DocType;
  role: Role;
}

export interface ExpertConflict {
  expert: Expert;
  /** 이 전문가와 이름이 일치한 지원자 관계자 이름(들). */
  matchedNames: string[];
  /** 그 관계자들이 가진 역할(들). */
  roles: Role[];
  /** 역할에서 도출한 제척 유형(들). */
  coiTypes: CoiType[];
  /** 같은 이름 키를 가진 풀 전문가 수 — 2 이상이면 동명이인 주의(다른 사람일 수 있음). */
  homonymCount: number;
  /**
   * 매칭 신뢰도. high = 풀에 이름이 유일하거나(homonym=1) 소속이 일치(부차증거). low = 동명이인인데
   * 소속 등 부차증거가 없음 → '확인 필요'(다른 사람일 수 있어 사람이 직접 대조). 자동 차단 아님.
   */
  confidence: 'high' | 'low';
  /** 왜 걸렸나 — 근거 출처(문서·페이지·역할). 최대 몇 건. */
  sources: ConflictSource[];
}

/** 관계자 입력 — 이름·역할에 더해 소속(신뢰도)·출처(근거)를 함께 받는다. */
export interface ConflictPersonInput {
  name: string;
  roles: Role[];
  affiliation?: string | null;
  sources?: SourceRef[];
}

/** 전문가 풀 등록 인원. 0이면 아직 미적재(대조 UI는 안내만 표시). */
export async function getExpertPoolCount(): Promise<number> {
  const db = getDb();
  const r = await db.select({ n: count() }).from(experts);
  return Number(r[0]?.n ?? 0);
}

interface KeyCtx {
  names: Set<string>;
  roles: Set<Role>;
  affiliations: Set<string>;
  sources: SourceRef[];
}

/**
 * 순수 매칭 — 관계자 목록과 후보 전문가 배열을 받아 제척 후보를 조립한다(DB 무관, 단위 테스트 대상).
 * 이름 키가 같은 전문가만 남기고, 유형·근거·동명이인 신뢰도를 채운다.
 */
export function assembleConflicts(
  persons: ConflictPersonInput[],
  candidates: Expert[],
): ExpertConflict[] {
  const byKey = new Map<string, KeyCtx>();
  for (const p of persons) {
    const key = nameKey(p.name);
    if (!key) continue;
    let ctx = byKey.get(key);
    if (!ctx) {
      ctx = { names: new Set(), roles: new Set(), affiliations: new Set(), sources: [] };
      byKey.set(key, ctx);
    }
    ctx.names.add(p.name);
    for (const r of p.roles) ctx.roles.add(r);
    if (p.affiliation) ctx.affiliations.add(p.affiliation);
    for (const s of p.sources ?? []) ctx.sources.push(s);
  }
  if (byKey.size === 0) return [];

  const matched = candidates.filter((e) => byKey.has(e.nameKey));
  // 같은 이름 키의 후보 전문가 수(동명이인 주의 표시용).
  const homonyms = new Map<string, number>();
  for (const e of matched) homonyms.set(e.nameKey, (homonyms.get(e.nameKey) ?? 0) + 1);

  return matched
    .map((expert): ExpertConflict => {
      const ctx = byKey.get(expert.nameKey)!;
      const homonymCount = homonyms.get(expert.nameKey) ?? 1;
      // 부차증거: 풀 전문가 소속과 관계자 소속이 같은 기관이면 '진짜 그 사람'일 확률↑.
      const corroborated = [...ctx.affiliations].some(
        (aff) => sharedInstitution([aff], expert.affiliation) !== null,
      );
      const roles = [...ctx.roles];
      return {
        expert,
        matchedNames: [...ctx.names],
        roles,
        coiTypes: coiTypesFromRoles(roles),
        homonymCount,
        confidence: homonymCount === 1 || corroborated ? 'high' : 'low',
        sources: dedupeSources(ctx.sources).slice(0, 3),
      };
    })
    .sort(
      (a, b) =>
        // 확인 필요(low)를 먼저 보여 사람이 우선 검토 → 동명이인 많은 순 → 이름순.
        Number(a.confidence === 'high') - Number(b.confidence === 'high') ||
        b.homonymCount - a.homonymCount ||
        a.expert.name.localeCompare(b.expert.name, 'ko'),
    );
}

function dedupeSources(sources: SourceRef[]): ConflictSource[] {
  const seen = new Set<string>();
  const out: ConflictSource[] = [];
  for (const s of sources) {
    const k = `${s.documentId}:${s.page}:${s.role}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ documentId: s.documentId, page: s.page, docType: s.docType, role: s.role });
  }
  return out;
}

/** 관계자 목록을 풀과 대조해 제척 후보 전문가를 찾는다. 본인·제외(rejected) 관계자는 미리 거른 뒤 넘긴다. */
export async function findExpertConflicts(
  persons: ConflictPersonInput[],
): Promise<ExpertConflict[]> {
  const keys = [...new Set(persons.map((p) => nameKey(p.name)).filter(Boolean))];
  if (keys.length === 0) return [];

  const db = getDb();
  const matched = await db.select().from(experts).where(inArray(experts.nameKey, keys));
  return assembleConflicts(persons, matched);
}
