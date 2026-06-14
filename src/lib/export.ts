import ExcelJS from 'exceljs';
import { sharedInstitution } from '@/lib/checks';
import { csvEscape } from '@/lib/csv';
import { DOC_TYPE_LABELS_KO, ROLE_LABELS_KO } from '@/lib/domain';
import { coiTypesFromRoles } from '@/lib/experts';
import { estimateKoreanName } from '@/lib/hangulize';
import type { AggregatedPerson } from '@/lib/pipeline/types';

export interface ExportRow {
  canonicalName: string;
  koreanNameEst: string;
  roles: string;
  coiType: string;
  affiliation: string;
  sameAffiliation: string;
  sources: string;
  needsHuman: string;
  isSelf: string;
}

export interface ExportOptions {
  /**
   * 지원자 본인 소속(들) — 동일소속기관(same_affiliation) 판정 기준. 호출부가 self 행을 미리
   * 걸러내는 경우(내보내기 라우트) 여기로 넘긴다. 생략하면 aggregates의 isSelf 행에서 수집.
   */
  selfAffiliations?: Array<string | null | undefined>;
}

export function toExportRows(aggregates: AggregatedPerson[], opts: ExportOptions = {}): ExportRow[] {
  const selfAffs =
    opts.selfAffiliations ?? aggregates.filter((a) => a.isSelf).map((a) => a.affiliation);
  return aggregates.map((a) => {
    const koreanEst = estimateKoreanName(a.canonicalName);
    return {
    canonicalName: a.canonicalName,
    // 로마자 표기 한국 이름의 한글 추정 병기 — 심사위원 풀(한글명) 수기 대조용. 빈 값 = 추정 불가/불필요.
    // 값 자체에 '(추정)'을 붙여 셀만 복사돼도 확정 한글명처럼 보이지 않게 한다.
    koreanNameEst: koreanEst ? `${koreanEst}(추정)` : '',
    roles: a.roles.map((r) => ROLE_LABELS_KO[r]).join(', '),
    // 제척 유형(NSF식 분류: 사제/공저/공동과제/심사) — 표준 산출물용. 본인은 제척 대상 아님.
    coiType: a.isSelf ? '' : coiTypesFromRoles(a.roles).map((t) => t.label).join(', '),
    affiliation: a.affiliation ?? '',
    // 기관 단위 제척 근거 — 매칭된 기관명을 그대로 적는다(빈 값 = 무관 또는 판정 불가).
    sameAffiliation: a.isSelf ? '' : (sharedInstitution(selfAffs, a.affiliation) ?? ''),
    sources: a.sources.map((s) => `${DOC_TYPE_LABELS_KO[s.docType]} p.${s.page}`).join('; '),
    needsHuman: a.needsHuman ? 'Y' : 'N',
    isSelf: a.isSelf ? 'Y' : 'N',
    };
  });
}

const HEADERS: Array<{ key: keyof ExportRow; label: string }> = [
  { key: 'canonicalName', label: 'canonical_name' },
  { key: 'koreanNameEst', label: 'korean_name_est' },
  { key: 'roles', label: 'roles' },
  { key: 'coiType', label: 'coi_type' },
  { key: 'affiliation', label: 'affiliation' },
  { key: 'sameAffiliation', label: 'same_affiliation' },
  { key: 'sources', label: 'sources' },
  { key: 'needsHuman', label: 'needs_human' },
  { key: 'isSelf', label: 'is_self' },
];

/** UTF-8 CSV with BOM so Excel renders Korean correctly. */
export function toCsv(aggregates: AggregatedPerson[], opts: ExportOptions = {}): string {
  const rows = toExportRows(aggregates, opts);
  const head = HEADERS.map((h) => h.label).join(',');
  const body = rows.map((r) => HEADERS.map((h) => csvEscape(r[h.key])).join(',')).join('\n');
  return `﻿${head}\n${body}\n`;
}

export async function toXlsxBuffer(
  aggregates: AggregatedPerson[],
  opts: ExportOptions = {},
): Promise<Buffer> {
  const rows = toExportRows(aggregates, opts);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('관계자');
  ws.columns = HEADERS.map((h) => ({ header: h.label, key: h.key, width: 24 }));
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
