import { readFileSync } from 'node:fs';
import type { IngestResult } from '@/lib/pipeline/types';

/**
 * Plain-text attachment adapter. Also the simplest way to feed the pipeline known text
 * (used by tests). Real text/plain attachments map here too.
 */
export function ingestText(filepath: string): IngestResult {
  let content = '';
  try {
    content = readFileSync(filepath, 'utf8');
  } catch {
    content = '';
  }
  const text = content.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  const hasText = text.length > 0;
  return {
    format: 'text',
    filepath,
    pages: [{ pageNumber: 1, text, hasText }],
    pageCount: 1,
    hasTextLayer: hasText,
  };
}
