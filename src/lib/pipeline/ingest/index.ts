import type { SourceFormat } from '@/lib/domain';
import type { IngestResult } from '@/lib/pipeline/types';
import { detectFormat } from './detect';
import { ingestHwp } from './hwp';
import { ingestImage } from './image';
import { ingestPdf } from './pdf';
import { ingestText } from './text';

/** Stage 1 dispatch — turn any supported file into a format-agnostic page bundle. */
export async function ingest(filepath: string, format?: SourceFormat): Promise<IngestResult> {
  const fmt = format ?? detectFormat(filepath);
  switch (fmt) {
    case 'pdf':
      return ingestPdf(filepath);
    case 'image':
      return ingestImage(filepath);
    case 'hwp':
      return ingestHwp(filepath);
    case 'text':
      return ingestText(filepath);
    default:
      return {
        format: 'image',
        filepath,
        pages: [{ pageNumber: 1, text: '', hasText: false, imagePath: filepath }],
        pageCount: 1,
        hasTextLayer: false,
        note: `unknown format for ${filepath}; treated as image`,
      };
  }
}

export { detectFormat } from './detect';
