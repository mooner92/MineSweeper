import Link from 'next/link';
import { UploadForm } from '@/components/UploadForm';
import { getApplicants } from '@/lib/data';

export const dynamic = 'force-dynamic';

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
          <p className="seed-card p-6 text-sm text-fg-muted">아직 업로드된 지원자가 없습니다.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {list.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/applicants/${a.id}`}
                  className="seed-card block p-4 no-underline transition-colors hover:border-stroke-strong"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-fg">{a.name}</span>
                    {a.needsHuman > 0 ? (
                      <span className="seed-badge-warning">미확인 {a.needsHuman}</span>
                    ) : (
                      <span className="seed-badge-success">검토 가능</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-fg-muted">
                    관계자 {a.total}명{a.round ? ` · ${a.round}` : ''}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
