import { afterEach, describe, expect, it, vi } from 'vitest';
import { VlmExtractor } from '@/lib/pipeline/extract/vlm';
import type { ExtractInput, PageBundle } from '@/lib/pipeline/types';

const cfg = { baseUrl: 'http://vlm/v1', apiKey: 'k', model: 'm', timeoutMs: 5000 };
const page = (n: number, text: string): PageBundle => ({ pageNumber: n, text, hasText: !!text });

/** Mock global.fetch to return a queued sequence of {persons:[...]} bodies and record request bodies. */
function stubFetch(bodies: object[]): { bodies: any[] } {
  const sent: any[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: any) => {
      sent.push(JSON.parse(init.body));
      const body = bodies[Math.min(i++, bodies.length - 1)];
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(body) }, finish_reason: 'stop' }] }),
      } as Response;
    }),
  );
  return { bodies: sent };
}

afterEach(() => vi.restoreAllMocks());

describe('VlmExtractor retry-on-zero', () => {
  it('retries once (temp>0 + nudge) when an IMAGE doc returns 0 persons, then succeeds', async () => {
    const sent = stubFetch([{ persons: [] }, { persons: [{ name: 'A Smith' }, { name: 'B Jones' }] }]);
    const input: ExtractInput = {
      docType: 'hindex',
      pages: [page(1, '')],
      filename: 'h.jpg',
      imagePaths: ['/nonexistent.png'], // readFile fails gracefully; retry gate only checks .length
    };
    const out = await new VlmExtractor(cfg).extract(input);
    expect(out.map((p) => p.nameRaw)).toEqual(['A Smith', 'B Jones']); // recovered on retry
    expect(sent.bodies).toHaveLength(2); // exactly one retry
    expect(sent.bodies[0].temperature).toBe(0); // first pass deterministic
    expect(sent.bodies[1].temperature).toBeGreaterThan(0); // retry breaks determinism
  });

  it('does NOT retry a TEXT doc that returns 0 (supplementRoster is its backstop)', async () => {
    const sent = stubFetch([{ persons: [] }]);
    const input: ExtractInput = {
      docType: 'research_project',
      pages: [page(1, '본문')],
      filename: 'r.pdf',
      imagePaths: [],
    };
    const out = await new VlmExtractor(cfg).extract(input);
    expect(out).toEqual([]);
    expect(sent.bodies).toHaveLength(1); // no retry for text-only docs
  });

  it('does NOT retry when the first image pass already found someone', async () => {
    const sent = stubFetch([{ persons: [{ name: 'Jane Doe' }] }]);
    const input: ExtractInput = {
      docType: 'hindex',
      pages: [page(1, '')],
      filename: 'h.jpg',
      imagePaths: ['/nonexistent.png'],
    };
    const out = await new VlmExtractor(cfg).extract(input);
    expect(out.map((p) => p.nameRaw)).toEqual(['Jane Doe']);
    expect(sent.bodies).toHaveLength(1); // success → no wasted retry
  });
});
