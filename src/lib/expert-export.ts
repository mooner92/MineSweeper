import ExcelJS from 'exceljs';
import { csvEscape } from '@/lib/csv';
import { DOC_TYPE_LABELS_KO, ROLE_LABELS_KO } from '@/lib/domain';
import type { Expert } from '@/db/schema';
import type { RoundConflict } from '@/lib/rounds';

/**
 * 회차 단위 섭외 산출물 — 인사팀이 받는 두 명단:
 *  1) 섭외 가능 전문가(제척되지 않은 전문가 = 면접위원 후보)
 *  2) 제척 대상(누구를·왜 뺐는지 근거)
 * 이름·이메일·전화 등 PII를 포함하므로 산출물은 내부에서만 다룬다.
 */

/** 분류체계 경로 요약 — `대 > 중 > 세부` (없는 단계는 건너뜀), 여러 분야는 ` | ` 로. */
export function fieldsLabel(e: Pick<Expert, 'fields'>): string {
  return e.fields
    .map((f) => [f.dae, f.mid, f.sub, f.det].filter(Boolean).join(' > '))
    .join(' | ');
}

const AVAIL_HEADERS = ['이름', '소속', '직위', '분야', '이메일', '전화'] as const;

function availRow(e: Expert): string[] {
  return [
    e.name,
    e.affiliation ?? '',
    e.position ?? '',
    fieldsLabel(e),
    e.email ?? '',
    e.phone ?? '',
  ];
}

const EXCL_HEADERS = [
  '이름',
  '소속',
  '직위',
  '분야',
  '판정',
  '충돌 지원자',
  '제척 유형',
  '근거(문서·페이지·역할)',
] as const;

function exclRow(c: RoundConflict): string[] {
  const applicants = [...new Set(c.byApplicant.map((a) => a.applicantName))].join(', ');
  const coiTypes = [
    ...new Set(c.byApplicant.flatMap((a) => a.coiTypes.map((t) => t.label))),
  ].join(', ');
  const sources = c.byApplicant
    .flatMap((a) => a.sources.map((s) => `${DOC_TYPE_LABELS_KO[s.docType]} p.${s.page} ${ROLE_LABELS_KO[s.role]}`))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join('; ');
  return [
    c.expert.name,
    c.expert.affiliation ?? '',
    c.expert.position ?? '',
    fieldsLabel(c.expert),
    c.confidence === 'low' ? '확인 필요(동명이인 가능)' : '제척',
    applicants,
    coiTypes,
    sources,
  ];
}

/** UTF-8 BOM CSV — Excel 한글 깨짐 방지. */
function toCsv(headers: readonly string[], rows: string[][]): string {
  const head = headers.join(',');
  const body = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  return `﻿${head}\n${body}\n`;
}

export function candidatesCsv(experts: Expert[]): string {
  return toCsv(AVAIL_HEADERS, experts.map(availRow));
}

export function excludedCsv(conflicts: RoundConflict[]): string {
  return toCsv(EXCL_HEADERS, conflicts.map(exclRow));
}

/** 한 통합 워크북: 시트1 섭외 가능 전문가 / 시트2 제척 대상(사유). */
export async function roundXlsxBuffer(
  available: Expert[],
  excluded: RoundConflict[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const ws1 = wb.addWorksheet('섭외 가능 전문가');
  ws1.addRow([...AVAIL_HEADERS]);
  available.forEach((e) => ws1.addRow(availRow(e)));
  ws1.getRow(1).font = { bold: true };
  ws1.columns.forEach((c) => (c.width = 24));

  const ws2 = wb.addWorksheet('제척 대상');
  ws2.addRow([...EXCL_HEADERS]);
  excluded.forEach((c) => ws2.addRow(exclRow(c)));
  ws2.getRow(1).font = { bold: true };
  ws2.columns.forEach((c) => (c.width = 24));

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
