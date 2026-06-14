import { describe, expect, it } from 'vitest';
import { assembleConflicts } from '@/lib/experts';
import type { Expert } from '@/db/schema';
import { nameKey } from '@/lib/names';

/** 테스트용 전문가 — nameKey는 name에서 자동 산출(운영과 동일 로직). */
function expert(id: string, name: string, affiliation: string, fields: Expert['fields'] = []): Expert {
  return {
    id,
    name,
    nameKey: nameKey(name),
    affiliation,
    position: '교수',
    email: `${id}@example.com`,
    phone: null,
    fields,
    registeredAt: '2026-01-01',
    createdAt: new Date(),
  };
}

describe('assembleConflicts (전문가 풀 제척 매칭)', () => {
  it('matches a related person to a pool expert by name', () => {
    const persons = [{ name: '홍길동', roles: ['supervisor' as const] }];
    const pool = [expert('1', '홍길동', '부산대학교'), expert('2', '김다른', '서울대학교')];
    const out = assembleConflicts(persons, pool);
    expect(out).toHaveLength(1);
    expect(out[0].expert.affiliation).toBe('부산대학교');
    expect(out[0].matchedNames).toEqual(['홍길동']);
    expect(out[0].roles).toEqual(['supervisor']);
    expect(out[0].homonymCount).toBe(1);
  });

  it('returns every homonym (재현율 우선) and flags the count', () => {
    const persons = [{ name: '한지우', roles: ['coauthor' as const] }];
    const pool = [
      expert('1', '한지우', 'A연구원'),
      expert('2', '한지우', 'B대학교'),
      expert('3', '한지우', 'C공사'),
      expert('9', '홍길동', 'Z청'),
    ];
    const out = assembleConflicts(persons, pool);
    expect(out).toHaveLength(3); // 동명이인 3명 모두 후보
    expect(out.every((c) => c.homonymCount === 3)).toBe(true);
  });

  it('normalizes inter-syllable spacing when matching (이 준 호 ↔ 이준호)', () => {
    const out = assembleConflicts(
      [{ name: '이 준 호', roles: ['committee' as const] }],
      [expert('1', '이준호', '한국환경연구원')],
    );
    expect(out).toHaveLength(1);
  });

  it('does not match different names, and ignores non-matching candidates', () => {
    const out = assembleConflicts(
      [{ name: '홍길동', roles: ['supervisor' as const] }],
      [expert('1', '정주영', '현대'), expert('2', '정주', '미상')],
    );
    expect(out).toHaveLength(0);
  });

  it('merges roles/names across related persons sharing one name key', () => {
    const persons = [
      { name: '김철수', roles: ['supervisor' as const] },
      { name: '김철수', roles: ['department_head' as const] },
    ];
    const out = assembleConflicts(persons, [expert('1', '김철수', '이화여자대학교')]);
    expect(out).toHaveLength(1);
    expect(new Set(out[0].roles)).toEqual(new Set(['supervisor', 'department_head']));
  });

  it('returns empty for no persons or no candidates', () => {
    expect(assembleConflicts([], [expert('1', '한지우', 'A')])).toHaveLength(0);
    expect(assembleConflicts([{ name: '한지우', roles: [] }], [])).toHaveLength(0);
  });
});
