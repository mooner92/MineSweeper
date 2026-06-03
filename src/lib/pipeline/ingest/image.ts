import type { IngestResult } from '@/lib/pipeline/types';

/** Images (e.g. hindex scholar captures) are already a page image — vision handles them. */
export function ingestImage(filepath: string): IngestResult {
  return {
    format: 'image',
    filepath,
    pages: [{ pageNumber: 1, text: '', hasText: false, imagePath: filepath }],
    pageCount: 1,
    hasTextLayer: false,
    note: 'image: vision required',
  };
}
