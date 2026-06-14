import { describe, expect, it } from 'vitest';
import {
  buildTextWindow,
  parseVlmResponse,
  selectPagesForExtraction,
} from '@/lib/pipeline/extract/vlm';
import type { PageBundle } from '@/lib/pipeline/types';

describe('selectPagesForExtraction (문서유형별 추출 페이지 선택)', () => {
  const pg = (n: number): PageBundle => ({ pageNumber: n, text: `p${n}`, hasText: true });

  it('논문은 앞 2페이지만 — 본문·참고문헌 노이즈 제거(저자 0명 회귀 방지)', () => {
    const pages = [1, 2, 3, 8, 9, 10, 11, 12].map(pg); // 12쪽 논문 전체 윈도우
    expect(selectPagesForExtraction(pages, 'journal_article').map((p) => p.pageNumber)).toEqual([
      1, 2,
    ]);
    expect(
      selectPagesForExtraction(pages, 'representative_research').map((p) => p.pageNumber),
    ).toEqual([1, 2]);
  });

  it('연구보고서는 앞+뒤 모두 유지 — 참여연구진이 맨 뒤에 올 수 있다', () => {
    const pages = [1, 2, 3, 47, 48, 49, 50].map(pg);
    expect(selectPagesForExtraction(pages, 'research_project').map((p) => p.pageNumber)).toEqual([
      1, 2, 3, 47, 48, 49, 50,
    ]);
  });

  it('학위논문은 뒤 윈도우를 빼고 앞쪽 연속 구간만 — 인준/심사위원은 앞에 있다', () => {
    const pages = [1, 2, 3, 78, 79, 80].map(pg); // page 3 다음 점프(gap) = 뒤 윈도우 시작
    expect(selectPagesForExtraction(pages, 'degree_thesis').map((p) => p.pageNumber)).toEqual([
      1, 2, 3,
    ]);
  });

  it('짧은 문서(연속 페이지)는 그대로 유지', () => {
    const pages = [1, 2].map(pg);
    expect(selectPagesForExtraction(pages, 'journal_article').map((p) => p.pageNumber)).toEqual([
      1, 2,
    ]);
  });
});

