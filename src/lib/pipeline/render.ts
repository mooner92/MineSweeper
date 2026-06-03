import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { pdf } from 'pdf-to-img';
import type { Bbox } from '@/lib/domain';

/**
 * Page rasterization + region cropping (worker-only; uses prebuilt @napi-rs/canvas + pdf-to-img,
 * no system deps). Needed so a vision model can DETECT seals/signatures on a page that has no
 * text-layer image (e.g. a thesis approval page in a text PDF). Never imported by the Next app.
 */

export interface RenderedPage {
  path: string;
  width: number;
  height: number;
}

/** Render one PDF page (1-indexed) to a PNG file. Returns null on failure / out-of-range. */
export async function renderPdfPageToPng(
  filepath: string,
  pageNumber: number,
  outPath: string,
  scale = 2,
): Promise<RenderedPage | null> {
  try {
    const doc = await pdf(filepath, { scale });
    if (pageNumber < 1 || pageNumber > doc.length) return null;
    const buf = await doc.getPage(pageNumber);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, buf);
    const img = await loadImage(buf);
    return { path: outPath, width: img.width, height: img.height };
  } catch {
    return null;
  }
}

/** Normalize an existing image file into a PNG we can crop from. Returns dims, or null. */
export async function imageToPng(srcPath: string, outPath: string): Promise<RenderedPage | null> {
  try {
    const img = await loadImage(srcPath);
    const canvas = createCanvas(img.width, img.height);
    canvas.getContext('2d').drawImage(img, 0, 0);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, canvas.toBuffer('image/png'));
    return { path: outPath, width: img.width, height: img.height };
  } catch {
    return null;
  }
}

/** Crop a normalized (0..1) bbox out of a PNG into its own file. Returns the crop path or null. */
export async function cropToPng(srcPath: string, bbox: Bbox, outPath: string): Promise<string | null> {
  try {
    const img = await loadImage(srcPath);
    const sx = Math.max(0, Math.min(img.width - 1, Math.round(bbox.x * img.width)));
    const sy = Math.max(0, Math.min(img.height - 1, Math.round(bbox.y * img.height)));
    const sw = Math.max(1, Math.min(img.width - sx, Math.round(bbox.w * img.width)));
    const sh = Math.max(1, Math.min(img.height - sy, Math.round(bbox.h * img.height)));
    const canvas = createCanvas(sw, sh);
    canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, canvas.toBuffer('image/png'));
    return outPath;
  } catch {
    return null;
  }
}
