import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { detectFormat, ingest } from '@/lib/pipeline/ingest';
import { MINI_PDF } from './fixtures';

const tmp = mkdtempSync(join(tmpdir(), 'ms-ingest-'));

afterAll(() => {
  // best-effort; OS temp is cleaned eventually
});

describe('detectFormat', () => {
  it('maps extensions to formats', () => {
    expect(detectFormat('a.pdf')).toBe('pdf');
    expect(detectFormat('a.PNG')).toBe('image');
    expect(detectFormat('a.hwp')).toBe('hwp');
    expect(detectFormat('a.hwpx')).toBe('hwp');
    expect(detectFormat('a.txt')).toBe('text');
    expect(detectFormat('a.zip')).toBeNull();
  });
});

describe('ingest dispatch', () => {
  it('image adapter yields a single vision page', async () => {
    const p = join(tmp, 'pic.png');
    writeFileSync(p, 'fake png bytes');
    const r = await ingest(p);
    expect(r.format).toBe('image');
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0].hasText).toBe(false);
    expect(r.pages[0].imagePath).toBe(p);
    expect(r.hasTextLayer).toBe(false);
  });

  it('text adapter extracts the text layer', async () => {
    const p = join(tmp, 'doc.txt');
    writeFileSync(p, '지도교수 정주철');
    const r = await ingest(p);
    expect(r.format).toBe('text');
    expect(r.hasTextLayer).toBe(true);
    expect(r.pages[0].text).toContain('정주철');
  });

  it('pdf adapter extracts a text layer when present', async () => {
    const p = join(tmp, 'mini.pdf');
    writeFileSync(p, MINI_PDF, 'latin1');
    const r = await ingest(p);
    expect(r.format).toBe('pdf');
    expect(r.hasTextLayer).toBe(true);
    expect(r.pages[0].text).toContain('Newman');
  });

  it('pdf adapter degrades gracefully on garbage (no throw)', async () => {
    const p = join(tmp, 'bad.pdf');
    writeFileSync(p, 'this is definitely not a pdf');
    const r = await ingest(p);
    expect(r.format).toBe('pdf');
    expect(r.hasTextLayer).toBe(false);
    expect(r.note).toBeTruthy();
  });

  it('hwp placeholder flags unsupported without throwing', async () => {
    const p = join(tmp, 'doc.hwp');
    writeFileSync(p, 'hwp bytes');
    const r = await ingest(p);
    expect(r.format).toBe('hwp');
    expect(r.note).toMatch(/hwp/i);
  });
});
