import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import AdmZip from 'adm-zip';

/** Defensive caps against zip bombs (override via env). */
const MAX_ENTRIES = Number(process.env.MAX_ZIP_ENTRIES ?? 5000);
const MAX_TOTAL_BYTES = Number(process.env.MAX_ZIP_TOTAL_BYTES ?? 500 * 1024 * 1024);
/** Per path-component byte budget. ext4/most FS limit is 255 bytes; keep headroom. */
const MAX_COMPONENT_BYTES = 200;

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

const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const utf8Loose = new TextDecoder('utf-8');
const cp949 = new TextDecoder('euc-kr'); // WHATWG 'euc-kr' == CP949, Korean Windows default

/**
 * Decode a zip entry name with the correct charset. Korean Windows zippers store names in CP949
 * without the UTF-8 flag; adm-zip's default UTF-8 read turns them into U+FFFD (which also blows
 * past the filesystem name-length limit). So: honor the UTF-8 flag, else prefer UTF-8 when the
 * bytes are valid UTF-8, otherwise fall back to CP949/EUC-KR.
 */
export function decodeEntryName(entry: AdmZip.IZipEntry): string {
  const raw = entry.rawEntryName;
  const isUtf8 = (entry.header.flags & 0x0800) !== 0; // general-purpose bit 11
  let name: string;
  if (isUtf8) {
    name = utf8Loose.decode(raw);
  } else {
    try {
      name = utf8Strict.decode(raw);
    } catch {
      name = cp949.decode(raw);
    }
  }
  // macOS zips store Hangul decomposed (NFD: 학 -> ㅎㅏㄱ); recompose to NFC so the names display
  // correctly and the [tag]/folder classifier (which matches NFC keywords) works.
  return name.normalize('NFC');
}

/** Truncate to a byte budget without splitting a multi-byte char, preserving the extension. */
function truncateToBytes(name: string, maxBytes: number): string {
  if (Buffer.byteLength(name, 'utf8') <= maxBytes) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const base = dot > 0 ? name.slice(0, dot) : name;
  const budget = Math.max(0, maxBytes - Buffer.byteLength(ext, 'utf8'));
  let out = '';
  for (const ch of base) {
    if (Buffer.byteLength(out + ch, 'utf8') > budget) break;
    out += ch;
  }
  return (out || '_') + ext;
}

/** Make one path component safe: strip control/separator chars, neutralize traversal, cap length. */
function sanitizeComponent(name: string): string {
  let s = name
    .replace(/\p{Cc}/gu, '')
    .replace(/[/\\]/g, '_')
    .trim();
  if (s === '' || s === '.' || s === '..') s = '_';
  return truncateToBytes(s, MAX_COMPONENT_BYTES);
}

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

  if (allEntries.length > MAX_ENTRIES) {
    throw new Error(`zip has too many entries (${allEntries.length} > ${MAX_ENTRIES})`);
  }

  // Decode + validate BEFORE writing anything: bound total uncompressed size, decode names with the
  // right charset, sanitize each path component, and reject any entry that escapes destDir.
  let totalBytes = 0;
  const planned: { entry: AdmZip.IZipEntry; parts: string[]; filepath: string }[] = [];
  for (const e of allEntries) {
    totalBytes += e.header.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(`zip uncompressed size exceeds limit (> ${MAX_TOTAL_BYTES} bytes)`);
    }
    const decoded = decodeEntryName(e);
    if (e.isDirectory || IGNORE.test(decoded)) continue;

    const parts = decoded
      .split('/')
      .filter((p) => p !== '')
      .map(sanitizeComponent)
      .filter((p) => p !== '');
    if (parts.length === 0) continue;

    if (isUnsafeEntryPath(destDir, parts.join('/'))) {
      throw new Error(`unsafe zip entry path (zip-slip): ${decoded}`);
    }
    planned.push({ entry: e, parts, filepath: join(destDir, ...parts) });
  }

  // Write each file. One unreadable/odd entry is skipped (logged) rather than failing the whole
  // upload — a single bad name in a 50-file applicant zip should not lose the other 49.
  const written: typeof planned = [];
  for (const p of planned) {
    try {
      mkdirSync(dirname(p.filepath), { recursive: true });
      writeFileSync(p.filepath, p.entry.getData());
      written.push(p);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[unzip] skipped entry ${p.parts.join('/')}: ${(err as Error).message}`);
    }
  }

  // Applicant zips vary in layout per applicant: a single "<id> (name)" wrapper folder, category
  // folders at the root, deeper nesting, or a flat dump of files. Detect a wrapper robustly — a
  // single top-level DIRECTORY that EVERY file sits under (each path has >1 segment). Anything else
  // (multiple tops, or a lone file at the root) means there is no wrapper.
  const topSegments = [...new Set(written.map((p) => p.parts[0]))];
  const applicantFolder =
    topSegments.length === 1 && written.every((p) => p.parts.length > 1) ? topSegments[0] : null;

  const files: ExtractedFile[] = written.map((p) => {
    const withinRoot = applicantFolder ? p.parts.slice(1) : p.parts;
    // Category = the first folder under the root (a file directly at the root has no category).
    // docType itself is classified primarily from the filename [tag], so this is a display/grouping
    // hint and degrades gracefully (null) when the layout has no category folders.
    const folderCategory = withinRoot.length > 1 ? withinRoot[0] : null;
    return { filepath: p.filepath, relativePath: withinRoot.join('/'), folderCategory };
  });

  return { rootDir: destDir, applicantFolder, files };
}
