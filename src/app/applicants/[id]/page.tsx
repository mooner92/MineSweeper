import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfidenceBadge, FinalStatusBadge, RoleBadges } from '@/components/badges';
import { PersonActions } from '@/components/PersonActions';
import { DOC_TYPE_LABELS_KO, ROLE_LABELS_KO, ROLES, type Role } from '@/lib/domain';
import { getApplicantReview } from '@/lib/data';
import type { PersonAggregate } from '@/db/schema';

export const dynamic = 'force-dynamic';

const needsReview = (p: PersonAggregate) => p.needsHuman || p.nameCandidates.length > 1;

/** A person's primary relation = the highest-priority role they hold (ROLES is in priority order). */
function primaryRole(p: PersonAggregate): Role | null {
  let best: Role | null = null;
  let bestIdx: number = ROLES.length;
  for (const r of p.roles) {
    const i = ROLES.indexOf(r);
    if (i >= 0 && i < bestIdx) {
      bestIdx = i;
      best = r;
    }
  }
  return best;
}

/** needs-review first, then by name — within any list. */
function byReviewThenName(a: PersonAggregate, b: PersonAggregate): number {
  if (needsReview(a) !== needsReview(b)) return needsReview(a) ? -1 : 1;
  return a.canonicalName.localeCompare(b.canonicalName, 'ko');
}

export default async function ApplicantPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { view?: string };
}) {
  const data = await getApplicantReview(params.id);
  if (!data) notFound();

  const { applicant, aggregates, documents, job } = data;
  const people = aggregates.filter((a) => !a.isSelf);
  const self = aggregates.filter((a) => a.isSelf);
  const reviewCount = people.filter(needsReview).length;

  // Which relation types are actually present, in priority order, with counts.
  const rolesPresent = ROLES.filter((r) => people.some((p) => p.roles.includes(r)));
  const view = searchParams.view ?? 'all';
  const isRoleView = (ROLES as readonly string[]).includes(view);

  // Filter the list by the active chip. 'all' keeps everyone (grouped below); the others are flat.
  const shown =
    view === 'review'
      ? people.filter(needsReview)
      : isRoleView
        ? people.filter((p) => p.roles.includes(view as Role))
        : people;

  // 'all' groups by primary relation; the narrowed views render as one flat list.
  const grouped: Array<{ role: Role | null; rows: PersonAggregate[] }> =
    view === 'all'
      ? [...rolesPresent, null].flatMap((role) => {
          const rows = people
            .filter((p) => primaryRole(p) === role)
            .sort(byReviewThenName);
          return rows.length ? [{ role: role as Role | null, rows }] : [];
        })
      : [{ role: null, rows: [...shown].sort(byReviewThenName) }];

  // 문서별 추출 인원: how many distinct people each document contributed.
  const docPeople = new Map<string, number>();
  for (const p of people) {
    for (const id of new Set(p.sources.map((s) => s.documentId))) {
      docPeople.set(id, (docPeople.get(id) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{applicant.name}</h1>
          <p className="text-sm text-fg-muted">
            관계자 {people.length}명
            {reviewCount > 0 && <span className="text-warning"> · 검토 필요 {reviewCount}명</span>} ·
            문서 {documents.length}건{job ? ` · 추출 ${job.status}` : ''}
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

      {/* 분류 필터: 전체 / 검토 필요 / 관계 유형별 — 긴 목록을 좁혀서 본다. */}
      <div className="flex flex-wrap gap-2">
        <ViewChip id={applicant.id} view="all" active={view === 'all'} label="전체" count={people.length} />
        {reviewCount > 0 && (
          <ViewChip
            id={applicant.id}
            view="review"
            active={view === 'review'}
            label="검토 필요"
            count={reviewCount}
            tone="warning"
          />
        )}
        {rolesPresent.map((r) => (
          <ViewChip
            key={r}
            id={applicant.id}
            view={r}
            active={view === r}
            label={ROLE_LABELS_KO[r]}
            count={people.filter((p) => p.roles.includes(r)).length}
          />
        ))}
      </div>

      <section className="seed-card overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
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
          {shown.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-fg-muted">
                  해당 항목이 없습니다.
                </td>
              </tr>
            </tbody>
          ) : (
            grouped.map((g) => {
              const groupReview = g.rows.filter(needsReview).length;
              return (
                <tbody key={g.role ?? 'etc'} className="divide-y divide-stroke">
                  {view === 'all' && (
                    // 관계 유형 구분선 — 긴 목록을 역할별로 묶어 가독성을 높인다.
                    <tr className="bg-bg-layer/60">
                      <th
                        colSpan={6}
                        className="px-4 py-2 text-left text-xs font-semibold text-fg-muted"
                      >
                        {g.role ? ROLE_LABELS_KO[g.role] : '기타'} · {g.rows.length}명
                        {groupReview > 0 && (
                          <span className="ml-1 font-normal text-warning">(검토 {groupReview})</span>
                        )}
                      </th>
                    </tr>
                  )}
                  {g.rows.map((p) => (
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
                      <td className="px-4 py-3 text-fg-muted">
                        <span
                          className="block max-w-[240px] truncate"
                          title={p.affiliation ?? undefined}
                        >
                          {p.affiliation ?? '—'}
                        </span>
                      </td>
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
              );
            })
          )}
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg-muted">문서 ({documents.length}건)</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {documents.map((d) => (
            <li key={d.id} className="seed-card flex items-center justify-between gap-3 p-3 text-sm">
              <span className="truncate" title={d.filename}>
                {d.filename}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="text-xs text-fg-subtle">관계자 {docPeople.get(d.id) ?? 0}명</span>
                <span className="seed-badge-neutral">{DOC_TYPE_LABELS_KO[d.docType]}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ViewChip({
  id,
  view,
  active,
  label,
  count,
  tone,
}: {
  id: string;
  view: string;
  active: boolean;
  label: string;
  count: number;
  tone?: 'warning';
}) {
  const base = active
    ? 'seed-badge bg-accent text-fg-oncolor'
    : tone === 'warning'
      ? 'seed-badge-warning'
      : 'seed-badge-neutral';
  return (
    <Link href={view === 'all' ? `/applicants/${id}` : `/applicants/${id}?view=${view}`} className={`no-underline ${base}`}>
      {label} {count}
    </Link>
  );
}
