import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { isUnsafeEntryPath, unzipApplicant } from '@/lib/unzip';
import { THESIS_KO } from './fixtures';

describe('unzipApplicant', () => {
  it('extracts preserving folder=category structure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-zip-'));
    const zipPath = join(dir, 'applicant.zip');

    const zip = new AdmZip();
    zip.addFile(
      '2401-000001 (홍길동)/논문첨부/2401-000001_[학위논문]_thesis.txt',
      Buffer.from(THESIS_KO, 'utf8'),
    );
    zip.addFile('2401-000001 (홍길동)/기타서류/2401-000001_hindex.png', Buffer.from('png'));
    zip.addFile('2401-000001 (홍길동)/__MACOSX/junk', Buffer.from('junk'));
    zip.writeZip(zipPath);

    const dest = join(dir, 'out');
    const result = unzipApplicant(zipPath, dest);

    expect(result.applicantFolder).toBe('2401-000001 (홍길동)');
    // __MACOSX junk is filtered out.
    expect(result.files).toHaveLength(2);

    const thesis = result.files.find((f) => f.relativePath.includes('thesis.txt'));
    expect(thesis?.folderCategory).toBe('논문첨부');

    const hindex = result.files.find((f) => f.relativePath.includes('hindex.png'));
    expect(hindex?.folderCategory).toBe('기타서류');
  });

  it('detects zip-slip entry paths that escape the destination', () => {
    const dest = '/tmp/ms-out';
    // Traversal escapes -> unsafe.
    expect(isUnsafeEntryPath(dest, '../../etc/passwd')).toBe(true);
    expect(isUnsafeEntryPath(dest, 'a/../../../b.txt')).toBe(true);
    expect(isUnsafeEntryPath(dest, '../ms-out-sibling/evil.txt')).toBe(true);
    // Normal nested entries (incl. Korean applicant folders) -> safe.
    expect(isUnsafeEntryPath(dest, '2401-000001 (홍길동)/논문첨부/thesis.txt')).toBe(false);
    expect(isUnsafeEntryPath(dest, 'a/b/c.txt')).toBe(false);
  });
});
