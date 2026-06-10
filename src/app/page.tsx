import Link from 'next/link';
import { UploadForm } from '@/components/UploadForm';
import { getApplicants } from '@/lib/data';

export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' });

export default async function HomePage() {
  const list = await getApplicants();
  return (
    <div className="space-y-8">
      <section className="seed-card p-6">
        <h1 className="text-xl font-bold">지원자 ZIP 업로드</h1>
        <p className="mt-1 text-sm text-fg-muted">
          압축을 풀어 4단 파이프라인(Ingest → Type → Extract → Aggregate)으로 관계자를 추출합니다. 추출
          결과는 초안이며, 사람이 검토·확정합니다.
        </p>
        <div className="mt-4">
          <UploadForm />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">지원자 ({list.length})</h2>
        {list.length === 0 ? (
          <div className="seed-card p-10 text-center">
            <p className="text-base text-fg-muted">아직 업로드된 지원자가 없습니다.</p>
            <p className="mt-1 text-sm text-fg-subtle">위에서 지원자 ZIP을 올리면 자동으로 추출이 시작됩니다.</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {list.map((a) => {
              const running = a.jobStatus === 'queued' || a.jobStatus === 'running';
              return (
                <li key={a.id}>
                  <Link
                    href={`/applicants/${a.id}`}
                    className="seed-card block p-4 no-underline transition-colors hover:border-stroke-strong hover:bg-bg-layer/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-fg">{a.name}</span>
                      {running ? (
                        <span className="seed-badge-neutral shrink-0">
                          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
                          추출 중
                        </span>
                      ) : a.jobStatus === 'error' ? (
                        <span className="seed-badge-danger shrink-0">추출 오류</span>
                      ) : a.needsHuman > 0 ? (
                        <span className="seed-badge-warning shrink-0">미확인 {a.needsHuman}</span>
                      ) : (
                        <span className="seed-badge-success shrink-0">검토 가능</span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm text-fg-muted">
                      관계자 <span className="font-semibold text-fg">{a.total}</span>명
                      {a.round ? ` · 회차 ${a.round}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-fg-subtle">
                      문서 {a.docCount}건 · {dateFmt.format(a.createdAt)} 업로드
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
