import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { parseExpertWorkbook } from '@/lib/expert-import';
import { clearRoundPool, saveRoundPool } from '@/lib/round-pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 20 * 1024 * 1024;

/** 회차 면접 감독관 명단 업로드(xlsx, 전문가 풀과 같은 포맷) — 그 회차분 전체 교체 저장. */
export async function POST(req: Request, { params }: { params: { round: string } }) {
  const round = params.round === 'none' ? '' : params.round;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다(multipart).' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'xlsx 파일(field "file")이 필요합니다.' }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ error: '.xlsx 파일만 업로드할 수 있습니다.' }, { status: 422 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '파일이 너무 큽니다(최대 20MB).' }, { status: 413 });
  }

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: 'xlsx 파일을 읽지 못했습니다.' }, { status: 422 });
  }

  const { rows, missingHeaders, skipped } = parseExpertWorkbook(wb);
  if (missingHeaders.length) {
    return NextResponse.json(
      { error: `필수 헤더를 찾지 못했습니다: ${missingHeaders.join(', ')}` },
      { status: 422 },
    );
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: '유효한 명단 행이 없습니다.' }, { status: 422 });
  }

  const meta = await saveRoundPool(round, rows, file.name);
  return NextResponse.json({ meta, skipped });
}

/** 회차 명단 삭제 → 전역 전문가 풀로 되돌린다. */
export async function DELETE(_req: Request, { params }: { params: { round: string } }) {
  const round = params.round === 'none' ? '' : params.round;
  await clearRoundPool(round);
  return NextResponse.json({ ok: true });
}
