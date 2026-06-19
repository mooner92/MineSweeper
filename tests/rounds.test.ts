import { describe, expect, it } from 'vitest';
import { mergeRoundConflicts } from '@/lib/rounds';
import type { ExpertConflict } from '@/lib/experts';
import type { Expert } from '@/db/schema';

function expert(id: string, name: string): Expert {
  return {
    id,
    name,
    nameKey: name,
    affiliation: null,
    position: null,
    email: null,
    phone: null,
    fields: [],
    registeredAt: null,
    createdAt: new Date(0),
  };
}

function conflict(e: Expert, confidence: 'high' | 'low', matched: string): ExpertConflict {
  return {
    expert: e,
    matchedNames: [matched],
    roles: ['coauthor'],
    coiTypes: [{ code: 'A', label: '공저' }],
    homonymCount: confidence === 'low' ? 2 : 1,
    confidence,
    sources: [],
  };
}

describe('mergeRoundConflicts — 회차 합집합 병합(순수)', () => {
  it('같은 전문가가 여러 지원자와 충돌하면 한 행으로 묶고 지원자별 근거를 누적한다', () => {
    const e1 = expert('e1', '김연구');
    const e2 = expert('e2', '이전문');
    const out = mergeRoundConflicts([
      {
        applicantId: 'a1',
        applicantName: '지원자A',
        conflicts: [conflict(e1, 'low', '김연구'), conflict(e2, 'high', '이전문')],
      },
      { applicantId: 'a2', applicantName: '지원자B', conflicts: [conflict(e1, 'high', '김연구')] },
    ]);
    const merged = out.find((c) => c.expert.id === 'e1')!;
    expect(merged.byApplicant.map((a) => a.applicantName).sort()).toEqual(['지원자A', '지원자B']);
    // 한 명이라도 high 매칭이면 전체 판정은 high(제척 확실성↑).
    expect(merged.confidence).toBe('high');
    expect(out.find((c) => c.expert.id === 'e2')!.byApplicant).toHaveLength(1);
  });

  it('정렬: 확인필요(low) 먼저 → 충돌 지원자 많은 순', () => {
    const low = expert('low', '확인필요');
    const h1 = expert('h1', '확정일');
    const h2 = expert('h2', '확정이');
    const out = mergeRoundConflicts([
      {
        applicantId: 'a1',
        applicantName: 'A',
        conflicts: [conflict(low, 'low', 'x'), conflict(h1, 'high', 'y'), conflict(h2, 'high', 'z')],
      },
      { applicantId: 'a2', applicantName: 'B', conflicts: [conflict(h2, 'high', 'z')] },
    ]);
    expect(out[0].expert.id).toBe('low'); // 확인 필요 먼저
    // high 중에서는 충돌 지원자가 더 많은 h2(2명)가 h1(1명)보다 먼저.
    expect(out.filter((c) => c.confidence === 'high').map((c) => c.expert.id)).toEqual(['h2', 'h1']);
  });

  it('빈 입력 → 빈 결과', () => {
    expect(mergeRoundConflicts([])).toEqual([]);
  });
});
