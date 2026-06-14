import { count, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { experts, type Expert } from '@/db/schema';
import type { Role } from '@/lib/domain';
import { nameKey } from '@/lib/names';

/**
 * 전문가 풀 대조 — 지원자의 관계자(지도교수·심사위원·공저자·연구진)와 **이름(nameKey)이 일치**하는
 * 풀 전문가는 그 지원자 심사에서 제척 대상이다. 정책(사용자 확정): 재현율 우선 — 이름이 같으면 모두
 * 띄우고, 소속·분야·동명이인 수를 함께 보여 사람이 확정한다(자동 차단하지 않음). 이름 키가 같은 풀
 * 전문가가 여럿이면(동명이인) 모두 후보로 나온다.
 */
export interface ExpertConflict {
  expert: Expert;
  /** 이 전문가와 이름이 일치한 지원자 관계자 이름(들). */
  matchedNames: string[];
  /** 그 관계자들이 가진 역할(들). */
  roles: Role[];
  /** 같은 이름 키를 가진 풀 전문가 수 — 2 이상이면 동명이인 주의(다른 사람일 수 있음). */
  homonymCount: number;
}

/** 전문가 풀 등록 인원. 0이면 아직 미적재(대조 UI는 안내만 표시). */
export async function getExpertPoolCount(): Promise<number> {
  const db = getDb();
  const r = await db.select({ n: count() }).from(experts);
  return Number(r[0]?.n ?? 0);
}

/**
 * 순수 매칭 — 관계자 목록과 후보 전문가 배열을 받아 제척 후보를 조립한다(DB 무관, 단위 테스트 대상).
 * `candidates` 중 관계자와 이름 키가 같은 전문가만 남기고, 같은 키의 후보 수를 동명이인 수로 센다.
 * 운영에서는 인덱스 질의로 이미 좁혀진 후보를, 테스트에서는 손으로 만든 배열을 넘긴다.
 */
export function assembleConflicts(
  persons: Array<{ name: string; roles: Role[] }>,
  candidates: Expert[],
): ExpertConflict[] {
  const byKey = new Map<string, { names: Set<string>; roles: Set<Role> }>();
  for (const p of persons) {
    const key = nameKey(p.name);
    if (!key) continue;
    let ctx = byKey.get(key);
    if (!ctx) {
      ctx = { names: new Set(), roles: new Set() };
      byKey.set(key, ctx);
    }
    ctx.names.add(p.name);
    for (const r of p.roles) ctx.roles.add(r);
  }
  if (byKey.size === 0) return [];

  const matched = candidates.filter((e) => byKey.has(e.nameKey));
  // 같은 이름 키의 후보 전문가 수(동명이인 주의 표시용).
  const homonyms = new Map<string, number>();
  for (const e of matched) homonyms.set(e.nameKey, (homonyms.get(e.nameKey) ?? 0) + 1);

  return matched
    .map((expert) => {
      const ctx = byKey.get(expert.nameKey)!;
      return {
        expert,
        matchedNames: [...ctx.names],
        roles: [...ctx.roles],
        homonymCount: homonyms.get(expert.nameKey) ?? 1,
      };
    })
    .sort(
      (a, b) =>
        b.homonymCount - a.homonymCount || a.expert.name.localeCompare(b.expert.name, 'ko'),
    );
}

/** 관계자 목록을 풀과 대조해 제척 후보 전문가를 찾는다. 본인·제외(rejected) 관계자는 미리 거른 뒤 넘긴다. */
export async function findExpertConflicts(
  persons: Array<{ name: string; roles: Role[] }>,
): Promise<ExpertConflict[]> {
  const keys = [...new Set(persons.map((p) => nameKey(p.name)).filter(Boolean))];
  if (keys.length === 0) return [];

  const db = getDb();
  const matched = await db.select().from(experts).where(inArray(experts.nameKey, keys));
  return assembleConflicts(persons, matched);
}
