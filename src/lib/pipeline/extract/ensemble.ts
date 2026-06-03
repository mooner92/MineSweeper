import type { NameCandidate } from '@/lib/domain';
import { nameCompleteness, namesMatch } from '@/lib/names';
import type { ExtractInput, Extractor, RawPerson } from '@/lib/pipeline/types';
import { type VlmConfig, extractFromVlmEndpoint } from './vlm';

/** A function that runs ONE model endpoint. Injectable so the voter is unit-testable without GPU. */
export type EndpointCaller = (cfg: VlmConfig, input: ExtractInput) => Promise<RawPerson[]>;

interface EnsembleOptions {
  /** Drop consensus groups with fewer than this many model votes (default 1 = keep all, recall-safe). */
  minVotes?: number;
  caller?: EndpointCaller;
}

/**
 * Parse VLM_ENSEMBLE into endpoint configs. Format: comma-separated `baseUrl|model` pairs, e.g.
 *   VLM_ENSEMBLE="http://localhost:8010/v1|Qwen2.5-VL-7B,http://localhost:8011/v1|GLM-OCR"
 * API key / timeout are shared via VLM_API_KEY / VLM_TIMEOUT_MS. All endpoints are LOCAL.
 */
export function ensembleConfigsFromEnv(): VlmConfig[] {
  const raw = process.env.VLM_ENSEMBLE ?? '';
  const apiKey = process.env.VLM_API_KEY ?? 'local';
  const timeoutMs = Number(process.env.VLM_TIMEOUT_MS ?? 120000);
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [baseUrl, model] = entry.split('|').map((x) => x.trim());
      return { baseUrl, model: model ?? '', apiKey, timeoutMs } satisfies VlmConfig;
    })
    .filter((c) => c.baseUrl && c.model);
}

interface Group {
  members: Array<{ model: number; person: RawPerson }>;
  models: Set<number>;
}

/**
 * Multi-model OCR ensemble (local vLLM only). Runs the SAME document through N model endpoints
 * and votes:
 *  - Names that several models agree on (via the strict namesMatch) are merged into one result;
 *    `confidence = votes / N` is the agreement signal (3/3 = 1.0, 2/3 ≈ 0.67, ...). Combined with
 *    the per-source-kind threshold downstream, only strong agreement auto-passes — disagreements
 *    are routed to human review (better precision/filtering, as requested).
 *  - Divergent-but-matching readings within a group become `nameCandidates` (n-best); the displayed
 *    name is the highest model-reported-probability variant ("pick the high-probability one").
 *  - Near-misreads that do NOT namesMatch (e.g. 이주영 vs 이조영) stay separate here and are caught
 *    downstream by the aggregate gazetteer (Phase 1.5a).
 * A failing endpoint contributes no votes but never aborts the ensemble.
 */
export class EnsembleExtractor implements Extractor {
  readonly name: string;
  private readonly minVotes: number;
  private readonly caller: EndpointCaller;

  constructor(
    private readonly configs: VlmConfig[] = ensembleConfigsFromEnv(),
    options: EnsembleOptions = {},
  ) {
    this.name = `ensemble:${configs.length}`;
    this.minVotes = options.minVotes ?? Number(process.env.VLM_ENSEMBLE_MIN_VOTES ?? 1);
    this.caller = options.caller ?? extractFromVlmEndpoint;
  }

  async extract(input: ExtractInput): Promise<RawPerson[]> {
    const n = this.configs.length;
    if (n === 0) return [];

    const perModel = await Promise.all(
      this.configs.map((cfg, i) =>
        this.caller(cfg, input)
          .then((r) => ({ i, r }))
          .catch(() => ({ i, r: [] as RawPerson[] })),
      ),
    );

    const groups: Group[] = [];
    for (const { i, r } of perModel) {
      for (const person of r) {
        let group = groups.find((g) => g.members.some((m) => namesMatch(m.person.nameRaw, person.nameRaw)));
        if (!group) {
          group = { members: [], models: new Set<number>() };
          groups.push(group);
        }
        group.members.push({ model: i, person });
        group.models.add(i);
      }
    }

    return groups
      .filter((g) => g.models.size >= this.minVotes)
      .map((g) => {
        const votes = g.models.size;
        const agreement = votes / n;

        // "Pick the high-probability one": best = highest reported confidence, tie → most complete name.
        const best = [...g.members].sort(
          (a, b) =>
            b.person.confidence - a.person.confidence ||
            nameCompleteness(b.person.nameRaw) - nameCompleteness(a.person.nameRaw),
        )[0].person;

        const distinct = [...new Set(g.members.map((m) => m.person.nameRaw))];
        const nameCandidates: NameCandidate[] =
          distinct.length > 1
            ? distinct
                .map((name) => ({
                  name,
                  score: g.members.filter((m) => m.person.nameRaw === name).length / votes,
                }))
                .sort((a, b) => b.score - a.score)
            : [];

        const reported = g.members
          .map((m) => m.person.ocrConfidence ?? m.person.confidence)
          .filter((x): x is number => typeof x === 'number');
        const ocrConfidence = reported.length
          ? reported.reduce((a, b) => a + b, 0) / reported.length
          : null;

        const person: RawPerson = {
          nameRaw: best.nameRaw,
          role: best.role,
          affiliation: g.members.map((m) => m.person.affiliation).find(Boolean) ?? null,
          sourceKind: best.sourceKind,
          sourcePage: best.sourcePage,
          confidence: agreement,
          isSelf: g.members.some((m) => m.person.isSelf),
          ocrEngine: this.name,
          ocrConfidence,
          nameCandidates,
        };
        return person;
      });
  }
}
