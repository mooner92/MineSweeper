import { readFile } from 'node:fs/promises';
import type { DocType } from '@/lib/domain';
import { namesMatch } from '@/lib/names';
import type { ExtractInput, Extractor, PageBundle, RawPerson } from '@/lib/pipeline/types';
import { buildExtractionPrompt } from './prompts';
import { defaultRoleForDoc, roleFromLabel } from './roles';
import { clamp01, extractJsonBlock, normalizeSourceKind } from './util';

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

// ---------------------------------------------------------------------------
// Input windowing
// ---------------------------------------------------------------------------

/** Fraction of the char budget for the head; the rest samples the tail (맨 뒤 연구진 명단/감사의 글). */
const FRONT_RATIO = 0.75;

/** 논문류는 저자가 1페이지 상단에만 있다 — 본문·참고문헌(특히 12쪽 전체)은 추출에 해롭다. */
const AUTHOR_BLOCK_PAGE_CAP = 2;

/**
 * 추출에 쓸 페이지를 문서 유형에 맞게 고른다. ingest는 앞 N + 뒤 M 페이지를 모두 담아오지만,
 * 저자/심사위원은 문서 **앞쪽**에만 있고 뒤 페이지(본문·참고문헌)는 노이즈다. 특히 12쪽 논문
 * 전체를 그대로 넣으면 7B 모델이 "참고문헌 인용 저자 제외" 규칙을 과적용해 1페이지 저자 블록까지
 * 0명 처리하는 것을 실측으로 확인했다(샘플 학술논문 → 0명). 연구보고서만 참여연구진 명단이
 * 맨 뒤에 붙으므로 앞+뒤 윈도우를 모두 유지한다.
 */
export function selectPagesForExtraction(pages: PageBundle[], docType: DocType): PageBundle[] {
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  // 연구보고서: 참여연구진이 끝에 올 수 있어 앞+뒤 모두 본다.
  if (docType === 'research_project') return sorted;
  // 논문류(학술논문·대표연구실적·구글스칼라): 저자 블록은 1~2페이지 상단에만 → 앞 2페이지로 제한.
  if (
    docType === 'journal_article' ||
    docType === 'representative_research' ||
    docType === 'hindex'
  ) {
    return sorted.filter((p) => p.pageNumber <= AUTHOR_BLOCK_PAGE_CAP);
  }
  // 학위논문·기타: 뒤 윈도우(본문 끝·감사의 글)는 빼고 앞쪽 연속 구간만 — 인준/심사위원은 앞에 있다.
  const front: PageBundle[] = [];
  for (const p of sorted) {
    if (front.length && p.pageNumber > front[front.length - 1].pageNumber + 1) break;
    front.push(p);
  }
  return front;
}

/**
 * Join pages into model input text. Each page is tagged `[p.N]` (grounds the model's `page` field),
 * non-contiguous pages (PDF front/back window) get an explicit gap marker so the model does not
 * read them as continuous prose, and when the total exceeds maxChars the budget is split head/tail
 * instead of the old head-only slice — names at the END of a long report (참여연구진, Acknowledgements)
 * were previously cut off entirely.
 */
export function buildTextWindow(pages: PageBundle[], maxChars: number): string {
  const parts: string[] = [];
  let prev: number | null = null;
  for (const p of pages) {
    if (!p.text) continue;
    if (prev !== null && p.pageNumber > prev + 1) {
      parts.push(`…(${prev + 1}~${p.pageNumber - 1}쪽 생략)…`);
    }
    parts.push(`[p.${p.pageNumber}]\n${p.text}`);
    prev = p.pageNumber;
  }
  const text = parts.join('\n\n');
  if (text.length <= maxChars) return text;

  const gap = '\n\n…(중략)…\n\n';
  const front = Math.floor((maxChars - gap.length) * FRONT_RATIO);
  const back = maxChars - gap.length - front;
  return `${text.slice(0, front)}${gap}${text.slice(text.length - back)}`;
}

// ---------------------------------------------------------------------------
// Response parsing — lenient per item (A1) + truncation salvage (A2).
// The old zod all-or-nothing parse silently discarded EVERY person in a document
// when a single item was malformed (e.g. page:"1") — many-author papers came back 0명.
// ---------------------------------------------------------------------------

const asStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const asNum = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const asBool = (v: unknown): boolean | null =>
  typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null;

