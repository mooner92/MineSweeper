import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Bbox, DocumentMark } from '@/lib/domain';
import type { VlmConfig } from './vlm';
import { clamp01, extractJsonBlock } from './util';

/**
 * DETECT (not read) seal / signature / handwriting regions on a page image via a local VLM.
 * Returns where the marks are, NOT what they say — 전서체 seals are not transcribed. This is the
 * triage signal: "this document has a stamp/signature here; a human should eyeball the crop."
 */

const markSchema = z.object({
  type: z.string(),
  bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  confidence: z.number().nullish(),
});
const responseSchema = z.object({ marks: z.array(markSchema).default([]) });

const DETECT_SYSTEM =
  '너는 문서 이미지에서 도장(seal/印章)·서명(signature)·손글씨(handwriting) "영역"을 찾는 검출기다. ' +
  '글자를 읽지 말고 위치만 보고한다. 인쇄된 일반 텍스트는 포함하지 않는다. 없으면 빈 배열.';

const DETECT_USER =
  '이 페이지에서 도장/서명/손글씨 마크를 모두 찾아 JSON만 출력하라:\n' +
  '{"marks":[{"type":"seal|signature|handwriting","bbox":{"x":0~1,"y":0~1,"w":0~1,"h":0~1},"confidence":0~1}]}\n' +
  'bbox는 이미지 좌상단 기준 0~1 정규화 비율(x,y=좌상단, w,h=너비/높이).';

const ALLOWED = new Set(['seal', 'signature', 'handwriting']);

function clampBbox(b: { x: number; y: number; w: number; h: number }): Bbox {
  const x = clamp01(b.x);
  const y = clamp01(b.y);
  return { x, y, w: clamp01(Math.min(b.w, 1 - x)), h: clamp01(Math.min(b.h, 1 - y)) };
}

export async function detectMarks(
  cfg: VlmConfig,
  imagePath: string,
  page = 1,
): Promise<DocumentMark[]> {
  const b64 = await readFile(imagePath)
    .then((b) => b.toString('base64'))
    .catch(() => null);
  if (!b64) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: DETECT_SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'text', text: DETECT_USER },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = body.choices?.[0]?.message?.content ?? '{}';
    const parsed = responseSchema.safeParse(JSON.parse(extractJsonBlock(raw)));
    if (!parsed.success) return [];
    return parsed.data.marks
      .filter((m) => ALLOWED.has(m.type.toLowerCase()))
      .map((m) => ({
        type: m.type.toLowerCase() as DocumentMark['type'],
        bbox: clampBbox(m.bbox),
        page,
        confidence: m.confidence ?? null,
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
