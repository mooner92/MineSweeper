import { describe, expect, it } from 'vitest';
import { EnsembleExtractor, type EndpointCaller } from '@/lib/pipeline/extract/ensemble';
import type { VlmConfig } from '@/lib/pipeline/extract/vlm';
import type { ExtractInput, RawPerson } from '@/lib/pipeline/types';

const CONFIGS: VlmConfig[] = [
  { baseUrl: 'http://localhost:8010/v1', model: 'A', apiKey: 'k', timeoutMs: 1000 },
  { baseUrl: 'http://localhost:8011/v1', model: 'B', apiKey: 'k', timeoutMs: 1000 },
  { baseUrl: 'http://localhost:8012/v1', model: 'C', apiKey: 'k', timeoutMs: 1000 },
];

const INPUT: ExtractInput = {
  docType: 'hindex',
  filename: 'x.png',
  pages: [{ pageNumber: 1, text: '', hasText: false, imagePath: '/x.png' }],
};

function p(nameRaw: string, confidence = 0.9): RawPerson {
  return { nameRaw, role: 'coauthor', sourceKind: 'printed', sourcePage: 1, confidence, ocrConfidence: confidence };
}

/** Fake caller that returns canned results per model id. */
function callerFrom(map: Record<string, RawPerson[] | 'throw'>): EndpointCaller {
  return async (cfg) => {
    const r = map[cfg.model];
    if (r === 'throw') throw new Error('endpoint down');
    return r ?? [];
  };
}

describe('EnsembleExtractor voting', () => {
  it('unanimous agreement → confidence 1.0, no candidates', async () => {
    const ex = new EnsembleExtractor(CONFIGS, {
      caller: callerFrom({ A: [p('정주철')], B: [p('정주철')], C: [p('정주철')] }),
    });
    const out = await ex.extract(INPUT);
    expect(out).toHaveLength(1);
    expect(out[0].nameRaw).toBe('정주철');
    expect(out[0].confidence).toBe(1);
    expect(out[0].nameCandidates ?? []).toEqual([]);
    expect(out[0].ocrEngine).toBe('ensemble:3');
  });

  it('partial agreement (2/3) → confidence ≈ 0.667', async () => {
    const ex = new EnsembleExtractor(CONFIGS, {
      caller: callerFrom({ A: [p('정주철')], B: [p('정주철')], C: [] }),
    });
    const out = await ex.extract(INPUT);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBeCloseTo(2 / 3, 5);
  });

  it('matching variants within a group → nameCandidates, best = highest reported prob', async () => {
    const ex = new EnsembleExtractor(CONFIGS, {
      caller: callerFrom({
        A: [p('Galen Newman', 0.95)],
        B: [p('G Newman', 0.6)],
        C: [p('Galen Newman', 0.9)],
      }),
    });
    const out = await ex.extract(INPUT);
    expect(out).toHaveLength(1); // Galen Newman ~ G Newman are namesMatch -> one group
    expect(out[0].nameRaw).toBe('Galen Newman'); // highest reported confidence
    expect(out[0].confidence).toBe(1); // 3 models voted
    expect((out[0].nameCandidates ?? []).map((c) => c.name).sort()).toEqual(['G Newman', 'Galen Newman']);
  });

  it('resilient: a failing endpoint does not abort the vote', async () => {
    const ex = new EnsembleExtractor(CONFIGS, {
      caller: callerFrom({ A: [p('정주철')], B: 'throw', C: [p('정주철')] }),
    });
    const out = await ex.extract(INPUT);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBeCloseTo(2 / 3, 5); // 2 of 3 models contributed
  });

  it('minVotes filters out single-model-only detections', async () => {
    const ex = new EnsembleExtractor(CONFIGS, {
      minVotes: 2,
      caller: callerFrom({ A: [p('정주철'), p('홍길동')], B: [p('정주철')], C: [p('정주철')] }),
    });
    const out = await ex.extract(INPUT);
    expect(out.map((x) => x.nameRaw)).toEqual(['정주철']); // 홍길동 (1 vote) dropped at minVotes=2
  });

  it('no endpoints configured → empty', async () => {
    const ex = new EnsembleExtractor([], { caller: callerFrom({}) });
    expect(await ex.extract(INPUT)).toEqual([]);
  });
});
