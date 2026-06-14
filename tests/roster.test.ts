import { describe, expect, it } from 'vitest';
import {
  extractAuthorsFromText,
  extractInstitutionRoster,
  extractRosterFromText,
  mergeRoster,
} from '@/lib/pipeline/extract/roster';
import type { PageBundle, RawPerson } from '@/lib/pipeline/types';

const page = (n: number, text: string): PageBundle => ({ pageNumber: n, text, hasText: true });

// 실제 연구보고서 참여연구진 표가 pdfjs로 평탄화된 형태(7B VLM이 일부 누락하던 케이스).
const ROSTER_TEXT =
  '참여 연구진 소 속 연구분야 담당자 지오시스템리서치 연구사업 총괄 홍길동 ( 연구책임자 ) ' +
  '해외 해양생물자원 표본 확보 김철수 ( 연구원 ) 데이터베이스 구축 이영희 ( 보조원 ) ' +
  '국립한국해양대학교 데이터베이스 구축 박민수 ( 연구원 ) 표본 확보 정해린 ( 보조원 ) ' +
  '삼육대학교 표본 확보 오세훈 ( 연구원 ) 반출 지원 한지우 ( 보조원 )';

describe('extractRosterFromText (참여연구진 결정적 추출)', () => {
  it('extracts every 이름(역할) row a flattened table — incl. ones the VLM drops', () => {
    const roster = extractRosterFromText([page(2, ROSTER_TEXT)]);
    expect(roster.map((r) => r.nameRaw).sort()).toEqual(
      ['오세훈', '한지우', '정해린', '박민수', '김철수', '홍길동', '이영희'].sort(),
    );
    expect(roster.find((r) => r.nameRaw === '홍길동')?.role).toBe('principal_investigator');
    expect(roster.find((r) => r.nameRaw === '김철수')?.role).toBe('research_staff');
    expect(roster.every((r) => r.sourcePage === 2 && r.ocrEngine === 'roster:regex')).toBe(true);
  });

  it('tags the applicant themself via selfName', () => {
    const roster = extractRosterFromText([page(2, ROSTER_TEXT)], '김철수');
    expect(roster.find((r) => r.nameRaw === '김철수')?.isSelf).toBe(true);
    expect(roster.find((r) => r.nameRaw === '홍길동')?.isSelf).toBe(false);
  });

  it('upgrades to the higher-priority role when a name appears twice', () => {
    const roster = extractRosterFromText([
      page(1, '홍길동 ( 연구원 ) 홍길동 ( 연구책임자 )'),
    ]);
    expect(roster).toHaveLength(1);
    expect(roster[0].role).toBe('principal_investigator');
  });

  it('does not match a name without a parenthesized role', () => {
    expect(extractRosterFromText([page(1, '지도교수 김철수 심사위원 이영희')])).toHaveLength(0);
  });

  it('mergeRoster adds only names not already found by the VLM', () => {
    const vlm: RawPerson[] = [
      { nameRaw: '김철수', role: 'research_staff', sourceKind: 'printed', sourcePage: 2, confidence: 0.9 },
      { nameRaw: '정해린', role: 'research_staff', sourceKind: 'printed', sourcePage: 2, confidence: 0.9 },
    ];
    const roster = extractRosterFromText([page(2, ROSTER_TEXT)]);
    const merged = mergeRoster(vlm, roster);
    expect(merged).toHaveLength(7); // 기존 2 + 신규 5
    expect(merged.filter((p) => p.nameRaw === '김철수')).toHaveLength(1); // 중복 추가 없음
    expect(merged.some((p) => p.nameRaw === '홍길동')).toBe(true); // VLM 누락분 보강
  });
});

// 영문 논문 1페이지 저자 블록(위첨자 a,b,c 소속 마커 섞임) — 7B가 앞 몇 명만 읽고 끊던 케이스.
const PAPER =
  'Environmental Pollution 349 (2024) 123870 ' +
  'Improvement of the anthropogenic emission rate estimate in Ulaanbaatar, Mongolia, for 2020 – 21 winter ☆ ' +
  'Minsu Kim a , Jiwon Park a , Yongho Lee b , Bat-Erdene Lkhagva c , ' +
  'Wei Chen e , Mijin Han f , g , Jiyu Lee a , * ' +
  'a Department of Environmental Science and Engineering, Ewha Womans University, Seoul, South Korea ' +
  'b Department of Chemical Engineering and Materials Science, Ewha Womans University, Seoul, South Korea';

