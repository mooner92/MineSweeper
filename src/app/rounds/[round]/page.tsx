import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRoundApplicants, getRoundCandidates } from '@/lib/rounds';
import { RoundInvitePanel } from '@/components/RoundInvitePanel';

export const dynamic = 'force-dynamic';

/** 회차 통합 제척·섭외 뷰 — 기본 스코프는 회차 전체 지원자, 사용자가 일부만(서류 합격자) 좁힐 수 있다. */
export default async function RoundPage({ params }: { params: { round: string } }) {
  // params.round 는 App Router가 이미 디코드한 값 — 다시 decode 하면 '%' 포함 시 크래시.
  const round = params.round === 'none' ? '' : params.round;
  const applicants = await getRoundApplicants(round);
  if (applicants.length === 0) notFound();

  const applicantIds = applicants.map((a) => a.id);
  const view = await getRoundCandidates({ round, applicantIds, limit: 60 });

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <nav aria-label="breadcrumb" className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Link href="/rounds" className="hover:text-fg transition-colors">면접위원 섭외</Link>
          <span aria-hidden className="text-stroke-strong">/</span>
          <span className="font-medium text-fg" aria-current="page">회차 {round || '미상'}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">회차 {round || '미상'} 면접위원 섭외</h1>
          <span className="seed-badge-neutral">
            {view.poolSource === 'round' ? '이 회차 명단' : '전역 풀'} {view.poolTotal.toLocaleString()}명
          </span>
        </div>
        <p className="text-sm text-fg-muted">
          왼쪽에서 <strong>대조할 지원자(서류 합격자)</strong>를 고르면, 그들의 제척 대상을 합쳐
          명단에서 제거한 <strong>섭외 가능 전문가</strong>를 보여 줍니다. 이 회차 전용 명단을 올리면
          그 명단 기준으로 대조합니다.
        </p>
      </header>

      <RoundInvitePanel
        round={round || 'none'}
        applicants={applicants}
        categories={view.categories}
        initialConflicts={view.conflicts}
        initialItems={view.items}
        initialTotal={view.total}
        initialExcludedCount={view.excludedCount}
        poolTotal={view.poolTotal}
        poolSource={view.poolSource}
        poolMeta={view.poolMeta}
      />
    </div>
  );
}
