import { afterEach, describe, expect, it, vi } from 'vitest';
import { VlmExtractor } from '@/lib/pipeline/extract/vlm';
import type { ExtractInput, PageBundle } from '@/lib/pipeline/types';

const cfg = { baseUrl: 'http://vlm/v1', apiKey: 'k', model: 'm', timeoutMs: 5000 };
const page = (n: number, text: string): PageBundle => ({ pageNumber: n, text, hasText: !!text });

/** Mock fetch to return one {persons:[...]} body (the VLM's raw classification). */
function stubFetch(body: object): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(body) }, finish_reason: 'stop' }],
      }),
    })) as unknown as typeof fetch,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('printed-only docType coercion (구글스칼라 h-지수 손글씨 오검출 차단)', () => {
  it('forces sourceKind=printed for hindex even when the VLM says handwritten/seal/signature', async () => {
    stubFetch({
      persons: [
        { name: 'Taeyun Kim', source_kind: 'handwritten' },
        { name: 'JINHYUN BAE', source_kind: 'signature' },
        { name: 'Galen Newman', source_kind: 'seal' },
      ],
    });
    const input: ExtractInput = {
      docType: 'hindex',
      pages: [page(1, '')],
      filename: '[h-지수] google scholar capture.jpg',
      imagePaths: [],
    };
    const out = await new VlmExtractor(cfg).extract(input);
    expect(out.map((p) => p.nameRaw)).toEqual(['Taeyun Kim', 'JINHYUN BAE', 'Galen Newman']);
    // 핵심: 인쇄 캡처이므로 전원 printed → '손글씨/도장/서명' 검토 플래그가 생기지 않는다.
    expect(out.every((p) => p.sourceKind === 'printed')).toBe(true);
  });

  it('does NOT coerce a non-printed-only docType (research_project keeps the VLM sourceKind)', async () => {
    stubFetch({ persons: [{ name: '홍길동', source_kind: 'signature' }] });
    const input: ExtractInput = {
      docType: 'research_project',
      pages: [page(1, '연구과제 제출문')],
      filename: 'r.pdf',
      imagePaths: [],
    };
    const out = await new VlmExtractor(cfg).extract(input);
    expect(out[0]?.sourceKind).toBe('signature'); // 연구과제 날인/서명은 실제 신호 — 보존
  });
});
