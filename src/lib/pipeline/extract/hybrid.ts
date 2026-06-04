import type { ExtractInput, Extractor, RawPerson } from '@/lib/pipeline/types';
import { StubExtractor } from './stub';
import { VlmExtractor } from './vlm';

/**
 * Routes per document by whether it has a usable text layer:
 *  - text-layer pages  → fast, deterministic stub (best for clean printed PDFs)
 *  - image-only (scanned PDF / hindex) → on-prem VLM (OCRs names from the page image)
 *
 * Best of both: keep speed/precision on text documents while still extracting names from
 * image-only documents. Both extractors are injectable for GPU-free unit testing.
 */
export class HybridExtractor implements Extractor {
  readonly name = 'hybrid';

  constructor(
    private readonly textExtractor: Extractor = new StubExtractor(),
    private readonly imageExtractor: Extractor = new VlmExtractor(),
  ) {}

  extract(input: ExtractInput): Promise<RawPerson[]> {
    const hasText = input.pages.some((p) => p.hasText && p.text.trim().length > 0);
    return (hasText ? this.textExtractor : this.imageExtractor).extract(input);
  }
}
