import { NextResponse } from 'next/server';
import { setApplicantField } from '@/lib/invite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  applicantId?: string;
  dae?: string | null;
  mid?: string | null;
}

/** 섭외 후보 기본 필터로 쓸 지원자 분야(대/중분류)를 저장 — 재방문 시 유지. */
export async function PUT(req: Request) {
  const { applicantId, dae, mid } = (await req.json()) as Body;
  if (!applicantId) return NextResponse.json({ error: 'applicantId required' }, { status: 400 });
  await setApplicantField(applicantId, dae ?? null, mid ?? null);
  return NextResponse.json({ ok: true });
}
