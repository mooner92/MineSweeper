import { NextResponse } from 'next/server';
import { getRoundCandidates } from '@/lib/rounds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 회차 통합 뷰 재계산 — 선택한 지원자(applicantIds)들의 제척 합집합과 섭외 가능 전문가를 함께 반환.
 * 지원자 선택·분야·검색이 바뀔 때마다 클라이언트가 호출한다.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    applicantIds?: unknown;
    dae?: string | null;
    mid?: string | null;
    q?: string | null;
    limit?: number;
  };
  const applicantIds = Array.isArray(body.applicantIds)
    ? body.applicantIds.filter((x): x is string => typeof x === 'string')
    : [];
  const limit =
    Number.isFinite(body.limit) && (body.limit as number) > 0
      ? Math.min(body.limit as number, 5000)
      : 60;

  const view = await getRoundCandidates({
    applicantIds,
    dae: body.dae ?? null,
    mid: body.mid ?? null,
    q: body.q ?? null,
    limit,
  });
  return NextResponse.json(view);
}
