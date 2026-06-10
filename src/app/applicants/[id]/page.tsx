import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfidenceBadge, FinalStatusBadge, RoleBadges } from '@/components/badges';
import { DocumentList } from '@/components/DocumentList';
import { GroupToggle } from '@/components/GroupToggle';
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
  searchParams: { view?: string; q?: string };
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
  const q = (searchParams.q ?? '').trim();
  const ql = q.toLowerCase();

  const matchesQuery = (p: PersonAggregate): boolean =>
    !q ||
    p.canonicalName.toLowerCase().includes(ql) ||
    (p.affiliation ?? '').toLowerCase().includes(ql) ||
    p.roles.some((r) => ROLE_LABELS_KO[r].includes(q));

  // Filter by the active chip, then by the search query.
  const scoped =
    view === 'review'
      ? people.filter(needsReview)
      : isRoleView
        ? people.filter((p) => p.roles.includes(view as Role))
        : people;
  const shown = scoped.filter(matchesQuery);

  // 전체 뷰(검색 없음)에서는 관계 유형별 '접이식 그룹'으로 — 한 번에 전부 펼치지 않는다.
  // 검토가 필요한 그룹만 기본으로 열고, 나머지는 요약(인원·상태)만 보여 페이지를 짧게 유지.
  const groupedMode = view === 'all' && !q;
  const groups: Array<{ role: Role | null; rows: PersonAggregate[] }> = groupedMode
    ? [...rolesPresent, null].flatMap((role) => {
        const rows = people.filter((p) => primaryRole(p) === role).sort(byReviewThenName);
        return rows.length ? [{ role: role as Role | null, rows }] : [];
      })
    : [];

  // 문서별 추출 인원: how many distinct people each document contributed.
  const docPeople = new Map<string, number>();
  for (const p of people) {
    for (const id of new Set(p.sources.map((s) => s.documentId))) {
      docPeople.set(id, (docPeople.get(id) ?? 0) + 1);
    }
  }

  const flatLabel =
    view === 'review' ? '검토 필요' : isRoleView ? ROLE_LABELS_KO[view as Role] : '전체';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{applicant.name}</h1>
            {reviewCount > 0 && (
              <span className="seed-badge-warning">검토 필요 {reviewCount}</span>
            )}
          </div>
          <p className="text-sm text-fg-muted">
            관계자 {people.length}명 · 문서 {documents.length}건
            {job ? ` · 추출 ${job.status}` : ''}
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

      {/* 분류 필터 + 검색: 긴 목록을 좁혀서 본다. */}
      <div className="space-y-3">
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

        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* 서버 GET 검색 — Enter로 제출, JS 불필요. */}
          <form method="get" action={`/applicants/${applicant.id}`} className="flex items-center gap-2">
            {view !== 'all' && <input type="hidden" name="view" value={view} />}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="이름·소속으로 검색"
              aria-label="관계자 검색"
              className="seed-input w-56"
            />
            <button type="submit" className="seed-btn-neutral">
              검색
            </button>
            {q && (
              <Link
                href={view === 'all' ? `/applicants/${applicant.id}` : `/applicants/${applicant.id}?view=${view}`}
                className="text-sm text-fg-muted underline-offset-2 hover:underline"
              >
                지우기
              </Link>
            )}
          </form>
          {groupedMode && groups.length > 1 && <GroupToggle />}
        </div>
      </div>

      {groupedMode ? (
        groups.length === 0 ? (
          <EmptyRows />
        ) : (
          <div className="space-y-3">
            {groups.map((g, i) => {
              const groupReview = g.rows.filter(needsReview).length;
              // 검토가 필요한 그룹만 기본 펼침. 전부 깨끗하면 첫 그룹만 펼쳐 빈 화면을 피한다.
              const defaultOpen = groupReview > 0 || (reviewCount === 0 && i === 0);
              return (
                <details
                  key={g.role ?? 'etc'}
                  data-role-group
                  open={defaultOpen}
                  className="group seed-card overflow-hidden"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-bg-layer/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                      {g.role ? ROLE_LABELS_KO[g.role] : '기타'}
                      <span className="font-normal text-fg-subtle">{g.rows.length}명</span>
                      {groupReview > 0 ? (
                        <span className="seed-badge-warning">검토 {groupReview}</span>
                      ) : (
                        <span className="seed-badge-success">모두 자동 통과</span>
                      )}
                    </span>
                    <span className="shrink-0 text-fg-subtle transition-transform group-open:rotate-180">
                      ⌄
                    </span>
                  </summary>
                  <div className="overflow-x-auto border-t border-stroke">
                    <PeopleTable rows={g.rows} />
                  </div>
                </details>
              );
            })}
          </div>
        )
      ) : (
        <section className="seed-card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-stroke bg-bg-layer/60 px-4 py-2.5 text-sm text-fg-muted">
            <span className="font-semibold text-fg">{flatLabel}</span>
            <span>{shown.length}명</span>
            {q && <span className="text-fg-subtle">— “{q}” 검색 결과</span>}
          </div>
          <div className="overflow-x-auto">
            {shown.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-fg-muted">
                {q ? `“${q}”에 해당하는 관계자가 없습니다.` : '해당 항목이 없습니다.'}
              </p>
            ) : (
              <PeopleTable rows={[...shown].sort(byReviewThenName)} />
            )}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg-muted">
          문서 ({documents.length}건) <span className="font-normal text-fg-subtle">— 클릭하면 원문 미리보기</span>
        </h2>
        <DocumentList
          items={documents.map((d) => ({
            id: d.id,
            filename: d.filename,
            label: DOC_TYPE_LABELS_KO[d.docType],
            format: d.sourceFormat,
            people: docPeople.get(d.id) ?? 0,
            pageCount: d.pageCount,
          }))}
        />
      </section>
    </div>
  );
}

