import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  experts,
  roundExperts,
  roundPools,
  type Expert,
  type RoundExpert,
  type RoundPool,
} from '@/db/schema';
import type { ParsedExpert } from '@/lib/expert-import';

/**
 * 회차별 면접 감독관(면접위원 후보) 명단 — 한 회차에 대해 업로드한 xlsx를 저장하고, 그 회차의 제척·섭외
 * 대조 기준 풀로 쓴다. 회차 명단이 없으면 전역 `experts` 풀로 폴백한다(기존 동작 유지).
 */

export interface RoundPoolView {
  experts: Expert[];
  /** 'round' = 이 회차 전용 업로드 명단 / 'global' = 전역 전문가 풀 폴백. */
  source: 'round' | 'global';
  meta: RoundPool | null;
}

/** round_experts 행 → Expert 형태(제척/섭외 로직이 Expert[]를 받으므로). */
function toExpert(re: RoundExpert): Expert {
  return {
    id: re.id,
    name: re.name,
    nameKey: re.nameKey,
    affiliation: re.affiliation,
    position: re.position,
    email: re.email,
    phone: re.phone,
    fields: re.fields,
    registeredAt: re.registeredAt,
    createdAt: re.createdAt,
  };
}

/** 회차 대조 기준 풀 — 회차 명단이 있으면 그것을, 없으면 전역 experts 풀. */
export async function getRoundPool(round: string): Promise<RoundPoolView> {
  const db = getDb();
  const meta = (await db.select().from(roundPools).where(eq(roundPools.round, round)))[0] ?? null;
  if (meta && meta.count > 0) {
    const rows = await db.select().from(roundExperts).where(eq(roundExperts.round, round));
    return { experts: rows.map(toExpert), source: 'round', meta };
  }
  const all = await db.select().from(experts);
  return { experts: all, source: 'global', meta: null };
}

/** 회차 명단 메타만(업로드 상태 표시용). */
export async function getRoundPoolMeta(round: string): Promise<RoundPool | null> {
  const db = getDb();
  return (await db.select().from(roundPools).where(eq(roundPools.round, round)))[0] ?? null;
}

/** 회차 명단 저장(전체 교체) — 그 회차분 삭제 후 삽입 + 메타 upsert. */
export async function saveRoundPool(
  round: string,
  rows: ParsedExpert[],
  filename: string,
): Promise<RoundPool> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.delete(roundExperts).where(eq(roundExperts.round, round));
    const values = rows.map((r) => ({
      round,
      name: r.name,
      nameKey: r.nameKey,
      affiliation: r.affiliation,
      position: r.position,
      email: r.email,
      phone: r.phone,
      fields: r.fields,
      registeredAt: r.registeredAt,
    }));
    for (let i = 0; i < values.length; i += 100) {
      await tx.insert(roundExperts).values(values.slice(i, i + 100));
    }
    await tx.delete(roundPools).where(eq(roundPools.round, round));
    const [meta] = await tx
      .insert(roundPools)
      .values({ round, filename, count: values.length, uploadedAt: new Date() })
      .returning();
    return meta;
  });
}

/** 회차 명단 삭제(전역 풀로 되돌림). */
export async function clearRoundPool(round: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(roundExperts).where(eq(roundExperts.round, round));
    await tx.delete(roundPools).where(eq(roundPools.round, round));
  });
}
