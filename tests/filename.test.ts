import { describe, expect, it } from 'vitest';
import { parseApplicantFolder, parseFilename } from '@/lib/filename';

describe('parseFilename', () => {
  it('parses applicantId + [tag] + title + hints', () => {
    const r = parseFilename('0323-000001_[학위논문]_the role of social capital (영문 박사).pdf');
    expect(r.applicantId).toBe('0323-000001');
    expect(r.tag).toBe('학위논문');
    expect(r.title).toContain('the role of social capital');
    expect(r.degree).toBe('doctoral');
    expect(r.language).toBe('en');
  });

  it('parses the hindex file (no tag)', () => {
    const r = parseFilename('0323-000001_hindex.png');
    expect(r.applicantId).toBe('0323-000001');
    expect(r.tag).toBeNull();
    expect(r.title).toBe('hindex');
  });

  it('parses representative-research and journal tags', () => {
    expect(parseFilename('0323-000001_[대표연구실적]_impact of urban.pdf').tag).toBe('대표연구실적');
    expect(parseFilename('0323-000001_[학술논문]_site selection.pdf').tag).toBe('학술논문');
  });

  it('detects master degree + korean language', () => {
    const r = parseFilename('0323-000001_[학위논문]_관리지역세분화 (국문 석사).pdf');
    expect(r.degree).toBe('master');
    expect(r.language).toBe('ko');
  });
});

describe('parseApplicantFolder', () => {
  it('splits "<id> (<name>)"', () => {
    const r = parseApplicantFolder('0323-000001 (장선주)');
    expect(r.applicantId).toBe('0323-000001');
    expect(r.applicantName).toBe('장선주');
  });
  it('falls back to whole string when no parens', () => {
    const r = parseApplicantFolder('0323-000002');
    expect(r.applicantId).toBe('0323-000002');
    expect(r.applicantName).toBeNull();
  });
});
