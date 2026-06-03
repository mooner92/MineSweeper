import { describe, expect, it } from 'vitest';
import { classifyDocType } from '@/lib/pipeline/classify';

describe('classifyDocType', () => {
  it('uses the [tag] first', () => {
    expect(classifyDocType({ filename: '2401-000001_[학위논문]_x.pdf' }).docType).toBe('degree_thesis');
    expect(classifyDocType({ filename: '2401-000001_[대표연구실적]_x.pdf' }).docType).toBe(
      'representative_research',
    );
    expect(classifyDocType({ filename: '2401-000001_[학술논문]_x.pdf' }).docType).toBe('journal_article');
  });

  it('detects hindex from the filename', () => {
    const r = classifyDocType({ filename: '2401-000001_hindex.png' });
    expect(r.docType).toBe('hindex');
    expect(r.method).toBe('filename');
  });

  it('falls back to content: thesis markers', () => {
    const r = classifyDocType({ filename: 'scan001.pdf', firstPageText: '석사 학위논문 지도교수 이준호' });
    expect(r.docType).toBe('degree_thesis');
    expect(r.method).toBe('content');
  });

  it('falls back to content: article markers', () => {
    const r = classifyDocType({ filename: 'scan002.pdf', firstPageText: 'Abstract This paper studies cities.' });
    expect(r.docType).toBe('journal_article');
  });

  it('uses folder hint when no tag/content', () => {
    expect(classifyDocType({ filename: 'x.pdf', folderCategory: '학술지 게재' }).docType).toBe(
      'journal_article',
    );
  });

  it('returns unknown when nothing matches', () => {
    expect(classifyDocType({ filename: 'mystery.bin' }).docType).toBe('unknown');
  });
});
