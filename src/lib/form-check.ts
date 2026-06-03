import { normalizeName } from '@/lib/names';

/**
 * Shared name "form check" — does a short string plausibly look like a single person's name?
 * Extracted from the stub extractor so stub / vlm / future OCR extractors apply the SAME
 * charset/length/stopword rules (no duplication). This is a precision gate, not a guarantee.
 */

/** Korean tokens that are role/title/org words, never a person name on their own. */
export const KO_STOPWORDS = new Set([
  '교수',
  '교수님',
  '박사',
  '석사',
  '위원',
  '위원장',
  '지도',
  '심사',
  '학과',
  '학과장',
  '대학',
  '대학교',
  '대학원',
  '공동',
  '부지도',
  '주임',
  '학장',
  '원장',
  '연구',
  '논문',
  '심사위원',
  '지도교수',
]);

/** Latin words that signal an affiliation/role line rather than a person name. */
export const LATIN_STOPWORDS =
  /\b(University|Department|College|School|Professor|Committee|Advisor|Supervisor|Institute|Graduate|Faculty|Dean|Chair|Member|Examiner|Head|Of|The|And|For|Dissertation|Thesis)\b/i;

/** Does this short segment look like a single person's name? (Korean 2–4 syllables, or 2–4 Latin capitalized tokens.) */
export function isPersonName(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (/^[가-힣](?:\s?[가-힣]){1,3}$/.test(t)) {
    return !KO_STOPWORDS.has(normalizeName(t));
  }
  const tokens = t.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 4) return false;
  if (LATIN_STOPWORDS.test(t)) return false;
  return tokens.every((tok) => /^[A-Z][a-zA-Z]*\.?$/.test(tok));
}
