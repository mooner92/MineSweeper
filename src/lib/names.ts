/**
 * Name normalization and conservative matching.
 *
 * Stage-1 principle (plan §3.3): merge only what is *certain*; when in doubt, keep separate
 * so a human can decide. We do not fuzzy-match across scripts and we never merge bare
 * initials that lack an anchoring surname.
 */

export type Script = 'korean' | 'han' | 'latin' | 'mixed' | 'unknown';

const HANGUL = /[가-힣]/;
const HANGUL_SYLLABLE = /^[가-힣]$/;
const HAN = /[一-鿿㐀-䶿]/;
const LATIN = /[A-Za-z]/;

/** Collapse whitespace, strip seal markers, and join Korean inter-syllable spacing. */
export function normalizeName(raw: string): string {
  if (!raw) return '';
  let s = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  // Drop trailing certification markers like "(인)", "(서명)".
  s = s.replace(/\(\s*(?:인|서명|signature|seal)\s*\)/gi, '').trim();
  // 자간 정규화: "이 준 호" -> "이준호" (only when every token is a single Hangul syllable).
  const tokens = s.split(' ');
  if (tokens.length >= 2 && tokens.every((t) => HANGUL_SYLLABLE.test(t))) {
    s = tokens.join('');
  }
  return s.replace(/\s+/g, ' ').trim();
}

export function detectScript(name: string): Script {
  const hasKo = HANGUL.test(name);
  const hasHan = HAN.test(name);
  const hasLatin = LATIN.test(name);
  const count = [hasKo, hasHan, hasLatin].filter(Boolean).length;
  if (count === 0) return 'unknown';
  if (count > 1) return 'mixed';
  if (hasKo) return 'korean';
  if (hasHan) return 'han';
  return 'latin';
}

/** A token is "initials" if, ignoring dots, it is 1-3 letters and all uppercase (e.g. G, G., CK, G.D.). */
function isInitialsToken(t: string): boolean {
  const letters = t.replace(/\./g, '');
  return (
    letters.length >= 1 &&
    letters.length <= 3 &&
    /^[A-Za-z]+$/.test(letters) &&
    letters === letters.toUpperCase()
  );
}

interface LatinParts {
  firstInitial: string | null;
  surname: string | null;
  given: string[];
  /** The first given-name token (e.g. "John" or "G."), or null. */
  firstGiven: string | null;
  /** True when the first given token is only an initial ("G", "G.", "CK"). */
  firstGivenIsInitial: boolean;
}

function latinParts(name: string): LatinParts {
  const s = normalizeName(name);
  let surname: string | null = null;
  let given: string[] = [];

  if (s.includes(',')) {
    // "Surname, Given M." order
    const [fam, ...rest] = s.split(',');
    surname = fam.trim() || null;
    given = rest.join(',').trim().split(/\s+/).filter(Boolean);
  } else {
    const tokens = s.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return { firstInitial: null, surname: null, given: [], firstGiven: null, firstGivenIsInitial: false };
    }
    if (tokens.length === 1) {
      // Single token: a lone surname (no given-name anchor) or bare initials.
      if (isInitialsToken(tokens[0])) {
        return {
          firstInitial: tokens[0].replace(/\./g, '')[0].toUpperCase(),
          surname: null,
          given: tokens,
          firstGiven: tokens[0],
          firstGivenIsInitial: true,
        };
      }
      return { firstInitial: null, surname: tokens[0], given: [], firstGiven: null, firstGivenIsInitial: false };
    }
    const last = tokens[tokens.length - 1];
    if (isInitialsToken(last)) {
      // Trailing initials => no reliable surname (bare initials only).
      surname = null;
      given = tokens;
    } else {
      surname = last;
      given = tokens.slice(0, -1);
    }
  }

  const firstGiven = given.find((t) => LATIN.test(t)) ?? null;
  const firstInitial = firstGiven ? firstGiven.replace(/\./g, '')[0].toUpperCase() : null;
  return {
    firstInitial,
    surname,
    given,
    firstGiven,
    firstGivenIsInitial: firstGiven ? isInitialsToken(firstGiven) : false,
  };
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** A stable dedup key. Equal keys are candidates for merging; matching is confirmed by namesMatch. */
export function nameKey(name: string): string {
  const norm = normalizeName(name);
  const script = detectScript(norm);
  if (script === 'korean' || script === 'han') {
    return `${script}:${norm.replace(/\s+/g, '')}`;
  }
  if (script === 'latin') {
    const p = latinParts(norm);
    if (p.surname && p.firstInitial) {
      return `latin:${p.firstInitial.toLowerCase()} ${p.surname.toLowerCase()}`;
    }
    return `latin-raw:${norm.toLowerCase()}`;
  }
  return `raw:${norm.toLowerCase()}`;
}

/**
 * Confident match only.
 * - Same script required (no cross-script guessing).
 * - Korean/Han: exact normalized equality.
 * - Latin: exact, OR same surname + same first initial (full-name <-> initial form).
 * - Bare initials with no surname never match (too ambiguous).
 */
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const sa = detectScript(na);
  const sb = detectScript(nb);
  if (sa !== sb) return false;

  if (sa === 'korean' || sa === 'han') {
    return na.replace(/\s+/g, '') === nb.replace(/\s+/g, '');
  }

  if (sa === 'latin') {
    if (na.toLowerCase() === nb.toLowerCase()) return true;
    const pa = latinParts(na);
    const pb = latinParts(nb);
    if (
      pa.surname &&
      pb.surname &&
      pa.firstInitial &&
      pb.firstInitial &&
      pa.surname.toLowerCase() === pb.surname.toLowerCase() &&
      pa.firstInitial.toLowerCase() === pb.firstInitial.toLowerCase()
    ) {
      // Same surname + same first initial. Confidently merge a full name with an initial form,
      // but do NOT merge two DIFFERENT full given names ("John Carter" vs "Gary Carter").
      const aFull = pa.firstGiven && !pa.firstGivenIsInitial;
      const bFull = pb.firstGiven && !pb.firstGivenIsInitial;
      if (aFull && bFull) {
        return pa.firstGiven!.toLowerCase() === pb.firstGiven!.toLowerCase();
      }
      return true;
    }
    return false;
  }

  return false;
}

/** The "J Carter" short form, or null when no surname/initial can be derived. */
export function initialsForm(name: string): string | null {
  const p = latinParts(name);
  if (p.firstInitial && p.surname) return `${p.firstInitial} ${capitalize(p.surname)}`;
  return null;
}

/** How complete a name is (3 = full, 2 = surname+initial, 1 = ambiguous). Used to pick a canonical. */
export function nameCompleteness(name: string): number {
  const norm = normalizeName(name);
  const script = detectScript(norm);
  if (script === 'korean' || script === 'han') return norm.replace(/\s+/g, '').length >= 2 ? 3 : 1;
  if (script === 'latin') {
    const p = latinParts(norm);
    const hasFullGiven = p.given.some((t) => !isInitialsToken(t) && /[a-z]/.test(t));
    if (p.surname && hasFullGiven) return 3;
    if (p.surname) return 2;
    return 1;
  }
  return 1;
}
