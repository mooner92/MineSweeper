import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { decodeEntryName, isUnsafeEntryPath, unzipApplicant } from '@/lib/unzip';
import { THESIS_KO } from './fixtures';

describe('unzipApplicant', () => {
  it('extracts preserving folder=category structure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-zip-'));
    const zipPath = join(dir, 'applicant.zip');

    const zip = new AdmZip();
    zip.addFile(
      '0323-000001 (장선주)/논문첨부/0323-000001_[학위논문]_thesis.txt',
      Buffer.from(THESIS_KO, 'utf8'),
    );
    zip.addFile('0323-000001 (장선주)/기타서류/0323-000001_hindex.png', Buffer.from('png'));
    zip.addFile('0323-000001 (장선주)/__MACOSX/junk', Buffer.from('junk'));
    zip.writeZip(zipPath);

    const dest = join(dir, 'out');
    const result = unzipApplicant(zipPath, dest);

    expect(result.applicantFolder).toBe('0323-000001 (장선주)');
    // __MACOSX junk is filtered out.
    expect(result.files).toHaveLength(2);

    const thesis = result.files.find((f) => f.relativePath.includes('thesis.txt'));
    expect(thesis?.folderCategory).toBe('논문첨부');

    const hindex = result.files.find((f) => f.relativePath.includes('hindex.png'));
    expect(hindex?.folderCategory).toBe('기타서류');
  });

  it('handles varied internal layouts (no wrapper, deep nesting, flat)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-zip-layout-'));
    const mk = (entries: [string, string][]) => {
      const zp = join(dir, `z${Math.abs(entries.length * 31 + entries[0][0].length)}.zip`);
      const z = new AdmZip();
      for (const [name, body] of entries) z.addFile(name, Buffer.from(body));
      z.writeZip(zp);
      return unzipApplicant(zp, join(dir, `out${entries[0][0].length}-${entries.length}`));
    };

    // (a) no wrapper folder — category folders at the root
    const a = mk([
      ['논문첨부/thesis.pdf', 'x'],
      ['기타서류/hindex.png', 'y'],
    ]);
    expect(a.applicantFolder).toBeNull();
    expect(a.files.find((f) => f.relativePath.includes('thesis'))?.folderCategory).toBe('논문첨부');

    // (b) deep nesting under a wrapper — category is the first folder under the wrapper
    const b = mk([['0323-000050 (이형민)/학술지 게재/2022/paper.pdf', 'x']]);
    expect(b.applicantFolder).toBe('0323-000050 (이형민)');
    expect(b.files[0].folderCategory).toBe('학술지 게재');
    expect(b.files[0].relativePath).toBe('학술지 게재/2022/paper.pdf');

    // (c) flat dump — files at the root, no folders → no category, still extracted
    const c = mk([
      ['a.pdf', 'x'],
      ['b.pdf', 'y'],
    ]);
    expect(c.applicantFolder).toBeNull();
    expect(c.files).toHaveLength(2);
    expect(c.files.every((f) => f.folderCategory === null)).toBe(true);
  });

  it('decodes CP949/EUC-KR entry names (Korean Windows zips, no UTF-8 flag)', () => {
    // "정주철" in CP949/EUC-KR bytes, with the UTF-8 general-purpose flag bit cleared.
    const cp949 = { rawEntryName: Buffer.from([0xc1, 0xa4, 0xc1, 0xd6, 0xc3, 0xb6]), header: { flags: 0 } };
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock of the fields decodeEntryName reads
    expect(decodeEntryName(cp949 as any)).toBe('정주철');

    // Same characters as UTF-8 with the UTF-8 flag set (bit 11) -> decoded as UTF-8.
    const utf8 = { rawEntryName: Buffer.from('정주철', 'utf8'), header: { flags: 0x0800 } };
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock
    expect(decodeEntryName(utf8 as any)).toBe('정주철');

    // ASCII without a flag stays ASCII (valid UTF-8 path).
    const ascii = { rawEntryName: Buffer.from('thesis.pdf', 'utf8'), header: { flags: 0 } };
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock
    expect(decodeEntryName(ascii as any)).toBe('thesis.pdf');
  });

  it('recomposes NFD (decomposed) Hangul names from macOS zips to NFC', () => {
    const nfd = '학위논문'.normalize('NFD'); // jamo-decomposed, as macOS stores filenames
    expect(nfd).not.toBe('학위논문'); // sanity: actually decomposed
    const entry = { rawEntryName: Buffer.from(nfd, 'utf8'), header: { flags: 0x0800 } };
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock
    expect(decodeEntryName(entry as any)).toBe('학위논문'); // normalized to NFC
  });

  it('truncates over-long filenames so extraction does not crash (ENAMETOOLONG)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-zip-long-'));
    const zipPath = join(dir, 'applicant.zip');

    // 120 Korean chars = 360 bytes (UTF-8) > 255-byte filesystem limit — the case that crashed.
    const longBase = '가'.repeat(120);
    const zip = new AdmZip();
    zip.addFile(`0323-000001 (장선주)/논문첨부/${longBase}.pdf`, Buffer.from('pdf'));
    zip.writeZip(zipPath);

    const dest = join(dir, 'out');
    const result = unzipApplicant(zipPath, dest); // must not throw

    expect(result.files).toHaveLength(1);
    const f = result.files[0];
    expect(existsSync(f.filepath)).toBe(true); // actually written to disk
    expect(Buffer.byteLength(basename(f.filepath), 'utf8')).toBeLessThanOrEqual(200);
    expect(f.filepath.endsWith('.pdf')).toBe(true); // extension preserved
    expect(f.folderCategory).toBe('논문첨부');
  });

  it('detects zip-slip entry paths that escape the destination', () => {
    const dest = '/tmp/ms-out';
    // Traversal escapes -> unsafe.
    expect(isUnsafeEntryPath(dest, '../../etc/passwd')).toBe(true);
    expect(isUnsafeEntryPath(dest, 'a/../../../b.txt')).toBe(true);
    expect(isUnsafeEntryPath(dest, '../ms-out-sibling/evil.txt')).toBe(true);
    // Normal nested entries (incl. Korean applicant folders) -> safe.
    expect(isUnsafeEntryPath(dest, '0323-000001 (장선주)/논문첨부/thesis.txt')).toBe(false);
    expect(isUnsafeEntryPath(dest, 'a/b/c.txt')).toBe(false);
  });
});
