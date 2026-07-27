/**
 * KEI 심사위원 후보 전문가 풀(.xlsx)을 experts 테이블로 적재한다(전역 풀). 파싱은 공용
 * `@/lib/expert-import`(회차별 명단 업로드와 동일 로직)을 쓴다. 재실행 시 **전체 교체**.
 *
 *   npx tsx scripts/import-experts.ts <xlsx 경로>
 *
 * 주의: 명단은 PII(이름·이메일·전화)다. DB(*.db)는 .gitignore 대상이며 절대 커밋하지 않는다.
 */
import ExcelJS from 'exceljs';
import { getDb } from '@/db/client';
import { experts } from '@/db/schema';
import { parseExpertWorkbook } from '@/lib/expert-import';

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('사용법: npx tsx scripts/import-experts.ts <xlsx 경로>');
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const { rows, missingHeaders, skipped } = parseExpertWorkbook(wb);
  if (missingHeaders.length) {
    console.error(`헤더를 찾지 못했습니다: ${missingHeaders.join(', ')}`);
    process.exit(1);
  }

  const db = getDb();
  await db.delete(experts); // 전체 교체
  for (let i = 0; i < rows.length; i += 100) {
    await db.insert(experts).values(rows.slice(i, i + 100));
  }

  const withFields = rows.filter((r) => r.fields.length > 0).length;
  console.log(
    `✓ 전문가 ${rows.length}명 적재 (분야 태깅 ${withFields}명 / 미태깅 ${rows.length - withFields}명, 건너뜀 ${skipped})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