describe('parseVlmResponse (A1 — 항목별 관용 파싱)', () => {
  it('keeps every well-formed person', () => {
    const raw = JSON.stringify({
      persons: [
        { name: 'Wei Chen', role: 'coauthor', page: 1, confidence: 0.9, is_self: false },
        { name: '홍길동', role: 'supervisor', affiliation: 'A대학교', page: 2, confidence: 0.8 },
      ],
    });
    const r = parseVlmResponse(raw);
    expect(r.persons.map((p) => p.name)).toEqual(['Wei Chen', '홍길동']);
    expect(r.dropped).toBe(0);
    expect(r.salvaged).toBe(false);
  });

  it('coerces string numbers (page:"1", confidence:"0.9") instead of dropping the item', () => {
    const raw = JSON.stringify({
      persons: [{ name: '홍길동', role: 'coauthor', page: '3', confidence: '0.85' }],
    });
    const r = parseVlmResponse(raw);
    expect(r.persons[0].page).toBe(3);
    expect(r.persons[0].confidence).toBe(0.85);
    expect(r.dropped).toBe(0);
  });

  it('drops ONLY malformed items — the old all-or-nothing parse returned [] for the whole doc', () => {
    const raw = JSON.stringify({
      persons: [{ name: '' }, { name: 'Wei Chen', role: 'coauthor' }, { role: 'coauthor' }, 'garbage'],
    });
    const r = parseVlmResponse(raw);
    expect(r.persons.map((p) => p.name)).toEqual(['Wei Chen']);
    expect(r.dropped).toBe(3);
  });

  it('tolerates a boolean-ish is_self string and null-ish optional fields', () => {
    const raw = JSON.stringify({
      persons: [{ name: '홍길동', role: null, affiliation: null, page: null, is_self: 'true' }],
    });
    const r = parseVlmResponse(raw);
    expect(r.persons[0].isSelf).toBe(true);
    expect(r.persons[0].role).toBeNull();
    expect(r.dropped).toBe(0);
  });

  it('accepts a bare top-level array', () => {
    const raw = JSON.stringify([{ name: 'A' }, { name: 'B' }]);
    expect(parseVlmResponse(raw).persons.map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('accepts an alternate array key ({"people": [...]}) and a single person object', () => {
    expect(parseVlmResponse('{"people":[{"name":"A"}]}').persons.map((p) => p.name)).toEqual(['A']);
    expect(parseVlmResponse('{"name":"홍길동","role":"supervisor"}').persons[0].name).toBe('홍길동');
  });

  it('accepts ```json fenced responses', () => {
    const raw = '결과입니다:\n```json\n{"persons":[{"name":"홍길동"}]}\n```';
    expect(parseVlmResponse(raw).persons.map((p) => p.name)).toEqual(['홍길동']);
  });

  it('returns empty (no throw) for a legitimate empty list', () => {
    const r = parseVlmResponse('{"persons":[]}');
    expect(r.persons).toEqual([]);
    expect(r.dropped).toBe(0);
    expect(r.unrecognized).toBe(false); // 정상적인 "없음" 응답 — 경고 대상 아님
  });

  it('flags a valid-JSON NON-person response ({"error":...}) as unrecognized — no silent 0명', () => {
    const r = parseVlmResponse('{"error":"context length exceeded"}');
    expect(r.persons).toEqual([]);
    expect(r.unrecognized).toBe(true); // caller가 warn 로그
  });

  it('does not flag an empty object or null as unrecognized', () => {
    expect(parseVlmResponse('{}').unrecognized).toBe(false);
    expect(parseVlmResponse('null').unrecognized).toBe(false);
  });

  it('prefers a NAMED person-list key over the first array property', () => {
    const r = parseVlmResponse('{"notes":[],"people":[{"name":"A"}]}');
    expect(r.persons.map((p) => p.name)).toEqual(['A']); // "notes" 빈 배열에 속지 않음
  });

  it('salvages complete persons from truncated JSON (A2 — 18저자 잘림 케이스)', () => {
    const full = JSON.stringify({
      persons: Array.from({ length: 18 }, (_, i) => ({
        name: `Author ${i + 1}`,
        role: 'coauthor',
        page: 1,
        confidence: 0.9,
      })),
    });
    const truncated = full.slice(0, Math.floor(full.length / 2)); // cut mid-array
    const r = parseVlmResponse(truncated);
    expect(r.salvaged).toBe(true);
    expect(r.persons.length).toBeGreaterThanOrEqual(5);
    expect(r.persons[0].name).toBe('Author 1');
  });

  it('throws on unrecoverable garbage so the caller LOGS instead of silently reporting 0명', () => {
    expect(() => parseVlmResponse('MODEL ERROR: something went wrong')).toThrow(/JSON 파싱 실패/);
  });
});

describe('buildTextWindow (입력 윈도우 — 앞/뒤 예산 분할)', () => {
  const page = (pageNumber: number, text: string): PageBundle => ({
    pageNumber,
    text,
    hasText: text.length > 0,
  });

  it('keeps short docs whole, with [p.N] page tags and no 중략 marker', () => {
    const out = buildTextWindow([page(1, '저자: 홍길동'), page(2, '본문')], 12000);
    expect(out).toContain('[p.1]');
    expect(out).toContain('[p.2]');
    expect(out).toContain('본문');
    expect(out).not.toContain('중략');
  });

  it('skips empty pages without emitting tags for them', () => {
    const out = buildTextWindow([page(1, ''), page(2, '텍스트')], 12000);
    expect(out).not.toContain('[p.1]');
    expect(out).toContain('[p.2]');
  });

  it('marks the gap between non-contiguous (front/back windowed) pages', () => {
    const out = buildTextWindow(
      [page(1, 'a'), page(8, 'b'), page(47, '참여연구진 명단'), page(50, 'z')],
      12000,
    );
    expect(out).toContain('…(9~46쪽 생략)…');
    expect(out).toContain('[p.47]');
    expect(out).toContain('참여연구진 명단');
  });

  it('splits the char budget head/tail when over maxChars — the tail survives', () => {
    const head = 'H'.repeat(900);
    const tail = `참여연구원 김철수 ${'T'.repeat(880)}`;
    const out = buildTextWindow([page(1, head), page(2, 'M'.repeat(5000)), page(3, tail)], 1000);
    expect(out.length).toBeLessThanOrEqual(1000);
    expect(out).toContain('HHHHH'); // head preserved
    expect(out).toContain('…(중략)…');
    expect(out.endsWith('T'.repeat(10))).toBe(true); // END of document preserved (old code cut it)
  });
});
