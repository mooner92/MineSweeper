import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import AdmZip from 'adm-zip';
import * as CFB from 'cfb';
import type { IngestResult } from '@/lib/pipeline/types';

/**
 * HWP 5.x (binary CFB/OLE) + HWPX (OWPML zip) text extraction — pure Node (cfb + zlib + adm-zip),
 * no native deps, no external converter, no sudo. Korean recruitment attachments keep the relevant
 * people in the document text (연구책임자/연구원 명단, 저자 블록), which is what we extract here.
 *
 * Stamp/signature detection inside HWP needs full page rendering (out of scope here); an HWP that
 * yields no text still surfaces for human review via the needs_vision flag. Any parse failure
 * degrades to an empty result so the pipeline keeps running.
 */

const HWPTAG_PARA_TEXT = 67;
// HWP record control codes that occupy 1 wchar (2 bytes). Every other code < 32 is an inline/
// extended control occupying 8 wchars (16 bytes) and is skipped.
const CHAR_CONTROLS = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);

/** Parse plain text out of one decompressed HWP BodyText/Section stream (HWPTAG records). */
function parseSection(buf: Buffer): string {
  let text = '';
  let p = 0;
  while (p + 4 <= buf.length) {
    const header = buf.readUInt32LE(p);
    p += 4;
    const tagId = header & 0x3ff;
    let size = (header >>> 20) & 0xfff;
    if (size === 0xfff) {
      if (p + 4 > buf.length) break;
      size = buf.readUInt32LE(p);
      p += 4;
    }
    if (tagId === HWPTAG_PARA_TEXT) {
      const rec = buf.subarray(p, p + size);
      let i = 0;
      while (i + 1 < rec.length) {
        const code = rec.readUInt16LE(i);
        if (code >= 32) {
          text += String.fromCharCode(code);
          i += 2;
        } else if (code === 10 || code === 13) {
          text += '\n';
          i += 2;
        } else if (CHAR_CONTROLS.has(code)) {
          i += 2;
        } else {
          i += 16; // inline/extended control = 8 wchars
        }
      }
      text += '\n';
    }
    p += size;
  }
  return text;
}

function extractHwp(filepath: string): string {
  const container = CFB.read(readFileSync(filepath), { type: 'buffer' });
  const entries = container.FileIndex.map((entry, i) => ({ entry, path: container.FullPaths[i] }));

  const fileHeader = entries.find((e) => /FileHeader$/i.test(e.path));
  // FileHeader byte 36, bit 0 = "compressed" flag.
  const compressed = fileHeader ? (Buffer.from(fileHeader.entry.content)[36] & 1) === 1 : true;

  const sections = entries
    .filter((e) => /BodyText\/Section\d+$/i.test(e.path))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));

  let text = '';
  for (const { entry } of sections) {
    let buf = Buffer.from(entry.content);
    if (compressed) {
      try {
        buf = inflateRawSync(buf);
      } catch {
        continue; // one unreadable section shouldn't lose the rest
      }
    }
    text += parseSection(buf);
  }
  return text;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

function extractHwpx(filepath: string): string {
  const zip = new AdmZip(filepath);
  const sections = zip
    .getEntries()
    .filter((e) => /Contents\/section\d+\.xml$/i.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));

  let text = '';
  for (const e of sections) {
    const xml = e.getData().toString('utf8');
    // OWPML body text sits in <hp:t>…</hp:t> runs; fall back to stripping all tags.
    const runs = xml.match(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g);
    const raw = runs
      ? runs.map((r) => r.replace(/<[^>]+>/g, '')).join('')
      : xml.replace(/<[^>]+>/g, ' ');
    text += `${decodeXmlEntities(raw)}\n`;
  }
  return text;
}

function cleanup(text: string): string {
  return text
    .replace(/[^\S\n]+/g, ' ') // collapse horizontal whitespace (incl. NBSP/ideographic), keep newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function ingestHwp(filepath: string): IngestResult {
  let text = '';
  try {
    const isHwpx = extname(filepath).toLowerCase() === '.hwpx';
    text = cleanup(isHwpx ? extractHwpx(filepath) : extractHwp(filepath));
  } catch (err) {
    return {
      format: 'hwp',
      filepath,
      pages: [],
      pageCount: 0,
      hasTextLayer: false,
      note: `hwp 파싱 실패: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const hasText = text.length > 0;
  return {
    format: 'hwp',
    filepath,
    pages: [{ pageNumber: 1, text, hasText }],
    pageCount: 1,
    hasTextLayer: hasText,
    note: hasText ? undefined : 'hwp: 추출된 텍스트 없음(스캔/이미지형 가능 — 사람 확인 필요)',
  };
}
