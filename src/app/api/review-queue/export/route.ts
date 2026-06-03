import { NextResponse } from 'next/server';
import { FLAG_TYPE_LABELS_KO, type FlagType } from '@/lib/domain';
import { csvEscape } from '@/lib/csv';
import { getReviewQueue } from '@/lib/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const flag = new URL(req.url).searchParams.get('flag');
  const all = await getReviewQueue();
  const items = flag ? all.filter((it) => it.flag.flagType === flag) : all;

  const headers = ['applicant', 'flag_type', 'item', 'filename', 'document_id'];
  const rows = items.map((it) =>
    [
      it.applicantName ?? it.applicantId,
      FLAG_TYPE_LABELS_KO[it.flag.flagType as FlagType] ?? it.flag.flagType,
      it.personName ?? '',
      it.filename ?? '',
      it.documentId ?? '',
    ]
      .map((c) => csvEscape(String(c)))
      .join(','),
  );
  const csv = `﻿${headers.join(',')}\n${rows.join('\n')}\n`;

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="review-queue.csv"',
    },
  });
}
