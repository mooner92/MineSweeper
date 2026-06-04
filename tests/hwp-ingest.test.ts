import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { ingestHwp } from '@/lib/pipeline/ingest/hwp';

describe('ingestHwp', () => {
  it('extracts text from an HWPX (OWPML zip) — names land in pages[0].text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-hwpx-'));
    const path = join(dir, 'doc.hwpx');
    const xml =
      '<?xml version="1.0"?><hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">' +
      '<hp:p><hp:run><hp:t>연구책임자 우정헌</hp:t></hp:run></hp:p>' +
      '<hp:p><hp:run><hp:t>연구원 장명도 &amp; 이형민</hp:t></hp:run></hp:p></hs:sec>';
    const zip = new AdmZip();
    zip.addFile('Contents/section0.xml', Buffer.from(xml, 'utf8'));
    zip.writeZip(path);

    const r = ingestHwp(path);
    expect(r.format).toBe('hwp');
    expect(r.hasTextLayer).toBe(true);
    const text = r.pages[0]?.text ?? '';
    expect(text).toContain('우정헌');
    expect(text).toContain('장명도');
    expect(text).toContain('이형민');
    expect(text).toContain('&'); // XML entity decoded
  });

  it('degrades gracefully on an unreadable/non-HWP file (no throw, flagged for review)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-hwp-bad-'));
    const path = join(dir, 'broken.hwp');
    writeFileSync(path, Buffer.from('this is not a real hwp/ole file'));

    const r = ingestHwp(path);
    expect(r.format).toBe('hwp');
    expect(r.hasTextLayer).toBe(false);
    expect(r.pages).toHaveLength(0);
    expect(r.note).toBeTruthy();
  });
});
