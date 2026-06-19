import { NextResponse } from 'next/server';
import { getRoundCandidates } from '@/lib/rounds';
import { candidatesCsv, excludedCsv, roundXlsxBuffer } from '@/lib/expert-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 회차 섭외 산출물 내보내기.
 *   ?applicantIds=a,b,c & round=2401 & dae= & mid= & format=xlsx|csv & type=candidates|excluded
 * format=xlsx(기본): 시트1 섭외 가능 전문가 / 시트2 제척 대상(사유).
 * format=csv: type 으로 한 명단만(candidates 기본).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const applicantIds = (u.searchParams.get('applicantIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // 빈 선택이면 '제척 0명·풀 전체가 섭외 가능'이라는 위험한 산출물이 나온다 — 거부한다(UI도 막지만 직접 호출 방어).
  if (applicantIds.length === 0) {
    return NextResponse.json({ error: 'applicantIds required' }, { status: 400 });
  }
  // 헤더 인젝션 방지 — 파일명에 들어가는 round 값은 안전 문자만.
  const round = (u.searchParams.get('round') || 'round').replace(/[^\w.-]/g, '_');
  const format = u.searchParams.get('format') ?? 'xlsx';
  const type = u.searchParams.get('type') ?? 'candidates';

  // 내보내기는 상한 없이 전체 명단을 담는다(filterExperts의 slice가 전체를 반환).
  const view = await getRoundCandidates({
    applicantIds,
    dae: u.searchParams.get('dae'),
    mid: u.searchParams.get('mid'),
    q: u.searchParams.get('q'),
    limit: Number.MAX_SAFE_INTEGER,
  });

  if (format === 'csv') {
    const csv = type === 'excluded' ? excludedCsv(view.conflicts) : candidatesCsv(view.items);
    const name = type === 'excluded' ? '제척대상' : '섭외가능';
    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${round}_${name}.csv"`,
      },
    });
  }

  const buf = await roundXlsxBuffer(view.items, view.conflicts);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${round}_면접위원섭외.xlsx"`,
    },
  });
}
