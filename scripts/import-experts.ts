/**
 * KEI 심사위원 후보 전문가 풀(.xlsx)을 experts 테이블로 적재한다. 한 전문가가 세부분야마다 여러
 * 행으로 나오므로 ID 기준으로 합치고, 분류체계 경로(대>중>소>세부)를 fields 배열로 모은다.
 * 재실행 시 **전체 교체**(명단 갱신본 재적재). 매칭 키는 nameKey(관계자 대조와 동일 로직).
 *
 *   npx tsx scripts/import-experts.ts <xlsx 경로>
 *
 * 주의: 명단은 PII(이름·이메일·전화)다. DB(*.db)는 .gitignore 대상이며 절대 커밋하지 않는다.
 */
import ExcelJS from 'exceljs';
import { getDb } from '@/db/client';
import { experts, type NewExpert } from '@/db/schema';
import type { ExpertField } from '@/lib/domain';
import { nameKey } from '@/lib/names';

function cellStr(cell: ExcelJS.Cell): string {
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

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('사용법: npx tsx scripts/import-experts.ts <xlsx 경로>');
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];

  // 헤더명 → 1-based 열. 중복 헤더('성명'이 4열·28열)는 **첫 번째**만 채택한다.
  const col: Record<string, number> = {};
  const header = ws.getRow(1);
  for (let c = 1; c <= ws.columnCount; c++) {
    const name = cellStr(header.getCell(c));
    if (name && !(name in col)) col[name] = c;
  }
  const need = ['ID', '성명', '소속기관', '직위', '전화(모바일)', 'e-메일', '등록일자', '대분류', '중분류', '소분류', '세부분야'];
  const missing = need.filter((h) => !(h in col));
  if (missing.length) {
    console.error(`헤더를 찾지 못했습니다: ${missing.join(', ')}`);
    process.exit(1);
  }
  const get = (row: ExcelJS.Row, h: string) => cellStr(row.getCell(col[h]));

  // ID 기준으로 합치며 세부분야 경로를 모은다.
  const byId = new Map<string, NewExpert & { _fieldKeys: Set<string> }>();
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const id = get(row, 'ID');
    const name = get(row, '성명');
    if (!id || !name) continue;

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
        (e.fields as ExpertField[]).push(field);
      }
    }
  }

  const rows: NewExpert[] = [...byId.values()].map(({ _fieldKeys, ...rest }) => rest);
  const db = getDb();
  await db.delete(experts); // 전체 교체
  for (let i = 0; i < rows.length; i += 100) {
    await db.insert(experts).values(rows.slice(i, i + 100));
  }

  const withFields = rows.filter((r) => (r.fields as ExpertField[]).length > 0).length;
  console.log(`✓ 전문가 ${rows.length}명 적재 (분야 태깅 ${withFields}명 / 미태깅 ${rows.length - withFields}명)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