describe('extractAuthorsFromText (논문 저자 블록 결정적 추출)', () => {
  it('extracts the full author list, not the title/affiliations', () => {
    const names = extractAuthorsFromText([page(1, PAPER)]).map((p) => p.nameRaw);
    expect(names).toEqual([
      'Minsu Kim',
      'Jiwon Park',
      'Yongho Lee',
      'Bat-Erdene Lkhagva',
      'Wei Chen',
      'Mijin Han',
      'Jiyu Lee',
    ]);
    // 제목·지명·소속 토큰은 저자로 새지 않는다.
    for (const noise of ['Ulaanbaatar', 'Mongolia', 'Improvement', 'Korea', 'Ewha Womans', 'Department'])
      expect(names.some((n) => n.includes(noise))).toBe(false);
  });

  it('tags the applicant themself via selfName', () => {
    const out = extractAuthorsFromText([page(1, PAPER)], 'Wei Chen');
    expect(out.find((p) => p.nameRaw === 'Wei Chen')?.isSelf).toBe(true);
    expect(out.find((p) => p.nameRaw === 'Jiwon Park')?.isSelf).toBe(false);
    expect(out.every((p) => p.role === 'coauthor' && p.ocrEngine === 'authors:regex')).toBe(true);
  });

  it('merges with VLM output, adding only the authors it missed', () => {
    const vlm: RawPerson[] = [
      { nameRaw: 'Minsu Kim', role: 'coauthor', sourceKind: 'printed', sourcePage: 1, confidence: 0.9 },
      { nameRaw: 'Jiwon Park', role: 'coauthor', sourceKind: 'printed', sourcePage: 1, confidence: 0.9 },
      { nameRaw: 'Yongho Lee', role: 'coauthor', sourceKind: 'printed', sourcePage: 1, confidence: 0.9 },
    ];
    const merged = mergeRoster(vlm, extractAuthorsFromText([page(1, PAPER)]));
    expect(merged).toHaveLength(7); // 7B가 잡은 3 + 결정적 추출 보강 4
    expect(merged.some((p) => p.nameRaw === 'Bat-Erdene Lkhagva')).toBe(true);
  });

  it('returns nothing when there is no author-block pattern', () => {
    expect(extractAuthorsFromText([page(1, '지도교수 김철수 심사위원 이영희 박 민 수의 석사학위')])).toHaveLength(0);
  });
});

// 공동연구개발기관 등 표(이름 직위 전화 이메일 행) — 7B가 일부만 읽던 케이스.
const INST_TEXT =
  '공동연구 개발기관 등 기관명 책임자 직위 휴대전화 전자우편 역할 기관유형 ' +
  '(주)가나연구소 홍길동 대표 010-1111-2222 hong@gana.co.kr 공동 중소기업 ' +
  '서울대학교 김철수 교수 010-3333-4444 kim@snu.ac.kr 공동 대학 ' +
  '한국환경연구원 이영희 선임연구원 010-5555-6666 lee@kei.re.kr 공동 정부출연연';

describe('extractInstitutionRoster (공동연구개발기관 표)', () => {
  it('extracts name+title rows anchored by a following email', () => {
    const out = extractInstitutionRoster([page(1, INST_TEXT)]);
    expect(out.map((p) => p.nameRaw).sort()).toEqual(['김철수', '이영희', '홍길동'].sort());
    expect(out.every((p) => p.role === 'research_staff' && p.ocrEngine === 'institution:regex')).toBe(true);
  });

  it('does NOT match name+title without a following email (오탐 차단)', () => {
    expect(extractInstitutionRoster([page(1, '연구책임자 김철수 교수 입니다 본문')])).toHaveLength(0);
  });

  it('tags the applicant via selfName', () => {
    const out = extractInstitutionRoster([page(1, INST_TEXT)], '김철수');
    expect(out.find((p) => p.nameRaw === '김철수')?.isSelf).toBe(true);
    expect(out.find((p) => p.nameRaw === '홍길동')?.isSelf).toBe(false);
  });
});
