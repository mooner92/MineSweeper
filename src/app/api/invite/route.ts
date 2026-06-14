import { NextResponse } from 'next/server';
import { addInvitation, getInvitations, removeInvitation } from '@/lib/invite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  applicantId?: string;
  expertId?: string;
}

/** 초빙 명단에 담기. 갱신된 활성 명단을 반환한다. */
export async function POST(req: Request) {
  const { applicantId, expertId } = (await req.json()) as Body;
  if (!applicantId || !expertId)
    return NextResponse.json({ error: 'applicantId, expertId required' }, { status: 400 });
  await addInvitation(applicantId, expertId);
  return NextResponse.json({ ok: true, invitations: await getInvitations(applicantId) });
}

/** 초빙 명단에서 빼기(soft delete). 갱신된 활성 명단을 반환한다. */
export async function DELETE(req: Request) {
  const { applicantId, expertId } = (await req.json()) as Body;
  if (!applicantId || !expertId)
    return NextResponse.json({ error: 'applicantId, expertId required' }, { status: 400 });
  await removeInvitation(applicantId, expertId);
  return NextResponse.json({ ok: true, invitations: await getInvitations(applicantId) });
}
