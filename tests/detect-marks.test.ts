import { describe, expect, it } from 'vitest';
import type { DocumentMark } from '@/lib/domain';
import { type DocForDetect, type MarkDetectionDeps, runMarkDetection } from '@/worker/detect-marks';

const cfg = { baseUrl: 'http://localhost:8010/v1', model: 'm', apiKey: 'local', timeoutMs: 1000 };

function makeDeps(detect: MarkDetectionDeps['detect']) {
  const calls = { renderPdf: [] as number[], renderImage: 0, crop: 0 };
  const deps: MarkDetectionDeps = {
    cfg,
    outDir: '/tmp/ms-detect-test',
    renderPdf: async (_fp, page, out) => {
      calls.renderPdf.push(page);
      return { path: out, width: 1000, height: 600 };
    },
    renderImage: async (_fp, out) => {
      calls.renderImage += 1;
      return { path: out, width: 800, height: 600 };
    },
    detect,
    crop: async (_src, _bbox, out) => {
      calls.crop += 1;
      return out;
    },
  };
  return { calls, deps };
}

const sealOnPage1: MarkDetectionDeps['detect'] = async (_c, _img, page) =>
  page === 1
    ? [{ type: 'seal', bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, page, confidence: 0.9 }]
    : [];

function doc(p: Partial<DocForDetect> & { documentId: string }): DocForDetect {
  return { filepath: '/x.pdf', docType: 'degree_thesis', format: 'pdf', ...p };
}

describe('runMarkDetection', () => {
  it('thesis: scans 2 pages, detects seal on p1, crops it', async () => {
    const { calls, deps } = makeDeps(sealOnPage1);
    const out = await runMarkDetection([doc({ documentId: 'd1' })], deps);
    expect(calls.renderPdf).toEqual([1, 2]);
    const marks = out.get('d1') ?? [];
    expect(marks).toHaveLength(1);
    expect(marks[0].type).toBe('seal');
    expect(marks[0].cropPath).toContain('d1-p1-0.png');
    expect(calls.crop).toBe(1);
  });

  it('research_project (marks expected, non-thesis): scans only page 1', async () => {
    const { calls, deps } = makeDeps(sealOnPage1);
    await runMarkDetection([doc({ documentId: 'd2', docType: 'research_project' })], deps);
    expect(calls.renderPdf).toEqual([1]);
  });

  it('skips doc types where seals/signatures do not occur (hindex/journal/대표연구실적)', async () => {
    const { calls, deps } = makeDeps(sealOnPage1);
    const out = await runMarkDetection(
      [
        doc({ documentId: 'h1', docType: 'hindex', format: 'image', filepath: '/s.png' }),
        doc({ documentId: 'j1', docType: 'journal_article' }),
        doc({ documentId: 'r1', docType: 'representative_research' }),
      ],
      deps,
    );
    expect(out.size).toBe(0); // no false handwriting/seal flags on a google-scholar capture etc.
    expect(calls.renderPdf).toEqual([]);
    expect(calls.renderImage).toBe(0);
  });

  it('image doc: uses image renderer, not pdf', async () => {
    const { calls, deps } = makeDeps(sealOnPage1);
    const out = await runMarkDetection(
      [doc({ documentId: 'd3', format: 'image', filepath: '/x.png' })],
      deps,
    );
    expect(calls.renderImage).toBe(1);
    expect(calls.renderPdf).toEqual([]);
    expect((out.get('d3') ?? []).length).toBe(1);
  });

  it('text / hwp docs are skipped (nothing to rasterize)', async () => {
    const { calls, deps } = makeDeps(sealOnPage1);
    const out = await runMarkDetection(
      [doc({ documentId: 'd4', format: 'text' }), doc({ documentId: 'd5', format: 'hwp' })],
      deps,
    );
    expect(out.size).toBe(0);
    expect(calls.renderPdf).toEqual([]);
    expect(calls.renderImage).toBe(0);
  });

  it('no marks detected → no entry for the document', async () => {
    const noMarks: MarkDetectionDeps['detect'] = async () => [] as DocumentMark[];
    const { deps } = makeDeps(noMarks);
    const out = await runMarkDetection([doc({ documentId: 'd6' })], deps);
    expect(out.has('d6')).toBe(false);
  });
});