function EmptyRows() {
  return (
    <div className="seed-card p-10 text-center">
      <p className="text-base text-fg-muted">추출된 관계자가 없습니다.</p>
    </div>
  );
}

/** Shared people table — identical column layout in every group card and the flat view. */
function PeopleTable({ rows }: { rows: PersonAggregate[] }) {
  return (
    <table className="w-full min-w-[820px] table-fixed text-sm">
      <colgroup>
        <col className="w-[19%]" />
        <col className="w-[15%]" />
        <col className="w-[20%]" />
        <col className="w-[22%]" />
        <col className="w-[10%]" />
        <col className="w-[14%]" />
      </colgroup>
      <thead className="bg-bg-layer text-left text-sm text-fg-muted">
        <tr>
          <th className="px-4 py-3 font-medium">이름</th>
          <th className="px-4 py-3 font-medium">역할</th>
          <th className="px-4 py-3 font-medium">소속</th>
          <th className="px-4 py-3 font-medium">출처</th>
          <th className="px-4 py-3 font-medium">상태</th>
          <th className="px-4 py-3" />
        </tr>
      </thead>
      <tbody className="divide-y divide-stroke">
        {rows.map((p) => (
          <tr key={p.id} className="align-top">
            <td className="px-4 py-3 font-semibold text-fg">
              {p.canonicalName}
              {p.nameCandidates.length > 1 && (
                <span className="mt-0.5 block text-xs font-normal text-warning">
                  후보: {p.nameCandidates.map((c) => c.name).join(' / ')}
                </span>
              )}
            </td>
            <td className="px-4 py-3">
              <RoleBadges roles={p.roles} />
            </td>
            <td className="px-4 py-3 text-fg-muted">
              <span className="block truncate" title={p.affiliation ?? undefined}>
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
    </table>
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
  const chip =
    'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors';
  const base = active
    ? `${chip} bg-accent text-fg-oncolor`
    : tone === 'warning'
      ? `${chip} bg-warning-subtle text-warning hover:opacity-80`
      : `${chip} border border-stroke bg-bg text-fg-muted hover:bg-bg-layer`;
  return (
    <Link href={view === 'all' ? `/applicants/${id}` : `/applicants/${id}?view=${view}`} className={`no-underline ${base}`}>
      {label} {count}
    </Link>
  );
}
