import { describe, expect, it } from 'vitest';
import { filterExperts } from '@/lib/invite';
import type { Expert } from '@/db/schema';
import type { ExpertField } from '@/lib/domain';

const f = (dae: string, mid = '', sub = '', det = ''): ExpertField => ({ dae, mid, sub, det });

function ex(id: string, name: string, affiliation: string, fields: ExpertField[] = []): Expert {
  return {
    id,
    name,
    nameKey: `korean:${name}`,
    affiliation,
    position: '교수',
    email: `${id}@x.kr`,
    phone: null,
    fields,
    registeredAt: null,
    createdAt: new Date(),
  };
}

const POOL: Expert[] = [
  ex('1', '김기후', '서울대', [f('기후대기', '온실가스감축')]),
  ex('2', '이물국', '부산대', [f('물국토', '국토환경')]),
  ex('3', '박환경', '연세대', [f('기후대기', '대기환경')]),
  ex('4', '최제척', '고려대', [f('물국토', '해양환경')]),
  ex('5', '정담음', '카이스트', [f('기후대기', '온실가스감축')]),
];

const empty = { invitedIds: new Set<string>(), conflictedIds: new Set<string>() };

describe('filterExperts (섭외 후보 필터)', () => {
  it('excludes conflicted and already-invited experts', () => {
    const out = filterExperts(POOL, {
      invitedIds: new Set(['5']),
      conflictedIds: new Set(['4']),
    });
    expect(out.total).toBe(3);
    expect(out.items.map((e) => e.id).sort()).toEqual(['1', '2', '3']);
  });

  it('filters by 대분류 and 중분류', () => {
    expect(filterExperts(POOL, { ...empty, dae: '기후대기' }).total).toBe(3);
    expect(
      filterExperts(POOL, { ...empty, dae: '기후대기', mid: '온실가스감축' }).items.map((e) => e.id).sort(),
    ).toEqual(['1', '5']);
  });

  it('searches by name and affiliation (case-insensitive)', () => {
    expect(filterExperts(POOL, { ...empty, q: '부산' }).items.map((e) => e.id)).toEqual(['2']); // 소속
    expect(filterExperts(POOL, { ...empty, q: '박환' }).items.map((e) => e.id)).toEqual(['3']); // 이름
  });

  it('field search also matches the 대/중분류 path, not just name', () => {
    // '환경'은 국토환경(2)·대기환경(3)·해양환경(4) 분야에 걸린다 — 이름순 정렬.
    expect(filterExperts(POOL, { ...empty, q: '환경' }).items.map((e) => e.id)).toEqual([
      '3',
      '2',
      '4',
    ]);
  });

  it('searches within field sub/det text', () => {
    expect(filterExperts(POOL, { ...empty, q: '해양환경' }).items.map((e) => e.id)).toEqual(['4']);
  });

  it('sorts by name (ko) and caps to limit while reporting full total', () => {
    const out = filterExperts(POOL, { ...empty, limit: 2 });
    expect(out.total).toBe(5);
    expect(out.items).toHaveLength(2);
    expect(out.items[0].name).toBe('김기후'); // ㄱ 먼저
  });

  it('combines field filter + exclusion', () => {
    const out = filterExperts(POOL, {
      invitedIds: new Set(['1']),
      conflictedIds: new Set(),
      dae: '기후대기',
    });
    expect(out.items.map((e) => e.id).sort()).toEqual(['3', '5']);
  });
});
