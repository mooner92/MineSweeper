import type { SourceKind } from '@/lib/domain';
import { SOURCE_KINDS } from '@/lib/domain';

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function normalizeSourceKind(s?: string | null): SourceKind {
  const k = (s ?? 'printed').toLowerCase();
  return (SOURCE_KINDS as readonly string[]).includes(k) ? (k as SourceKind) : 'printed';
}

/** Pull the first JSON object out of a model response (handles ```json fences and prose). */
export function extractJsonBlock(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) return candidate.slice(start, end + 1);
  return candidate.trim() || '{}';
}
