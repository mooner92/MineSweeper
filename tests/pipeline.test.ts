import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toCsv, toXlsxBuffer } from '@/lib/export';
import { runPipeline, type PipelineFile } from '@/lib/pipeline/run';
import { ARTICLE_EN, THESIS_KO } from './fixtures';

function buildApplicant(): PipelineFile[] {
  const dir = mkdtempSync(join(tmpdir(), 'ms-pipe-'));
  const thesis = join(dir, '2401-000001_[학위논문]_도시공원이용.txt');
  const article = join(dir, '2401-000001_[학술논문]_urban-green-study.txt');
  const hindex = join(dir, '2401-000001_hindex.png');
  writeFileSync(thesis, THESIS_KO);
  writeFileSync(article, ARTICLE_EN);
  writeFileSync(hindex, 'fake png bytes');
  return [
    { filepath: thesis, folderCategory: '논문첨부' },
    { filepath: article, folderCategory: '학술지 게재' },
    { filepath: hindex, folderCategory: '기타서류' },
  ];
}

describe('runPipeline (end-to-end with stub extractor)', () => {
  it('processes all docs and aggregates persons with provenance', async () => {
    const { documents, aggregates } = await runPipeline(buildApplicant(), {
      applicantName: 'Gildong Hong',
    });

    expect(documents).toHaveLength(3);
    const hindexDoc = documents.find((d) => d.docType === 'hindex');
    expect(hindexDoc?.persons).toEqual([]); // image-only: nothing fabricated

    const find = (name: string) => aggregates.find((a) => a.canonicalName === name);

    // Advisor who is also a committee member -> single row, unioned roles.
    const advisor = find('이준호');
    expect(advisor).toBeDefined();
    expect(advisor?.roles.sort()).toEqual(['committee', 'supervisor']);

    expect(find('박서준')?.roles).toContain('committee');
    expect(find('윤도현')?.roles).toContain('department_head');
    expect(find('John Carter')?.roles).toContain('coauthor');

    // The applicant themself is flagged for auto-exclusion.
    expect(find('Gildong Hong')?.isSelf).toBe(true);

    // Provenance is attached.
    expect(advisor?.sources.length).toBeGreaterThanOrEqual(1);
  });

  it('exports CSV and a valid XLSX workbook', async () => {
    const { aggregates } = await runPipeline(buildApplicant(), { applicantName: 'Gildong Hong' });

    const csv = toCsv(aggregates);
    expect(csv).toContain('canonical_name');
    expect(csv).toContain('이준호');
    expect(csv).toContain('John Carter');

    const xlsx = await toXlsxBuffer(aggregates);
    expect(xlsx.length).toBeGreaterThan(0);
    // XLSX is a zip — magic bytes "PK".
    expect(xlsx[0]).toBe(0x50);
    expect(xlsx[1]).toBe(0x4b);
  });
});
