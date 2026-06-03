import ExcelJS from 'exceljs';
import { csvEscape } from '@/lib/csv';
import { DOC_TYPE_LABELS_KO, ROLE_LABELS_KO } from '@/lib/domain';
import type { AggregatedPerson } from '@/lib/pipeline/types';

export interface ExportRow {
  canonicalName: string;
  roles: string;
  affiliation: string;
  sources: string;
  needsHuman: string;
  isSelf: string;
}

export function toExportRows(aggregates: AggregatedPerson[]): ExportRow[] {
  return aggregates.map((a) => ({
    canonicalName: a.canonicalName,
    roles: a.roles.map((r) => ROLE_LABELS_KO[r]).join(', '),
    affiliation: a.affiliation ?? '',
    sources: a.sources.map((s) => `${DOC_TYPE_LABELS_KO[s.docType]} p.${s.page}`).join('; '),
    needsHuman: a.needsHuman ? 'Y' : 'N',
    isSelf: a.isSelf ? 'Y' : 'N',
  }));
}

const HEADERS: Array<{ key: keyof ExportRow; label: string }> = [
  { key: 'canonicalName', label: 'canonical_name' },
  { key: 'roles', label: 'roles' },
  { key: 'affiliation', label: 'affiliation' },
  { key: 'sources', label: 'sources' },
  { key: 'needsHuman', label: 'needs_human' },
  { key: 'isSelf', label: 'is_self' },
];

/** UTF-8 CSV with BOM so Excel renders Korean correctly. */
export function toCsv(aggregates: AggregatedPerson[]): string {
  const rows = toExportRows(aggregates);
  const head = HEADERS.map((h) => h.label).join(',');
  const body = rows.map((r) => HEADERS.map((h) => csvEscape(r[h.key])).join(',')).join('\n');
  return `﻿${head}\n${body}\n`;
}

export async function toXlsxBuffer(aggregates: AggregatedPerson[]): Promise<Buffer> {
  const rows = toExportRows(aggregates);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('관계자');
  ws.columns = HEADERS.map((h) => ({ header: h.label, key: h.key, width: 24 }));
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
