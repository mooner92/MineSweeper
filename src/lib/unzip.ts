import { mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import AdmZip from 'adm-zip';

/** Defensive caps against zip bombs (override via env). */
const MAX_ENTRIES = Number(process.env.MAX_ZIP_ENTRIES ?? 5000);
const MAX_TOTAL_BYTES = Number(process.env.MAX_ZIP_TOTAL_BYTES ?? 500 * 1024 * 1024);

export interface ExtractedFile {
  /** Real path on disk. */
  filepath: string;
  /** Path within the applicant root. */
  relativePath: string;
  /** Top-level folder under the applicant root = document category (or null). */
  folderCategory: string | null;
}

export interface UnzipResult {
  rootDir: string;
  /** The wrapping "<id> (name)" folder, if the zip has a single top-level dir. */
  applicantFolder: string | null;
  files: ExtractedFile[];
}

const IGNORE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/;

/** True if a zip entry path would extract OUTSIDE destDir (zip-slip). */
export function isUnsafeEntryPath(destDir: string, entryName: string): boolean {
  const root = resolve(destDir);
  const rootPrefix = root + sep;
  const target = resolve(destDir, ...entryName.split('/'));
  return target !== root && !target.startsWith(rootPrefix);
}

/** Extract an applicant zip, preserving folder=category structure. */
export function unzipApplicant(zipPath: string, destDir: string): UnzipResult {
  mkdirSync(destDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  const allEntries = zip.getEntries();

  // Validate BEFORE extracting: bound entry count, bound total uncompressed size, and reject
  // any entry whose path escapes destDir (zip-slip) — defense-in-depth beyond adm-zip.
  if (allEntries.length > MAX_ENTRIES) {
    throw new Error(`zip has too many entries (${allEntries.length} > ${MAX_ENTRIES})`);
  }
  let totalBytes = 0;
  for (const e of allEntries) {
    totalBytes += e.header.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(`zip uncompressed size exceeds limit (> ${MAX_TOTAL_BYTES} bytes)`);
    }
    if (isUnsafeEntryPath(destDir, e.entryName)) {
      throw new Error(`unsafe zip entry path (zip-slip): ${e.entryName}`);
    }
  }

  zip.extractAllTo(destDir, true);

  const entries = allEntries.filter((e) => !e.isDirectory && !IGNORE.test(e.entryName));

  // The zip usually wraps everything in a single "<id> (name)" folder.
  const topSegments = new Set(entries.map((e) => e.entryName.split('/')[0]));
  const applicantFolder = topSegments.size === 1 ? [...topSegments][0] : null;

  const files: ExtractedFile[] = entries.map((e) => {
    const parts = e.entryName.split('/');
    const withinRoot = applicantFolder ? parts.slice(1) : parts;
    const folderCategory = withinRoot.length > 1 ? withinRoot[0] : null;
    return {
      filepath: join(destDir, ...parts),
      relativePath: withinRoot.join('/'),
      folderCategory,
    };
  });

  return { rootDir: destDir, applicantFolder, files };
}
