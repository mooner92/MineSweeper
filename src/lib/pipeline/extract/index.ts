import type { Extractor } from '@/lib/pipeline/types';
import { EnsembleExtractor } from './ensemble';
import { StubExtractor } from './stub';
import { VlmExtractor } from './vlm';

/**
 * Choose the Stage-3 extractor.
 *  - "stub"     (default) — deterministic, GPU-free, used by tests.
 *  - "vlm"      — single on-prem model (OpenAI-compatible: local vLLM / Ollama).
 *  - "ensemble" — multiple local vLLM models voted together (precision/filtering).
 */
export function getExtractor(mode: string = process.env.EXTRACTOR_MODE ?? 'stub'): Extractor {
  if (mode === 'ensemble') return new EnsembleExtractor();
  if (mode === 'vlm') return new VlmExtractor();
  return new StubExtractor();
}

export { StubExtractor, VlmExtractor, EnsembleExtractor };
export { extractFromVlmEndpoint } from './vlm';
export { buildExtractionPrompt } from './prompts';
export { roleFromLabel, defaultRoleForDoc } from './roles';
