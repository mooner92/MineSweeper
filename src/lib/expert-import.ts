import type ExcelJS from 'exceljs';
import type { ExpertField } from '@/lib/domain';
import { nameKey } from '@/lib/names';

/**
 * 전문가 풀/면접 감독관 명단 xlsx 파싱(공용) — 전역 풀 적재(`scripts/import-experts.ts`)와 회차별
 * 명단 업로드(`POST /api/rounds/[round]/pool`)가 같은 포맷을 같은 로직으로 읽는다. 한 사람이
 * 세부분야마다 여러 행으로 나오므로 ID 기준으로 합치고 분류체계 경로를 `fields` 로 모은다. DB 무관(순수).
 */

export interface ParsedExpert {
  /** 외부(KEI) ID — 명단 내 안정적 식별자. */
  id: string;
  name: string;
  nameKey: string;
  affiliation: string | null;
  position: string | null;
  email: string | null;
  phone: string | null;
  registeredAt: string | null;
  fields: ExpertField[];
}

export interface ParseResult {
  rows: ParsedExpert[];
  /** 필수 헤더 중 못 찾은 것 — 비어 있어야 정상. */
  missingHeaders: string[];
  /** id/성명이 일부만 있어 건너뛴 행 수. */
  skipped: number;
}

/** 전문가 풀·면접 감독관 명단 xlsx의 필수 헤더(순서 = 예시 양식 컬럼 순서). 파서·양식 다운로드 공용. */
export const EXPERT_HEADERS = [
  'ID',
  '성명',
  '소속기관',
  '직위',
  '전화(모바일)',
  'e-메일',
  '등록일자',
  '대분류',
  '중분류',
  '소분류',
  '세부분야',
] as const;

export function cellStr(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10); // 등록일자 → YYYY-MM-DD
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown };
    if ('text' in o && o.text != null) return String(o.text).trim();
    if ('result' in o && o.result != null) return String(o.result).trim();
  }
  return String(v).trim();
}

/** 첫 워크시트를 파싱한다. 헤더 누락 시 rows=[] + missingHeaders 로 알린다(호출부가 422 처리). */
export function parseExpertWorkbook(wb: ExcelJS.Workbook): ParseResult {
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], missingHeaders: [...EXPERT_HEADERS], skipped: 0 };

  // 헤더명 → 1-based 열. 중복 헤더('성명'이 여러 열)는 첫 번째만 채택.
  const col: Record<string, number> = {};
  const header = ws.getRow(1);
  for (let c = 1; c <= ws.columnCount; c++) {
    const name = cellStr(header.getCell(c));
    if (name && !(name in col)) col[name] = c;
  }
  const missingHeaders = EXPERT_HEADERS.filter((h) => !(h in col));
  if (missingHeaders.length) return { rows: [], missingHeaders, skipped: 0 };

  const get = (row: ExcelJS.Row, h: string) => cellStr(row.getCell(col[h]));
  const byId = new Map<string, ParsedExpert & { _fieldKeys: Set<string> }>();
  let skipped = 0;

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const id = get(row, 'ID');
    const name = get(row, '성명');
    if (!id || !name) {
      if (id || name) skipped++; // 일부만 채워진 행만 집계(완전 빈 행은 무시)
      continue;
    }

    let e = byId.get(id);
    if (!e) {
      e = {
        id,
        name,
        nameKey: nameKey(name),
        affiliation: get(row, '소속기관') || null,
        position: get(row, '직위') || null,
        email: get(row, 'e-메일') || null,
        phone: get(row, '전화(모바일)') || null,
        registeredAt: get(row, '등록일자') || null,
        fields: [],
        _fieldKeys: new Set<string>(),
      };
      byId.set(id, e);
    }
    const field: ExpertField = {
      dae: get(row, '대분류'),
      mid: get(row, '중분류'),
      sub: get(row, '소분류'),
      det: get(row, '세부분야'),
    };
    if (field.dae || field.mid || field.sub || field.det) {
      const key = `${field.dae}|${field.mid}|${field.sub}|${field.det}`;
      if (!e._fieldKeys.has(key)) {
        e._fieldKeys.add(key);
        e.fields.push(field);
      }
    }
  }

  const rows = [...byId.values()].map(({ _fieldKeys, ...rest }) => rest);
  return { rows, missingHeaders: [], skipped };
}
