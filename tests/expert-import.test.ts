import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseExpertWorkbook } from '@/lib/expert-import';

const HEADER = [
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
];

function makeWb(rows: (string | number)[][]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('s');
  rows.forEach((r) => ws.addRow(r));
  return wb;
}

describe('parseExpertWorkbook — 전문가/감독관 명단 xlsx 파싱(공용)', () => {
  it('ID 기준으로 합치고 세부분야 경로를 누적한다', () => {
    const wb = makeWb([
      HEADER,
      ['1', '홍길동', 'A대', '교수', '010', 'h@a.kr', '2024-01-01', '대', '중', '소', '세부1'],
      ['1', '홍길동', 'A대', '교수', '010', 'h@a.kr', '2024-01-01', '대', '중', '소', '세부2'],
      ['2', '김철수', 'B연', '연구원', '011', 'k@b.kr', '2024-02-01', '대2', '중2', '', ''],
    ]);
    const { rows, missingHeaders, skipped } = parseExpertWorkbook(wb);
    expect(missingHeaders).toEqual([]);
    expect(rows).toHaveLength(2); // ID 1·2 → 2명
    const hong = rows.find((r) => r.id === '1')!;
    expect(hong.fields).toHaveLength(2); // 세부1·세부2 누적
    expect(hong.name).toBe('홍길동');
    expect(hong.nameKey).toBeTruthy();
    expect(hong.affiliation).toBe('A대');
    expect(skipped).toBe(0);
  });

  it('필수 헤더가 없으면 rows=[] + missingHeaders 로 알린다', () => {
    const wb = makeWb([['ID', '성명'], ['1', '홍']]);
    const { rows, missingHeaders } = parseExpertWorkbook(wb);
    expect(rows).toEqual([]);
    expect(missingHeaders.length).toBeGreaterThan(0);
  });

  it('ID/성명이 일부만 있는 행만 skipped 로 센다(완전 빈 행은 무시)', () => {
    const wb = makeWb([
      HEADER,
      ['', '이름만', '', '', '', '', '', '', '', '', ''], // ID 없음 → skipped
      ['3', '정상', 'C', '', '', '', '', '', '', '', ''],
    ]);
    const { rows, skipped } = parseExpertWorkbook(wb);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('정상');
    expect(skipped).toBe(1);
  });
});
