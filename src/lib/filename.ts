/**
 * Filename / folder parsing.
 *
 * Convention (plan §2): applicant folder = "<id> (<name>)"; file = "<id>_[<tag>]_<title>".
 * The [tag] alone decides doc-type ~100% of the time, regardless of PDF vs PNG.
 */

export interface ParsedFilename {
  applicantId: string | null;
  /** Raw bracket tag content, e.g. "학위논문" (null when absent). */
  tag: string | null;
  title: string | null;
  degree: 'master' | 'doctoral' | null;
  language: 'ko' | 'en' | null;
  /** Filename without extension. */
  base: string;
}

export function parseFilename(filename: string): ParsedFilename {
  const justName = filename.split(/[/\\]/).pop() ?? filename;
  const base = justName.replace(/\.[^.]+$/, '');

  const m = /^([^_]+)_(?:\[([^\]]+)\]_?)?(.*)$/.exec(base);
  let applicantId: string | null = null;
  let tag: string | null = null;
  let title: string | null = null;
  if (m) {
    applicantId = m[1]?.trim() || null;
    tag = m[2]?.trim() || null;
    title = m[3]?.trim() || null;
  } else {
    title = base.trim() || null;
  }

  const degree: ParsedFilename['degree'] = /박사|doctoral|ph\.?\s?d/i.test(base)
    ? 'doctoral'
    : /석사|master/i.test(base)
      ? 'master'
      : null;
  const language: ParsedFilename['language'] = /영문|english/i.test(base)
    ? 'en'
    : /국문|korean/i.test(base)
      ? 'ko'
      : null;

  return { applicantId, tag, title, degree, language, base };
}

export interface ParsedFolder {
  applicantId: string | null;
  applicantName: string | null;
}

/** "2401-000001 (홍길동)" -> { applicantId: "2401-000001", applicantName: "홍길동" } */
export function parseApplicantFolder(folderName: string): ParsedFolder {
  const trimmed = folderName.trim();
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(trimmed);
  if (m) {
    return { applicantId: m[1].trim() || null, applicantName: m[2].trim() || null };
  }
  return { applicantId: trimmed || null, applicantName: null };
}
