import { NextResponse } from 'next/server';
import { getInviteCandidates } from '@/lib/invite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 섭외 후보 검색 — 제척·기담음 제외, 분야(대/중분류)·이름·소속 필터. 상위 N명만. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const applicantId = u.searchParams.get('applicantId');
  if (!applicantId) return NextResponse.json({ error: 'applicantId required' }, { status: 400 });
  // '더 보기'가 보낸 limit을 반영(미지정/이상값이면 기본 60, 과도값은 2000으로 상한).
  const parsed = Number(u.searchParams.get('limit'));
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 2000) : 60;
  const { items, total } = await getInviteCandidates({
    applicantId,
    dae: u.searchParams.get('dae'),
    mid: u.searchParams.get('mid'),
    q: u.searchParams.get('q'),
    limit,
  });
  return NextResponse.json({ items, total });
}
