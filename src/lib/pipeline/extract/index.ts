import type { Extractor } from '@/lib/pipeline/types';
import { StubExtractor } from './stub';
import { VlmExtractor } from './vlm';

/** Choose the Stage-3 extractor. Default "stub" (deterministic); "vlm" hits the on-prem model. */
export function getExtractor(mode: string = process.env.EXTRACTOR_MODE ?? 'stub'): Extractor {
  return mode === 'vlm' ? new VlmExtractor() : new StubExtractor();
}

export { StubExtractor, VlmExtractor };
export { buildExtractionPrompt } from './prompts';
export { roleFromLabel, defaultRoleForDoc } from './roles';
