import Link from 'next/link';
import { getRounds } from '@/lib/rounds';
import { getExpertPoolCount } from '@/lib/experts';

export const dynamic = 'force-dynamic';

/** 회차 목록 — 회차를 골라 면접위원 섭외(제척 합집합 → 가용 전문가) 화면으로 들어간다. */
export default async function RoundsPage() {
  const [rounds, poolCount] = await Promise.all([getRounds(), getExpertPoolCount()]);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">면접위원 섭외</h1>
        <p className="text-sm text-fg-muted">
          회차(또는 그 안에서 고른 서류 합격자)의 <strong>제척 대상을 합집합으로</strong> 전문가 풀에서
          제거하고, 남은 <strong>제척되지 않은 전문가</strong>를 면접위원 후보로 제시합니다.
        </p>
        <p className="flex items-center gap-2 pt-0.5 text-xs text-fg-subtle">
          <span className="seed-badge-neutral">전문가 풀 {poolCount.toLocaleString()}명</span>
          {poolCount === 0 ? (
            <span>
              풀 미등록 —{' '}
              <code className="text-fg-muted">scripts/import-experts.ts &lt;xlsx&gt;</code> 로 명단을
              적재하세요(원장 추천 명단으로 교체 가능).
            </span>
          ) : (
            <span>현재 적재된 명단 기준으로 대조합니다(원장 추천 명단으로 교체 가능).</span>
          )}
        </p>
      </header>

      {rounds.length === 0 ? (
        <div className="seed-card p-10 text-center text-sm text-fg-muted">
          아직 지원자가 없습니다. 메인에서 ZIP을 올리면 회차별로 정리됩니다.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rounds.map((r) => {
            const key = r.round ?? '';
            const done = r.applicants.filter((a) => a.jobStatus === 'done').length;
            return (
              <li key={key || 'none'}>
                <Link
                  href={`/rounds/${encodeURIComponent(key || 'none')}`}
                  className="seed-card flex items-center justify-between gap-3 p-4 no-underline transition-colors hover:border-accent/40 hover:bg-accent-subtle/20"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-fg">회차 {r.round ?? '미상'}</p>
                    <p className="text-xs text-fg-subtle">
                      지원자 {r.applicants.length}명{done < r.applicants.length ? ` · 추출 완료 ${done}` : ''}
                    </p>
                  </div>
                  <svg
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-fg-subtle"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