export interface VlmPerson {
  name: string;
  role: string | null;
  affiliation: string | null;
  sourceKind: string | null;
  page: number | null;
  confidence: number | null;
  isSelf: boolean | null;
}

export interface VlmParseResult {
  persons: VlmPerson[];
  /** Items without a usable name, skipped individually (the rest survive). */
  dropped: number;
  /** True when the JSON was broken (truncated response) and persons were recovered object-by-object. */
  salvaged: boolean;
  /** True when VALID JSON contained no recognizable person list (e.g. {"error":...}) — caller warns. */
  unrecognized: boolean;
}

/** Only `name` is required; every other field degrades to null instead of killing the item. */
function toPerson(item: unknown): VlmPerson | null {
  if (typeof item !== 'object' || item === null) return null;
  const o = item as Record<string, unknown>;
  const name = asStr(o.name);
  if (!name) return null;
  return {
    name,
    role: asStr(o.role),
    affiliation: asStr(o.affiliation),
    sourceKind: asStr(o.source_kind),
    page: asNum(o.page),
    confidence: asNum(o.confidence),
    isSelf: asBool(o.is_self),
  };
}

/** Recover complete `{...}` person objects from broken/truncated JSON (incomplete tail is skipped). */
function salvagePersons(raw: string): VlmPerson[] {
  const persons: VlmPerson[] = [];
  for (const m of raw.matchAll(/\{[^{}]*\}/g)) {
    try {
      const p = toPerson(JSON.parse(m[0]));
      if (p) persons.push(p);
    } catch {
      /* incomplete trailing object — skip */
    }
  }
  return persons;
}

const tryJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

/**
 * Parse a model response into persons. Accepts {persons:[...]}, a bare top-level array, an
 * alternate array key ({people:[...]}), or a single person object. Malformed items are dropped
 * individually (counted), broken JSON falls back to object-by-object salvage, and an
 * unrecoverable response THROWS so the caller logs the failure instead of reporting 0명.
 */
/** Array keys the model plausibly uses for the person list, tried before "any array" fallback. */
const PERSON_LIST_KEYS = ['persons', 'people', 'authors', 'names', 'results'];

export function parseVlmResponse(raw: string): VlmParseResult {
  const json = tryJson(raw.trim()) ?? tryJson(extractJsonBlock(raw));
  if (json === undefined) {
    const persons = salvagePersons(raw);
    if (persons.length === 0) {
      throw new Error(`VLM 응답 JSON 파싱 실패: ${raw.slice(0, 200)}`);
    }
    return { persons, dropped: 0, salvaged: true, unrecognized: false };
  }

  let items: unknown[];
  let unrecognized = false;
  if (Array.isArray(json)) {
    items = json;
  } else if (typeof json === 'object' && json !== null) {
    const o = json as Record<string, unknown>;
    const namedKey = PERSON_LIST_KEYS.find((k) => Array.isArray(o[k]));
    const anyArray = Object.values(o).find(Array.isArray) as unknown[] | undefined;
    if (namedKey) {
      items = o[namedKey] as unknown[];
    } else if (anyArray) {
      items = anyArray;
    } else if (toPerson(json)) {
      items = [json];
    } else {
      // Valid JSON but no person shape at all ({"error":...} 등) — NOT the same as a legitimate
      // empty list. Flag it so the caller logs instead of silently reporting 0명 (US-002).
      items = [];
      unrecognized = Object.keys(o).length > 0;
    }
  } else {
    items = [];
    unrecognized = json !== null; // bare scalar ("ok", 0, …) — not a person list either
  }

  const persons: VlmPerson[] = [];
  let dropped = 0;
  for (const item of items) {
    const p = toPerson(item);
    if (p) persons.push(p);
    else dropped += 1;
  }
  return { persons, dropped, salvaged: false, unrecognized };
}

// ---------------------------------------------------------------------------
// Endpoint call
// ---------------------------------------------------------------------------

/**
 * Call ONE OpenAI-compatible endpoint (local vLLM / Ollama) and parse the person list leniently.
 * Shared by VlmExtractor (single model) and EnsembleExtractor (multi-model voting). No external
 * API — the base URL points at a local server. Throws on transport/HTTP/unparseable-response
 * error so the ensemble can treat a failed endpoint as "no result" without aborting the vote.
 */
