import { NextResponse } from 'next/server';
import { getRoundCandidates } from '@/lib/rounds';
import { getRoundPool } from '@/lib/round-pool';
import {
  candidatesCsv,
  candidatesXlsxBuffer,
  excludedCsv,
  roundXlsxBuffer,
} from '@/lib/expert-export';

/** 비ASCII 파일명 안전 처리 — ASCII 폴백 + RFC 5987 UTF-8. */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\w.-]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

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
  const rawRound = u.searchParams.get('round') ?? '';
  // 헤더 인젝션 방지 — 파일명에 들어가는 round 값은 안전 문자만.
  const round = (rawRound || 'round').replace(/[^\w.-]/g, '_');
  const format = u.searchParams.get('format') ?? 'xlsx';
  const type = u.searchParams.get('type') ?? 'candidates';

  // 내보내기는 상한 없이 전체 명단을 담는다(filterExperts의 slice가 전체를 반환).
  const view = await getRoundCandidates({
    round: rawRound === 'none' ? '' : rawRound,
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
        'content-disposition': contentDisposition(`${round}_${name}.csv`),
      },
    });
  }

  const buf = await roundXlsxBuffer(view.items, view.conflicts);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': contentDisposition(`${round}_면접위원섭외.xlsx`),
    },
  });
}

/**
 * 선택한 면접위원만 내보내기 — 클라이언트가 고른 expertIds를 회차 풀에서 찾아 단일 명단(섭외 명단)으로.
 * 표시 데이터가 아니라 서버 풀에서 id로 다시 찾으므로 산출물의 무결성이 보장된다.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    round?: string;
    expertIds?: unknown;
    format?: string;
  };
  const round = typeof body.round === 'string' && body.round !== 'none' ? body.round : '';
  const ids = Array.isArray(body.expertIds)
    ? body.expertIds.filter((x): x is string => typeof x === 'string')
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'expertIds required' }, { status: 400 });
  }
  const format = body.format === 'csv' ? 'csv' : 'xlsx';
  const idSet = new Set(ids);
  const pool = await getRoundPool(round);
  const selected = pool.experts
    .filter((e) => idSet.has(e.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const safeRound = (round || 'round').replace(/[^\w.-]/g, '_');

  if (format === 'csv') {
    return new NextResponse(candidatesCsv(selected), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': contentDisposition(`${safeRound}_선택면접위원.csv`),
      },
    });
  }
  const buf = await candidatesXlsxBuffer(selected);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': contentDisposition(`${safeRound}_선택면접위원.xlsx`),
    },
  });
}
