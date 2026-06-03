import type { Role } from '@/lib/domain';
import { namesMatch, normalizeName } from '@/lib/names';
import type { ExtractInput, Extractor, RawPerson } from '@/lib/pipeline/types';

/**
 * Deterministic, GPU-free extractor. It is the default for development and the only extractor
 * used by tests, so the whole pipeline is verifiable without a model. The on-prem VLM
 * (extract/vlm.ts) is the production path; this stub encodes the same rules heuristically.
 *
 * Guarantees that the tests pin:
 *  - thesis committee/advisor roles parsed from printed cover/approval text
 *  - article coauthors parsed from the page-1 author block, NEVER from References
 *  - applicant self tagged via conservative name matching
 *  - image-only docs (hindex) return [] — no fabrication
 */

const KO_STOPWORDS = new Set([
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

const LATIN_STOPWORDS =
  /\b(University|Department|College|School|Professor|Committee|Advisor|Supervisor|Institute|Graduate|Faculty|Dean|Chair|Member|Examiner|Head|Of|The|And|For|Dissertation|Thesis)\b/i;

const THESIS_ROLE_PATTERNS: Array<{ role: Role; re: RegExp }> = [
  { role: 'co_supervisor', re: /(부\s*지도\s*교수|공동\s*지도\s*교수|공동\s*지도|co-?\s*advisor|co-?\s*supervisor|co-?\s*chair)/i },
  { role: 'supervisor', re: /(지도\s*교수|thesis\s*advisor|\badvisor\b|\bsupervisor\b)/i },
  { role: 'department_head', re: /(학과장|주임\s*교수|head\s*of\s*department|department\s*head)/i },
  { role: 'committee', re: /(심사\s*위원장|심사\s*위원|위원장|committee\s*member|\bcommittee\b|\bexaminer\b|\bchair\b)/i },
];

function searchIdx(text: string, re: RegExp): number {
  const m = re.exec(text);
  return m ? m.index : -1;
}

function stripAuthorMarkers(s: string): string {
  // Remove affiliation superscripts/markers (digits, *, daggers) but keep letters.
  return s.replace(/[0-9*†‡§¶¹²³]+/g, '').trim();
}

/** Does this short segment look like a single person's name? */
function isPersonName(s: string): boolean {
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

/** Extract name candidates from a text segment, preferring Korean then Latin. */
function matchNames(seg: string): string[] {
  const names: string[] = [];

  const ko = seg.match(/[가-힣](?:\s?[가-힣]){1,3}/g);
  if (ko) {
    for (const k of ko) {
      const n = normalizeName(k);
      if (n.length >= 2 && !KO_STOPWORDS.has(n)) names.push(n);
    }
  }
  if (names.length) return names;

  const la = seg.match(/[A-Z][a-zA-Z]*\.?(?:\s+[A-Z][a-zA-Z]*\.?){1,3}/g);
  if (la) {
    for (const l of la) {
      const n = l.trim();
      if (!LATIN_STOPWORDS.test(n)) names.push(n);
    }
  }
  return names;
}

function namesAround(line: string, start: number, end: number): string[] {
  const after = matchNames(line.slice(end));
  if (after.length) return after;
  return matchNames(line.slice(0, start));
}

function extractThesis(input: ExtractInput): RawPerson[] {
  const pages = input.pages.slice(0, 2);
  const out: RawPerson[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    const lines = page.text
      .split(/[\n;]+/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      for (const { role, re } of THESIS_ROLE_PATTERNS) {
        const m = re.exec(line);
        if (!m) continue;
        const names = namesAround(line, m.index, m.index + m[0].length);
        for (const nm of names) {
          const key = `${role}:${normalizeName(nm)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            nameRaw: nm,
            role,
            affiliation: null,
            sourceKind: 'printed',
            sourcePage: page.pageNumber,
            confidence: 0.9,
            evidence: line,
          });
        }
        break; // at most one role per line
      }
    }
  }
  return out;
}

function extractArticleAuthors(input: ExtractInput): RawPerson[] {
  const page = input.pages[0];
  if (!page || !page.text) return [];

  let text = page.text;
  // Never read past the references section.
  const refIdx = searchIdx(text, /references|참고\s*문헌|bibliography/i);
  if (refIdx > 0) text = text.slice(0, refIdx);
  // The author block sits before the abstract / introduction.
  const stopIdx = searchIdx(text, /\babstract\b|초록|keywords|\bintroduction\b|서\s*론/i);
  const block = stopIdx > 0 ? text.slice(0, stopIdx) : text.slice(0, 800);

  const emails = block.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? [];
  const domain = emails[0]?.split('@')[1] ?? null;

  // The first non-empty line is the paper title — never treat it as authors. This, plus
  // requiring an explicit author signal below, prevents Title-Case titles (e.g. "Sustainable
  // Urban Drainage Systems") from being fabricated as people. Precision over recall: a lone
  // single-author line with no initial/separator is skipped (the VLM path handles such cases).
  const nonEmpty = block
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const candidateLines = nonEmpty.slice(1);

  const names: string[] = [];
  for (const line of candidateLines) {
    const segs = line
      .split(/,|·|;|&|\band\b/i)
      .map((s) => stripAuthorMarkers(s))
      .filter(Boolean);
    if (segs.length === 0) continue;
    // Every segment must look like a person name (rules out affiliation/title lines)...
    if (!segs.every((s) => isPersonName(s))) continue;
    // ...AND the line must carry an author signal: a name list (>=2 segments), an explicit
    // separator, or an initial token (e.g. "John D. Carter"). A bare multi-word Title-Case
    // phrase has none of these and is rejected.
    const hasSeparator = /[,·;&]|\band\b/i.test(line);
    const hasInitial = /(^|\s)[A-Z]\.?(\s|$)/.test(line);
    if (segs.length >= 2 || hasSeparator || hasInitial) {
      for (const s of segs) names.push(s.trim());
    }
  }

  const seen = new Set<string>();
  const out: RawPerson[] = [];
  for (const nm of names) {
    const key = normalizeName(nm).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      nameRaw: nm,
      role: 'coauthor',
      affiliation: domain,
      sourceKind: 'printed',
      sourcePage: page.pageNumber,
      confidence: 0.85,
      evidence: nm,
    });
  }
  return out;
}

function tagSelf(persons: RawPerson[], selfName?: string): RawPerson[] {
  if (!selfName) return persons;
  return persons.map((p) => ({
    ...p,
    isSelf: p.isSelf || namesMatch(p.nameRaw, selfName),
  }));
}

export class StubExtractor implements Extractor {
  readonly name = 'stub';

  async extract(input: ExtractInput): Promise<RawPerson[]> {
    switch (input.docType) {
      case 'degree_thesis':
        return tagSelf(extractThesis(input), input.selfName);
      case 'journal_article':
      case 'representative_research':
        return tagSelf(extractArticleAuthors(input), input.selfName);
      case 'hindex':
        // Image-only google-scholar capture: vision required, do not fabricate.
        return [];
      default:
        return tagSelf(extractArticleAuthors(input), input.selfName);
    }
  }
}
