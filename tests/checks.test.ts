import { describe, expect, it } from 'vitest';
import { buildApplicantChecks, sharedInstitution } from '@/lib/checks';
import type { SourceFormat } from '@/lib/domain';

describe('sharedInstitution (동일 소속기관 추정)', () => {
  it('matches same university across different departments (기관형 토큰 공유)', () => {
    expect(
      sharedInstitution(['서울대학교 환경대학원'], '서울대학교 지구환경과학부'),
    ).toBe('서울대학교');
  });

  it('matches institution + sub-division by prefix (접두 일치)', () => {
    expect(sharedInstitution(['한국환경연구원'], '한국환경연구원 물국토연구본부')).toBe(
      '한국환경연구원',
    );
  });

  it('does NOT match different universities sharing a department name', () => {
    expect(sharedInstitution(['서울대학교 환경대학원'], '부산대학교 환경대학원')).toBeNull();
  });

  it('ignores bare job-title tokens like "연구원"', () => {
    expect(sharedInstitution(['한국환경연구원'], '책임 연구원')).toBeNull();
  });

  it('matches identical English affiliations, but not partial English overlap', () => {
    expect(
      sharedInstitution(['Seoul National University'], 'Seoul National University'),
    ).toBe('Seoul National University');
    expect(sharedInstitution(['Seoul National University'], 'Seoul Institute')).toBeNull();
  });

  it('returns null for empty/missing affiliations', () => {
    expect(sharedInstitution([], '서울대학교')).toBeNull();
    expect(sharedInstitution(['서울대학교'], null)).toBeNull();
    expect(sharedInstitution([null, undefined, ''], '서울대학교')).toBeNull();
  });
});

describe('buildApplicantChecks (지원자 단위 자동 점검)', () => {
  const doc = (
    id: string,
    opts: { format?: 'pdf' | 'hwp' | 'text' | 'image'; hasText?: boolean } = {},
  ) => ({
    id,
    filename: `${id}.pdf`,
    sourceFormat: (opts.format ?? 'pdf') as SourceFormat,
    hasTextLayer: opts.hasText ?? true,
  });

  it('warns when the applicant themself was never identified (본인 미식별)', () => {
    const checks = buildApplicantChecks({
      documents: [doc('d1')],
      peopleByDoc: new Map([['d1', 3]]),
      selfNames: [],
      reviewCount: 0,
      openFlags: 0,
      sameAffiliationCount: 0,
    });
    expect(checks.find((c) => c.id === 'self')?.level).toBe('warn');
  });

  it('warns on zero-person TEXT documents and lists their filenames', () => {
    const checks = buildApplicantChecks({
      documents: [doc('d1'), doc('d2')],
      peopleByDoc: new Map([['d1', 2]]), // d2 = 텍스트 있는데 0명
      selfNames: ['홍길동'],
      reviewCount: 0,
      openFlags: 0,
      sameAffiliationCount: 0,
    });
    const cov = checks.find((c) => c.id === 'coverage');
    expect(cov?.level).toBe('warn');
    expect(cov?.detail).toContain('d2.pdf');
  });

  it('does NOT count scanned/image docs as coverage failures — reports them separately', () => {
    const checks = buildApplicantChecks({
      documents: [doc('d1'), doc('scan', { hasText: false }), doc('img', { format: 'image', hasText: false })],
      peopleByDoc: new Map([['d1', 1]]),
      selfNames: ['홍길동'],
      reviewCount: 0,
      openFlags: 0,
      sameAffiliationCount: 0,
    });
    expect(checks.find((c) => c.id === 'coverage')?.level).toBe('pass');
    const vision = checks.find((c) => c.id === 'vision');
    expect(vision?.level).toBe('info');
    expect(vision?.label).toContain('2건');
  });

  it('is all-pass for a clean applicant, with self names in the detail', () => {
    const checks = buildApplicantChecks({
      documents: [doc('d1')],
      peopleByDoc: new Map([['d1', 5]]),
      selfNames: ['홍길동'],
      reviewCount: 0,
      openFlags: 0,
      sameAffiliationCount: 0,
    });
    expect(checks.every((c) => c.level === 'pass')).toBe(true);
    expect(checks.find((c) => c.id === 'self')?.detail).toContain('홍길동');
  });

  it('reports pending review work and same-affiliation count as info', () => {
    const checks = buildApplicantChecks({
      documents: [doc('d1')],
      peopleByDoc: new Map([['d1', 5]]),
      selfNames: ['홍길동'],
      reviewCount: 3,
      openFlags: 2,
      sameAffiliationCount: 4,
    });
    expect(checks.find((c) => c.id === 'review')?.label).toContain('3명');
    expect(checks.find((c) => c.id === 'same-aff')?.label).toContain('4명');
  });
});
