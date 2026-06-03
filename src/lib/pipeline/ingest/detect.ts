import { extname } from 'node:path';
import type { SourceFormat } from '@/lib/domain';

const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
]);

/**
 * Map a filename to a source format. Kept free of any adapter imports (esp. pdfjs) so callers
 * that only need format detection — e.g. the Next upload route — don't pull the heavy/ESM-only
 * pdf adapter into the bundle.
 */
export function detectFormat(filename: string): SourceFormat | null {
  const ext = extname(filename).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.hwp' || ext === '.hwpx') return 'hwp';
  if (ext === '.txt' || ext === '.text' || ext === '.md') return 'text';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return null;
}
