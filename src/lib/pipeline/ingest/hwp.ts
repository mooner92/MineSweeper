import type { IngestResult } from '@/lib/pipeline/types';

/**
 * HWP/HWPX placeholder. Phase 2 adds a real conversion adapter (hwp -> pdf/text); for now we
 * flag the document as unsupported so the pipeline keeps running instead of crashing.
 */
export function ingestHwp(filepath: string): IngestResult {
  return {
    format: 'hwp',
    filepath,
    pages: [],
    pageCount: 0,
    hasTextLayer: false,
    note: 'hwp/hwpx not supported in Phase 1 (adapter placeholder — Phase 2 converts to pdf/text)',
  };
}