export async function extractFromVlmEndpoint(
  cfg: VlmConfig,
  input: ExtractInput,
): Promise<RawPerson[]> {
  const engine = `vlm:${cfg.model}`;
  // Front/back split budget so the prompt fits the model context even for 수백~수천 쪽 reports
  // while still covering names at the end. 8000자(+이미지 토큰)는 16k 컨텍스트에 여유 있게 들어간다
  // — 한글은 1자당 ~1.3토큰이라 12000자는 16385토큰으로 한도(16384)를 넘겨 통째로 400이 났다.
  // 잘린 본문의 정형 명단은 run.ts의 supplementRoster가 별도로 보강한다. Tunable: VLM_MAX_TEXT_CHARS.
  const envChars = Number(process.env.VLM_MAX_TEXT_CHARS);
  const maxChars = Number.isFinite(envChars) && envChars > 0 ? envChars : 8000;
  const pages = selectPagesForExtraction(input.pages, input.docType);
  const text = buildTextWindow(pages, maxChars);
  const { system, user } = buildExtractionPrompt(input.docType, text, input.selfName);

  const content: ChatContent[] = [{ type: 'text', text: user }];
  for (const img of input.imagePaths ?? []) {
    const b64 = await readFile(img)
      .then((b) => b.toString('base64'))
      .catch(() => null);
    if (b64) content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  let raw: string;
  let finishReason: string | null;
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
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
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>;
    };
    raw = body.choices?.[0]?.message?.content ?? '{}';
    finishReason = body.choices?.[0]?.finish_reason ?? null;
  } finally {
    clearTimeout(timer);
  }

  // Truncated responses (token limit) usually break the JSON mid-array; the salvage path below
  // still recovers the complete leading items, but flag it — recall may be reduced.
  if (finishReason === 'length') {
    // eslint-disable-next-line no-console
    console.warn(`[${engine}] 응답이 토큰 한도에서 잘림(finish_reason=length) — ${input.filename}`);
  }

  const { persons, dropped, salvaged, unrecognized } = parseVlmResponse(raw);
  if (salvaged) {
    // eslint-disable-next-line no-console
    console.warn(`[${engine}] 손상된 JSON 응답에서 ${persons.length}명 부분 복구 — ${input.filename}`);
  }
  if (dropped > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[${engine}] 형식 오류 항목 ${dropped}개 제외(이름 누락 등) — ${input.filename}`);
  }
  if (unrecognized) {
    // eslint-disable-next-line no-console
    console.warn(
      `[${engine}] 응답에서 person 목록을 찾지 못함(비표준 형태) — ${input.filename}: ${raw.slice(0, 200)}`,
    );
  }

  const vlmPersons = persons.map((p) => {
    const isSelf = p.isSelf ?? (input.selfName ? namesMatch(p.name, input.selfName) : false);
    const person: RawPerson = {
      nameRaw: p.name,
      role: roleFromLabel(p.role) ?? defaultRoleForDoc(input.docType),
      affiliation: p.affiliation,
      sourceKind: normalizeSourceKind(p.sourceKind),
      sourcePage: p.page ?? 1,
      confidence: clamp01(p.confidence ?? 0.6),
      isSelf,
      ocrEngine: engine,
      ocrConfidence: p.confidence,
    };
    return person;
  });

  // 정형 명단(참여연구진·공동연구개발기관·참여자 명단·저자 블록)의 결정적(regex) 추출은
  // run.ts(supplementRoster)에서 추출기 성공/실패와 무관하게 union한다 — 여기서 하면 VLM HTTP
  // 실패(16k 초과·timeout) 시 명단까지 함께 유실되므로 의도적으로 이 함수 밖으로 옮겼다.
  return vlmPersons;
}

/**
 * On-prem extractor over a single OpenAI-compatible endpoint (vLLM / Ollama). Sends document
 * text (and page images for scanned/hindex docs) and parses the person list leniently. Kept
 * dependency-free (uses global fetch); the parsing/windowing helpers are unit-tested.
 */
export class VlmExtractor implements Extractor {
  readonly name: string;

  constructor(private readonly cfg: VlmConfig = vlmConfigFromEnv()) {
    this.name = `vlm:${cfg.model}`;
  }

  extract(input: ExtractInput): Promise<RawPerson[]> {
    return extractFromVlmEndpoint(this.cfg, input);
  }
}
