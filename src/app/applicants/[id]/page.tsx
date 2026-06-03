import { notFound } from 'next/navigation';
import { ConfidenceBadge, FinalStatusBadge, RoleBadges } from '@/components/badges';
import { PersonActions } from '@/components/PersonActions';
import { DOC_TYPE_LABELS_KO } from '@/lib/domain';
import { getApplicantReview } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function ApplicantPage({ params }: { params: { id: string } }) {
  const data = await getApplicantReview(params.id);
  if (!data) notFound();

  const { applicant, aggregates, documents, job } = data;
  const people = aggregates.filter((a) => !a.isSelf);
  const self = aggregates.filter((a) => a.isSelf);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{applicant.name}</h1>
          <p className="text-sm text-fg-muted">
            관계자 {people.length}명 · 문서 {documents.length}건{job ? ` · 추출 ${job.status}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <a className="seed-btn-neutral no-underline" href={`/api/export/${applicant.id}?format=csv`}>
            CSV
          </a>
          <a
            className="seed-btn-primary no-underline"
            href={`/api/export/${applicant.id}?format=xlsx`}
          >
            Excel 내보내기
          </a>
        </div>
      </header>

      {self.length > 0 && (
        <div className="seed-card p-3 text-sm text-fg-muted">
          본인 자동 제외: {self.map((s) => s.canonicalName).join(', ')}
        </div>
      )}

      <section className="seed-card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-bg-layer text-left text-xs text-fg-subtle">
            <tr>
              <th className="px-4 py-2.5 font-medium">이름</th>
              <th className="px-4 py-2.5 font-medium">역할</th>
              <th className="px-4 py-2.5 font-medium">소속</th>
              <th className="px-4 py-2.5 font-medium">출처</th>
              <th className="px-4 py-2.5 font-medium">상태</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stroke">
            {people.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-fg-muted">
                  추출된 관계자가 없습니다.
                </td>
              </tr>
            )}
            {people.map((p) => (
              <tr key={p.id} className="align-top">
                <td className="px-4 py-3 font-semibold text-fg">
                  {p.canonicalName}
                  {p.nameCandidates.length > 1 && (
                    <span className="ml-2 align-middle text-xs font-normal text-warning">
                      후보: {p.nameCandidates.map((c) => c.name).join(' / ')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <RoleBadges roles={p.roles} />
                </td>
                <td className="px-4 py-3 text-fg-muted">{p.affiliation ?? '—'}</td>
                <td className="px-4 py-3 text-fg-muted">
                  {p.sources.map((s, i) => (
                    <a
                      key={`${s.documentId}-${i}`}
                      href={`/api/file/${s.documentId}`}
                      target="_blank"
                      rel="noreferrer"
                      title={s.evidence ?? s.filename}
                      className="mr-2 inline-block whitespace-nowrap underline-offset-2 hover:underline"
                    >
                      {DOC_TYPE_LABELS_KO[s.docType]} p.{s.page}
                    </a>
                  ))}
                </td>
                <td className="space-y-1 px-4 py-3">
                  <ConfidenceBadge needsHuman={p.needsHuman} />
                  <FinalStatusBadge status={p.finalStatus} />
                </td>
                <td className="px-4 py-3">
                  <PersonActions
                    aggregateId={p.id}
                    currentName={p.canonicalName}
                    candidates={p.nameCandidates}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg-muted">문서</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {documents.map((d) => (
            <li key={d.id} className="seed-card flex items-center justify-between gap-3 p-3 text-sm">
              <span className="truncate">{d.filename}</span>
              <span className="seed-badge-neutral shrink-0">{DOC_TYPE_LABELS_KO[d.docType]}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
