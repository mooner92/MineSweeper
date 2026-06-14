import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { applicants } from '@/db/schema';
import type { ExpertField } from '@/lib/domain';
import { getInvitations } from '@/lib/invite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fieldText = (fields: ExpertField[]): string =>
  fields.map((f) => [f.dae, f.mid, f.sub, f.det].filter(Boolean).join(' > ')).join(' | ');

/** 초빙(섭외) 명단을 Excel로 — 담은 시점 스냅샷 그대로(변질 없음). */
export async function GET(req: Request) {
  const applicantId = new URL(req.url).searchParams.get('applicantId');
  if (!applicantId) return new NextResponse('applicantId required', { status: 400 });

  const db = getDb();
  const applicant = (
    await db.select().from(applicants).where(eq(applicants.id, applicantId)).limit(1)
  )[0];
  const rows = await getInvitations(applicantId);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('초빙명단');
  ws.columns = [
    { header: '성명', key: 'name', width: 14 },
    { header: '소속', key: 'affiliation', width: 30 },
    { header: '직위', key: 'position', width: 18 },
    { header: 'e-메일', key: 'email', width: 28 },
    { header: '전화', key: 'phone', width: 18 },
    { header: '분야', key: 'fields', width: 50 },
    { header: '담은일시', key: 'createdAt', width: 20 },
  ];
  for (const r of rows) {
    ws.addRow({
      name: r.name,
      affiliation: r.affiliation ?? '',
      position: r.position ?? '',
      email: r.email ?? '',
      phone: r.phone ?? '',
      fields: fieldText(r.fields),
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString().slice(0, 16).replace('T', ' ') : '',
    });
  }
  ws.getRow(1).font = { bold: true };

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const base = (applicant?.name ?? applicantId).replace(/[^\w가-힣.-]/g, '_');
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="invitations-${base}.xlsx"; filename*=UTF-8''${encodeURIComponent(`초빙명단-${applicant?.name ?? applicantId}.xlsx`)}`,
    },
  });
}
