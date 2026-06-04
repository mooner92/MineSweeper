import { describe, expect, it } from 'vitest';
import { HybridExtractor } from '@/lib/pipeline/extract/hybrid';
import type { ExtractInput, Extractor, PageBundle, RawPerson } from '@/lib/pipeline/types';

/** Records which underlying extractor the hybrid router invoked. */
class FakeExtractor implements Extractor {
  calls = 0;
  constructor(
    readonly name: string,
    private readonly result: RawPerson[],
  ) {}
  async extract(_input: ExtractInput): Promise<RawPerson[]> {
    this.calls++;
    return this.result;
  }
}

function person(nameRaw: string): RawPerson {
  return { nameRaw, role: 'committee', sourceKind: 'printed', sourcePage: 1, confidence: 0.9 };
}

function input(pages: PageBundle[]): ExtractInput {
  return { docType: 'degree_thesis', filename: 'doc', pages };
}

describe('HybridExtractor routing', () => {
  it('routes a document with a real text layer to the text extractor', async () => {
    const text = new FakeExtractor('text', [person('정주철')]);
    const image = new FakeExtractor('image', [person('SHOULD-NOT-RUN')]);
    const hybrid = new HybridExtractor(text, image);

    const out = await hybrid.extract(
      input([{ pageNumber: 1, text: '지도교수 정주철', hasText: true }]),
    );

    expect(out.map((p) => p.nameRaw)).toEqual(['정주철']);
    expect(text.calls).toBe(1);
    expect(image.calls).toBe(0);
  });

  it('routes an image-only document (no text layer) to the image extractor', async () => {
    const text = new FakeExtractor('text', [person('SHOULD-NOT-RUN')]);
    const image = new FakeExtractor('image', [person('이영희')]);
    const hybrid = new HybridExtractor(text, image);

    const out = await hybrid.extract(
      input([{ pageNumber: 1, text: '', hasText: false, imagePath: '/tmp/x.png' }]),
    );

    expect(out.map((p) => p.nameRaw)).toEqual(['이영희']);
    expect(image.calls).toBe(1);
    expect(text.calls).toBe(0);
  });

  it('treats a hasText page with only whitespace as image-only (scanned with empty layer)', async () => {
    const text = new FakeExtractor('text', [person('SHOULD-NOT-RUN')]);
    const image = new FakeExtractor('image', [person('홍길동')]);
    const hybrid = new HybridExtractor(text, image);

    const out = await hybrid.extract(input([{ pageNumber: 1, text: '   \n  ', hasText: true }]));

    expect(out.map((p) => p.nameRaw)).toEqual(['홍길동']);
    expect(image.calls).toBe(1);
    expect(text.calls).toBe(0);
  });

  it('uses the text extractor if ANY page has a usable text layer', async () => {
    const text = new FakeExtractor('text', [person('정주철')]);
    const image = new FakeExtractor('image', []);
    const hybrid = new HybridExtractor(text, image);

    await hybrid.extract(
      input([
        { pageNumber: 1, text: '', hasText: false, imagePath: '/tmp/a.png' },
        { pageNumber: 2, text: '심사위원 홍길동', hasText: true },
      ]),
    );

    expect(text.calls).toBe(1);
    expect(image.calls).toBe(0);
  });
});
