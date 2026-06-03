import { describe, expect, it } from 'vitest';
import { StubExtractor } from '@/lib/pipeline/extract';
import type { PageBundle } from '@/lib/pipeline/types';
import { ARTICLE_EN, EMPTY_THESIS, THESIS_KO } from './fixtures';

const stub = new StubExtractor();
const page = (text: string): PageBundle => ({ pageNumber: 1, text, hasText: true });

describe('StubExtractor — degree thesis', () => {
  it('parses advisor / committee / department head from the approval page', async () => {
    const persons = await stub.extract({
      docType: 'degree_thesis',
      filename: 't.txt',
      pages: [page(THESIS_KO)],
    });
    const byRole = (role: string) => persons.filter((p) => p.role === role).map((p) => p.nameRaw);

    expect(byRole('supervisor')).toContain('정주철');
    expect(byRole('committee')).toEqual(expect.arrayContaining(['김영호', '박민수', '정주철']));
    expect(byRole('department_head')).toContain('이정민');
    expect(persons.every((p) => p.sourceKind === 'printed')).toBe(true);
  });

  it('returns [] for a thesis with no committee block (no fabrication)', async () => {
    const persons = await stub.extract({
      docType: 'degree_thesis',
      filename: 't.txt',
      pages: [page(EMPTY_THESIS)],
    });
    expect(persons).toEqual([]);
  });
});

describe('StubExtractor — article', () => {
  it('parses coauthors and ignores the references section', async () => {
    const persons = await stub.extract({
      docType: 'journal_article',
      filename: 'a.txt',
      pages: [page(ARTICLE_EN)],
      selfName: 'G Newman',
    });
    const names = persons.map((p) => p.nameRaw);

    expect(names).toEqual(
      expect.arrayContaining(['Seonju Jang', 'Galen Newman', 'Chanam Lee']),
    );
    expect(names).toHaveLength(3);
    // Reference authors must never leak in.
    expect(names).not.toContain('Smith');
    expect(names).not.toContain('Park');
    expect(names).not.toContain('Brown');

    expect(persons.every((p) => p.role === 'coauthor')).toBe(true);
    expect(persons[0].affiliation).toBe('tamu.edu');
  });

  it('tags the applicant themself via conservative matching', async () => {
    const persons = await stub.extract({
      docType: 'journal_article',
      filename: 'a.txt',
      pages: [page(ARTICLE_EN)],
      selfName: 'G Newman',
    });
    expect(persons.find((p) => p.nameRaw === 'Galen Newman')?.isSelf).toBe(true);
    expect(persons.find((p) => p.nameRaw === 'Seonju Jang')?.isSelf).toBe(false);
  });
});

describe('StubExtractor — title fabrication guard', () => {
  it('does not capture Title-Case paper titles as coauthors', async () => {
    const text = [
      'Paper Title Here',
      '',
      'Green Infrastructure Planning', // a Title-Case phrase, must NOT become a person
      '',
      'Minji Park, Galen Newman',
      'abc@univ.edu',
      '',
      'Abstract',
      'This paper studies things.',
    ].join('\n');
    const persons = await stub.extract({
      docType: 'journal_article',
      filename: 'a.txt',
      pages: [page(text)],
    });
    const names = persons.map((p) => p.nameRaw);
    expect(names).toEqual(expect.arrayContaining(['Minji Park', 'Galen Newman']));
    expect(names).not.toContain('Green Infrastructure Planning');
    expect(names).not.toContain('Paper Title Here');
  });
});

describe('StubExtractor — co-supervisor spacing', () => {
  it('classifies "부 지도교수" as co_supervisor (not supervisor)', async () => {
    const text = ['관리지역 연구', '', '지도교수  정주철', '부 지도교수  김민수', '심사위원  이영희'].join('\n');
    const persons = await stub.extract({
      docType: 'degree_thesis',
      filename: 't.txt',
      pages: [page(text)],
    });
    expect(persons.find((p) => p.nameRaw === '김민수')?.role).toBe('co_supervisor');
    expect(persons.find((p) => p.nameRaw === '정주철')?.role).toBe('supervisor');
  });
});

describe('StubExtractor — hindex (image only)', () => {
  it('returns [] when there is no text (vision required, no fabrication)', async () => {
    const persons = await stub.extract({
      docType: 'hindex',
      filename: '0323_hindex.png',
      pages: [{ pageNumber: 1, text: '', hasText: false, imagePath: '/x.png' }],
    });
    expect(persons).toEqual([]);
  });
});
