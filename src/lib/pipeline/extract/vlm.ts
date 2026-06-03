import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { namesMatch } from '@/lib/names';
import type { ExtractInput, Extractor, RawPerson } from '@/lib/pipeline/types';
import { buildExtractionPrompt } from './prompts';
import { defaultRoleForDoc, roleFromLabel } from './roles';
import { clamp01, extractJsonBlock, normalizeSourceKind } from './util';

const personSchema = z.object({
  name: z.string().min(1),
  role: z.string().nullish(),
  affiliation: z.string().nullish(),
  source_kind: z.string().nullish(),
  page: z.number().nullish(),
  confidence: z.number().nullish(),
  is_self: z.boolean().nullish(),
});

const responseSchema = z.object({
  persons: z.array(personSchema).default([]),
});

export interface VlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export function vlmConfigFromEnv(): VlmConfig {
  return {
    baseUrl: process.env.VLM_BASE_URL ?? 'http://localhost:11434/v1',
    apiKey: process.env.VLM_API_KEY ?? 'ollama',
    model: process.env.VLM_MODEL ?? 'qwen3.5:9B',
    timeoutMs: Number(process.env.VLM_TIMEOUT_MS ?? 120000),
  };
}

type ChatContent = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/**
 * On-prem extractor over an OpenAI-compatible endpoint (vLLM / Ollama). Sends document text
 * (and page images for scanned/hindex docs) and parses a strict JSON person list. Kept
 * dependency-free (uses global fetch) and fully typed; it is not exercised by tests.
 */
export class VlmExtractor implements Extractor {
  readonly name: string;

  constructor(private readonly cfg: VlmConfig = vlmConfigFromEnv()) {
    this.name = `vlm:${cfg.model}`;
  }

  async extract(input: ExtractInput): Promise<RawPerson[]> {
    const text = input.pages
      .map((p) => p.text)
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 24000);
    const { system, user } = buildExtractionPrompt(input.docType, text, input.selfName);

    const content: ChatContent[] = [{ type: 'text', text: user }];
    for (const img of input.imagePaths ?? []) {
      const b64 = await readFile(img)
        .then((b) => b.toString('base64'))
        .catch(() => null);
      if (b64) content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    let json: unknown;
    try {
      const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: this.cfg.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content },
          ],
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`VLM HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`);
      }
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = body.choices?.[0]?.message?.content ?? '{}';
      json = JSON.parse(extractJsonBlock(raw));
    } finally {
      clearTimeout(timer);
    }

    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) return [];

    return parsed.data.persons.map((p) => {
      const isSelf = p.is_self ?? (input.selfName ? namesMatch(p.name, input.selfName) : false);
      const person: RawPerson = {
        nameRaw: p.name,
        role: roleFromLabel(p.role) ?? defaultRoleForDoc(input.docType),
        affiliation: p.affiliation ?? null,
        sourceKind: normalizeSourceKind(p.source_kind),
        sourcePage: p.page ?? 1,
        confidence: clamp01(p.confidence ?? 0.6),
        isSelf,
        ocrEngine: this.name,
        ocrConfidence: p.confidence ?? null,
      };
      return person;
    });
  }
}
