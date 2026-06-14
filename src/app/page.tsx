import Link from 'next/link';
import { DeleteApplicantButton } from '@/components/DeleteApplicantButton';
import { Spinner } from '@/components/Spinner';
import { StatCell } from '@/components/StatCell';
import { UploadForm } from '@/components/UploadForm';
import { getApplicants, type ApplicantSummary } from '@/lib/data';

export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' });

export default async function HomePage() {
  const list = await getApplicants();
  // 전체 현황 요약(벤치마킹) — 지원자·식별 연관자·미확인을 한눈에. 풀 대조 수치는 전문가 풀 등록 후.
  const totals = {
    people: list.reduce((n, a) => n + a.total, 0),
    needsHuman: list.reduce((n, a) => n + a.needsHuman, 0),
    docs: list.reduce((n, a) => n + a.docCount, 0),
    running: list.filter((a) => a.jobStatus === 'queued' || a.jobStatus === 'running').length,
    errors: list.filter((a) => a.jobStatus === 'error').length,
  };

  // 회차별 그룹(최신 회차 먼저, 미상은 맨 뒤) — 접이식으로 정리.
  const byRound = new Map<string, ApplicantSummary[]>();
  for (const a of list) {
    const key = a.round ?? '';
    if (!byRound.has(key)) byRound.set(key, []);
    byRound.get(key)!.push(a);
  }
  const roundGroups = [...byRound.entries()].sort((x, y) => {
    if (x[0] === '') return 1;
    if (y[0] === '') return -1;
    return y[0].localeCompare(x[0]);
  });
  return (
    <div className="space-y-8">
      {list.length > 0 && (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCell index={0} value={list.length} label="지원자" detail="제출자료 분석" />
          <StatCell
            index={1}
            value={totals.people}
            label="식별 연관자"
            detail="지도교수 · 심사위원 · 공저자 · 연구진"
          />
          <StatCell
            index={2}
            value={totals.needsHuman}
            label="검토 필요"
            tone={totals.needsHuman > 0 ? 'warning' : undefined}
            detail="사람 확인 대기"
          />
          <StatCell
            index={3}
            value={totals.docs}
            label="문서"
            detail={
              totals.running > 0
                ? `추출 진행 중 ${totals.running}명`
                : totals.errors > 0
                  ? `추출 오류 ${totals.errors}명`
                  : '전체 처리 완료'
            }
          />
        </section>
      )}

      {/* 업로드 섹션 — 주 액션임을 ring+스텝 번호로 강조. 다른 카드와 시각적으로 구분 */}
      <section className="seed-card overflow-hidden ring-1 ring-accent/25">
        <div className="flex items-center gap-2.5 border-b border-stroke bg-bg-layer px-4 py-2.5">
          <span
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold leading-none text-fg-oncolor"
            aria-hidden
          >
            1
          </span>
          <h2 className="text-sm font-bold text-fg">지원자 ZIP 업로드</h2>
        </div>
        <div className="p-5">
          <p className="text-sm leading-6 text-fg-muted">
            압축을 풀어 4단 파이프라인(Ingest → Type → Extract → Aggregate)으로 관계자를 추출합니다. 추출
            결과는 초안이며, 사람이 검토·확정합니다.
          </p>
          <div className="mt-4">
            <UploadForm />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-fg">
          지원자 <span className="font-normal text-fg-muted">({list.length})</span>
        </h2>
        {list.length === 0 ? (
          <div className="seed-card p-10 text-center">
            <p className="text-base text-fg-muted">아직 업로드된 지원자가 없습니다.</p>
            <p className="mt-1 text-sm text-fg-subtle">위에서 지원자 ZIP을 올리면 자동으로 추출이 시작됩니다.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {roundGroups.map(([round, apps]) => (
              <details key={round || 'none'} open className="group seed-card overflow-hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-l-[3px] border-l-accent bg-bg-layer px-4 py-2.5 transition-colors hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                  <span className="flex flex-wrap items-center gap-2 text-[13px] font-bold tracking-[0.04em] text-fg">
                    회차 {round || '미상'}
                    <span className="font-normal normal-case tracking-normal text-fg-subtle">{apps.length}명</span>
                  </span>
                  <svg aria-hidden className="ms-chevron h-4 w-4 shrink-0 text-fg-subtle group-open:rotate-180" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6l4 4 4-4"/>
                  </svg>
                </summary>
                <ul className="grid gap-3 border-t border-stroke p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {apps.map((a) => {
                    const running = a.jobStatus === 'queued' || a.jobStatus === 'running';
                    return (
                      <li key={a.id} className="group/card relative">
                        {/* 상태 색 바 — 세로로 훑을 때 색 하나로 즉시 스캔 */}
                        <span
                          aria-hidden
                          className={`pointer-events-none absolute left-0 top-0 h-full w-1 rounded-l-seed-lg ${
                            a.jobStatus === 'error'
                              ? 'bg-danger'
                              : a.needsHuman > 0
                                ? 'bg-warning'
                                : a.jobStatus === 'queued' || a.jobStatus === 'running'
                                  ? 'bg-info'
                                  : 'bg-success'
                          }`}
                        />
                        <Link
                          href={`/applicants/${a.id}`}
                          className="seed-card block p-4 pl-5 pr-16 no-underline transition-all duration-150 hover:-translate-y-px hover:border-stroke-strong hover:bg-bg-layer/50 hover:shadow-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-bold text-fg">{a.name}</span>
                            {running ? (
                              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-info-subtle px-2 py-0.5 text-xs font-medium text-info">
                                <Spinner className="h-3 w-3" />
                                추출 중
                              </span>
                            ) : a.jobStatus === 'error' ? (
                              <span className="seed-badge-danger shrink-0">추출 오류</span>
                            ) : a.needsHuman > 0 ? (
                              <span className="seed-badge-warning shrink-0">검토 필요 {a.needsHuman}</span>
                            ) : (
                              <span className="seed-badge-success shrink-0">검토 가능</span>
                            )}
                          </div>
                          <p className="mt-1.5 text-sm text-fg-muted">
                            관계자 <span className="font-semibold text-fg">{a.total}</span>명
                          </p>
                          <p className="mt-1 text-xs text-fg-subtle">
                            문서 {a.docCount}건 · {dateFmt.format(a.createdAt)} 업로드
                          </p>
                        </Link>
                        <DeleteApplicantButton id={a.id} name={a.name} />
                      </li>
                    );
                  })}
                </ul>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
