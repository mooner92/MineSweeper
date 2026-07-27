import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { EXPERT_HEADERS } from '@/lib/expert-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 전문가 풀·면접 감독관 명단 **예시 양식(xlsx)** 다운로드 — 담당자가 받아 채워 넣도록 제공.
 * 헤더는 파서(`EXPERT_HEADERS`)와 동일한 단일 출처를 쓰므로 양식과 파싱이 항상 일치한다.
 * 예시 행은 합성(PII 아님)이며, 한 사람이 세부분야마다 여러 행으로 들어가는 패턴을 보여 준다.
 */

// [헤더 → 값] 예시. 홍길동(ID 1001)은 세부분야가 둘이라 두 행 — 같은 ID/성명, 분야만 다르게.
const EXAMPLES: Array<Record<string, string>> = [
  {
    ID: '1001',
    성명: '홍길동',
    소속기관: '예시대학교',
    직위: '교수',
    '전화(모바일)': '010-0000-0001',
    'e-메일': 'hong@example.ac.kr',
    등록일자: '2026-01-01',
    대분류: '물국토',
    중분류: '물관리',
    소분류: '수자원',
    세부분야: '하천관리',
  },
  {
    ID: '1001',
    성명: '홍길동',
    소속기관: '예시대학교',
    직위: '교수',
    '전화(모바일)': '010-0000-0001',
    'e-메일': 'hong@example.ac.kr',
    등록일자: '2026-01-01',
    대분류: '물국토',
    중분류: '물관리',
    소분류: '수자원',
    세부분야: '통합물관리',
  },
  {
    ID: '1002',
    성명: '김철수',
    소속기관: '예시연구원',
    직위: '연구위원',
    '전화(모바일)': '010-0000-0002',
    'e-메일': 'kim@example.re.kr',
    등록일자: '2026-01-02',
    대분류: '기후대기',
    중분류: '대기환경',
    소분류: '미세먼지',
    세부분야: '배출저감',
  },
];

const GUIDE = [
  ['작성 안내'],
  ['- 1행(헤더)의 이름을 바꾸지 마세요. 이 순서·이름 그대로여야 업로드됩니다.'],
  ['- ID: 명단 내 고유 식별자(숫자/문자). 같은 사람은 같은 ID를 쓰세요.'],
  ['- 한 사람이 분야가 여러 개면, ID·성명은 같게 두고 행을 추가해 대분류~세부분야만 다르게 채웁니다(예: 홍길동 2행).'],
  ['- 등록일자는 YYYY-MM-DD 형식 권장.'],
  ['- 예시 행(홍길동·김철수)은 지우고 실제 명단으로 채워 업로드하세요. 명단은 개인정보이니 내부에서만 다룹니다.'],
];

export async function GET() {
  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet('전문가명단');
  ws.addRow([...EXPERT_HEADERS]);
  for (const ex of EXAMPLES) ws.addRow(EXPERT_HEADERS.map((h) => ex[h] ?? ''));
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => (c.width = 16));

  const guide = wb.addWorksheet('작성안내');
  GUIDE.forEach((r) => guide.addRow(r));
  guide.getRow(1).font = { bold: true };
  guide.getColumn(1).width = 90;

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="expert_list_template.xlsx"; filename*=UTF-8''${encodeURIComponent('면접위원_명단_양식.xlsx')}`,
    },
  });
}
