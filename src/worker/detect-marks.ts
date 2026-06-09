import { join } from 'node:path';
import type { Bbox, DocType, DocumentMark, SourceFormat } from '@/lib/domain';
import { detectMarks as realDetect } from '@/lib/pipeline/extract/detect';
import { type VlmConfig, vlmConfigFromEnv } from '@/lib/pipeline/extract/vlm';
import { type RenderedPage, cropToPng, imageToPng, renderPdfPageToPng } from '@/lib/pipeline/render';

/**
 * Render the relevant page(s) of each document, DETECT seal/signature/handwriting regions via the
 * local VLM, and crop each region. Returns marks (with crop paths) per document so the worker can
 * raise review flags. All render/detect/crop steps are injectable for GPU-free unit testing.
 */

export interface DocForDetect {
  documentId: string;
  filepath: string;
  docType: DocType;
  format: SourceFormat;
}

export interface MarkDetectionDeps {
  cfg?: VlmConfig;
  outDir?: string;
  renderPdf?: (filepath: string, page: number, outPath: string) => Promise<RenderedPage | null>;
  renderImage?: (srcPath: string, outPath: string) => Promise<RenderedPage | null>;
  detect?: (cfg: VlmConfig, imagePath: string, page: number) => Promise<DocumentMark[]>;
  crop?: (srcPath: string, bbox: Bbox, outPath: string) => Promise<string | null>;
}

/**
 * Doc types where 도장/서명/날인 actually occur: 학위논문 인준서, 연구과제 제출문. We do NOT run
 * mark detection on google-scholar captures (hindex), journal PDFs, or 대표연구실적 — those never
 * carry handwritten seals/signatures, and asking the VLM to localize "handwriting" in a dense
 * screenshot produces false positives (the bug this fixes). Tunable via DETECT_MARK_DOCTYPES.
 */
const MARK_DOCTYPES = new Set<string>(
  (process.env.DETECT_MARK_DOCTYPES ?? 'degree_thesis,research_project')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

/** Where marks live: thesis approval/cover (first 2 pages), everything else page 1. */
function pagesToScan(docType: DocType): number[] {
  return docType === 'degree_thesis' ? [1, 2] : [1];
}

export async function runMarkDetection(
  docs: DocForDetect[],
  deps: MarkDetectionDeps = {},
): Promise<Map<string, DocumentMark[]>> {
  const cfg = deps.cfg ?? vlmConfigFromEnv();
  const outDir = deps.outDir ?? process.env.UPLOAD_DIR ?? './data/uploads';
  const renderPdf = deps.renderPdf ?? renderPdfPageToPng;
  const renderImage = deps.renderImage ?? imageToPng;
  const detect = deps.detect ?? realDetect;
  const crop = deps.crop ?? cropToPng;

  const out = new Map<string, DocumentMark[]>();
  for (const doc of docs) {
    if (doc.format === 'hwp' || doc.format === 'text') continue; // nothing to rasterize
    if (!MARK_DOCTYPES.has(doc.docType)) continue; // marks don't occur here (e.g. hindex/journal)
    const marks: DocumentMark[] = [];
    const pages = doc.format === 'image' ? [1] : pagesToScan(doc.docType);

    for (const page of pages) {
      const renderPath = join(outDir, 'renders', `${doc.documentId}-p${page}.png`);
      const rendered =
        doc.format === 'image'
          ? await renderImage(doc.filepath, renderPath)
          : await renderPdf(doc.filepath, page, renderPath);
      if (!rendered) continue;

      const found = await detect(cfg, rendered.path, page);
      for (let i = 0; i < found.length; i++) {
        const m = found[i];
        const cropPath = await crop(
          rendered.path,
          m.bbox,
          join(outDir, 'crops', `${doc.documentId}-p${page}-${i}.png`),
        );
        marks.push({ ...m, cropPath });
      }
    }
    if (marks.length) out.set(doc.documentId, marks);
  }
  return out;
}
