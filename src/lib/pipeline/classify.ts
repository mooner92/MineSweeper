import type { DocType } from '@/lib/domain';
import { parseFilename } from '@/lib/filename';

/**
 * Stage 2 — doc-type classification.
 * Priority: [tag] > filename keyword (hindex) > folder hint > 1st-page content fallback.
 */

const TAG_TO_DOCTYPE: Record<string, DocType> = {
  학위논문: 'degree_thesis',
  대표연구실적: 'representative_research',
  학술논문: 'journal_article',
};

export interface Classification {
  docType: DocType;
  method: 'tag' | 'filename' | 'folder' | 'content' | 'default';
  confidence: number;
}

export function classifyDocType(input: {
  filename: string;
  folderCategory?: string | null;
  firstPageText?: string | null;
}): Classification {
  const { tag } = parseFilename(input.filename);
  if (tag && TAG_TO_DOCTYPE[tag]) {
    return { docType: TAG_TO_DOCTYPE[tag], method: 'tag', confidence: 0.99 };
  }

  const lower = input.filename.toLowerCase();
  if (/h[\s_-]?index|scholar/.test(lower)) {
    return { docType: 'hindex', method: 'filename', confidence: 0.95 };
  }

  const folder = input.folderCategory ?? '';
  if (/학위|논문첨부/.test(folder)) {
    return { docType: 'degree_thesis', method: 'folder', confidence: 0.7 };
  }
  if (/학술|게재/.test(folder)) {
    return { docType: 'journal_article', method: 'folder', confidence: 0.6 };
  }

  const text = input.firstPageText ?? '';
  if (text) {
    if (/지도\s*교수|심사\s*위원|위원장|학위\s*논문|dissertation|thesis advisor|committee member/i.test(text)) {
      return { docType: 'degree_thesis', method: 'content', confidence: 0.6 };
    }
    if (/abstract|초록|keywords|저자|authors?|©|doi:/i.test(text)) {
      return { docType: 'journal_article', method: 'content', confidence: 0.55 };
    }
  }

  return { docType: 'unknown', method: 'default', confidence: 0.3 };
}
