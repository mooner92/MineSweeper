import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfidenceBadge, FinalStatusBadge, RoleBadges } from '@/components/badges';
import { DocumentList, type DocPersonRef } from '@/components/DocumentList';
import { RunningIndicator } from '@/components/RunningIndicator';
import { GroupToggle } from '@/components/GroupToggle';
import { PersonActions } from '@/components/PersonActions';
import { StatCell } from '@/components/StatCell';
import { buildApplicantChecks, sharedInstitution, type CheckLevel } from '@/lib/checks';
import { InvitePanel } from '@/components/InvitePanel';
import { findExpertConflicts, getExpertPoolCount, type ExpertConflict } from '@/lib/experts';
import {
  getExpertCategories,
  getInvitations,
  getInviteCandidates,
} from '@/lib/invite';
import { estimateKoreanName } from '@/lib/hangulize';
import { nameKey } from '@/lib/names';
import type { Expert, Invitation } from '@/db/schema';
import {
  DOC_TYPE_LABELS_KO,
  ROLE_LABELS_KO,
  ROLES,
  type ExpertField,
  type Role,
  type SourceKind,
} from '@/lib/domain';
import { getApplicantReview } from '@/lib/data';
import type { PersonAggregate } from '@/db/schema';

export const dynamic = 'force-dynamic';

/** 검토 필요 = 자동 통과 못 한 검출(저신뢰·동명이인) 중 아직 사람이 확정하지 않은(pending) 것. */
const needsReview = (p: PersonAggregate) =>
  (p.needsHuman || p.nameCandidates.length > 1) && p.finalStatus === 'pending';

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

  const { applicant, aggregates, documents, job, openFlags } = data;
  const people = aggregates.filter((a) => !a.isSelf);
  const self = aggregates.filter((a) => a.isSelf);
  const reviewCount = people.filter(needsReview).length;

  // 전문가 풀 대조(제척): 관계자(제외 제외)와 이름이 일치하는 풀 전문가를 찾는다. 풀 미적재면 빈 목록.
  const [poolCount, conflicts] = await Promise.all([
    getExpertPoolCount(),
    findExpertConflicts(
      people
        .filter((p) => p.finalStatus !== 'rejected')
        .map((p) => ({
          name: p.canonicalName,
          roles: p.roles,
          affiliation: p.affiliation,
          sources: p.sources,
        })),
    ),
  ]);
  const conflictKeys = new Set(conflicts.map((c) => c.expert.nameKey));
  const conflictedAggIds = new Set(
    people.filter((p) => conflictKeys.has(nameKey(p.canonicalName))).map((p) => p.id),
  );

  // 면접위원 초빙 — 풀 적재 시에만. 후보 기본 필터는 지원자에 저장된 분야를 쓴다.
  const poolReady = poolCount > 0;
  let inviteCategories: Array<{ dae: string; mids: string[] }> = [];
  let inviteCandidates: { items: Expert[]; total: number } = { items: [], total: 0 };
  let invitationList: Invitation[] = [];
  if (poolReady) {
    [inviteCategories, inviteCandidates, invitationList] = await Promise.all([
      getExpertCategories(),
      getInviteCandidates({
        applicantId: applicant.id,
        dae: applicant.fieldDae,
        mid: applicant.fieldMid,
      }),
      getInvitations(applicant.id),
    ]);
  }

  // 동일 소속기관(추정): 본인 소속과 같은 기관이면 기관 단위 제척 근거로 표시한다 (주황 배지).
  const selfAffiliations = self.map((s) => s.affiliation);
  const sameAff = new Map<string, string>();
  for (const p of people) {
    const inst = sharedInstitution(selfAffiliations, p.affiliation);
    if (inst) sameAff.set(p.id, inst);
  }

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
    // 화면에 병기되는 한글 추정으로도 검색되게 — "Minsu Kim"을 "김민수"로 찾을 수 있다.
    (estimateKoreanName(p.canonicalName) ?? '').includes(q) ||
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

  // 문서별 추출 인원: how many distinct (non-self) people each document contributed.
  const docPeople = new Map<string, number>();
  for (const p of people) {
    for (const id of new Set(p.sources.map((s) => s.documentId))) {
      docPeople.set(id, (docPeople.get(id) ?? 0) + 1);
    }
  }

  // 문서별 검출 인물 — 드로어 패널(누가·어디서)용. 본인 포함(본인 배지), 첫 출현 페이지순.
  const docPeopleList = new Map<string, DocPersonRef[]>();
  for (const p of aggregates) {
    const pagesByDoc = new Map<string, Set<number>>();
    const evidenceByDoc = new Map<string, string>();
    const kindsByDoc = new Map<string, Set<SourceKind>>();
    for (const s of p.sources) {
      if (!pagesByDoc.has(s.documentId)) pagesByDoc.set(s.documentId, new Set());
      pagesByDoc.get(s.documentId)!.add(s.page);
      if (!kindsByDoc.has(s.documentId)) kindsByDoc.set(s.documentId, new Set());
      kindsByDoc.get(s.documentId)!.add(s.sourceKind);
      if (s.evidence && !evidenceByDoc.has(s.documentId)) evidenceByDoc.set(s.documentId, s.evidence);
    }
    for (const [docId, pageSet] of pagesByDoc) {
      const list = docPeopleList.get(docId) ?? [];
      list.push({
        aggregateId: p.id,
        name: p.canonicalName,
        koreanEst: estimateKoreanName(p.canonicalName),
        roles: p.roles,
        affiliation: p.affiliation,
        pages: [...pageSet].sort((a, b) => a - b),
        sourceKinds: [...(kindsByDoc.get(docId) ?? [])],
        evidence: evidenceByDoc.get(docId) ?? null,
        needsHuman: p.needsHuman,
        isSelf: p.isSelf,
      });
      docPeopleList.set(docId, list);
    }
  }
  for (const list of docPeopleList.values()) {
    list.sort((a, b) => (a.pages[0] ?? 0) - (b.pages[0] ?? 0) || a.name.localeCompare(b.name, 'ko'));
  }

  // 자동 점검(벤치마킹: verify 게이트) — 본인 식별·커버리지·스캔 문서·검토 대기를 드러낸다.
  const checks = buildApplicantChecks({
    documents: documents.map((d) => ({
      id: d.id,
      filename: d.filename,
      sourceFormat: d.sourceFormat,
      hasTextLayer: d.hasTextLayer,
    })),
    peopleByDoc: docPeople,
    selfNames: self.map((s) => s.canonicalName),
    reviewCount,
    openFlags,
    sameAffiliationCount: sameAff.size,
  });
  const isTextish = (d: (typeof documents)[number]) =>
    d.hasTextLayer || d.sourceFormat === 'text' || d.sourceFormat === 'hwp';

  const flatLabel =
    view === 'review' ? '검토 필요' : isRoleView ? ROLE_LABELS_KO[view as Role] : '전체';

  // 헤더 요약(벤치마킹) — 역할별 구성 한 줄("공저자 28 · 지도교수 5 …")과 본인 소속 칩.
  const roleSummary = rolesPresent
    .map((r) => `${ROLE_LABELS_KO[r]} ${people.filter((p) => p.roles.includes(r)).length}`)
    .join(' · ');
  const selfAffsClean = [...new Set(selfAffiliations.filter((x): x is string => !!x))];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <nav aria-label="breadcrumb" className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Link href="/" className="hover:text-fg transition-colors">지원자 목록</Link>
            <span aria-hidden className="text-stroke-strong">/</span>
            <span className="font-medium text-fg" aria-current="page">{applicant.name}</span>
          </nav>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{applicant.name}</h1>
            {applicant.externalId && (
              <span className="text-sm text-fg-subtle">{applicant.externalId}</span>
            )}
            {reviewCount > 0 && (
              <span className="seed-badge-warning">검토 필요 {reviewCount}</span>
            )}
          </div>
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <span>
              {applicant.recruitmentRound ? `회차 ${applicant.recruitmentRound} · ` : ''}문서{' '}
              {documents.length}건
            </span>
            <RunningIndicator running={job?.status === 'queued' || job?.status === 'running'} />
            {job?.status === 'error' && <span className="seed-badge-danger">추출 오류</span>}
          </p>
          {selfAffsClean.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-xs text-fg-subtle">본인 소속(동일소속 판정 기준):</span>
              {selfAffsClean.map((aff) => (
                <span key={aff} className="seed-badge-neutral">
                  {aff}
                </span>
              ))}
            </div>
          )}
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

      {/* 핵심 수치 요약(벤치마킹) — 연관자 구성·검토 대기·동일소속·전문가 풀 제척을 한눈에. */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
        <StatCell index={0} value={people.length} label="연관자" detail={roleSummary || undefined} />
        <StatCell
          index={1}
          value={reviewCount}
          label="검토 필요"
          tone={reviewCount > 0 ? 'warning' : undefined}
          detail="동명이인 · 저신뢰 검출"
        />
        <StatCell
          index={2}
          value={sameAff.size}
          label="동일소속(추정)"
          tone={sameAff.size > 0 ? 'warning' : undefined}
          detail="본인 소속과 같은 기관"
        />
        <StatCell
          index={3}
          value={poolCount > 0 ? conflicts.length : '—'}
          label="제척 대상"
          tone={conflicts.length > 0 ? 'danger' : undefined}
          detail={
            poolCount === 0
              ? '풀 미등록'
              : conflicts.some((c) => c.confidence === 'low')
                ? `확인 필요 ${conflicts.filter((c) => c.confidence === 'low').length}명 포함`
                : `전문가 풀 ${poolCount.toLocaleString()}명 대조`
          }
        />
        <StatCell
          index={4}
          value={documents.length}
          label="문서"
          detail={`텍스트 검출 0명 ${documents.filter((d) => isTextish(d) && (docPeople.get(d.id) ?? 0) === 0).length}건`}
        />
      </section>

      {/* 본문 2단 — 넓은 화면: 메인(관계자·초빙·문서) + 우측 사이드레일(제척·자동점검).
          좁은 화면(<xl)에선 1열로 접히고 진단(제척·점검)을 메인 위로 올린다(order-first). */}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* ── 메인 컬럼 ── */}
        <div className="min-w-0 space-y-5">
          {/* 관계자 검토 — 필터·검색 헤더 + 그룹/표 */}
          <section className="seed-card overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-stroke bg-bg-layer px-4 py-2.5">
              <span className="h-4 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
              <span className="text-sm font-semibold text-fg">관계자 검토</span>
              <div className="flex flex-wrap gap-1.5">
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
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {/* 서버 GET 검색 — Enter로 제출, JS 불필요. */}
                <form method="get" action={`/applicants/${applicant.id}`} className="flex items-center gap-2">
                  {view !== 'all' && <input type="hidden" name="view" value={view} />}
                  <input
                    type="search"
                    name="q"
                    defaultValue={q}
                    placeholder="이름·소속 검색"
                    aria-label="관계자 검색"
                    className="seed-input w-40"
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
                <p className="px-4 py-10 text-center text-sm text-fg-muted">추출된 관계자가 없습니다.</p>
              ) : (
                <div className="divide-y divide-stroke">
                  {groups.map((g, i) => {
                    const groupReview = g.rows.filter(needsReview).length;
                    // 검토가 필요한 그룹만 기본 펼침. 전부 깨끗하면 첫 그룹만 펼쳐 빈 화면을 피한다.
                    const defaultOpen = groupReview > 0 || (reviewCount === 0 && i === 0);
                    return (
                      <details key={g.role ?? 'etc'} data-role-group open={defaultOpen} className="group">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-l-[3px] border-l-accent px-4 py-3 transition-colors hover:bg-bg-layer/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                          <span className="flex flex-wrap items-center gap-2 text-[13px] font-bold tracking-[0.04em] text-fg">
                            {g.role ? ROLE_LABELS_KO[g.role] : '기타'}
                            <span className="font-normal normal-case tracking-normal text-fg-subtle">{g.rows.length}명</span>
                            {groupReview > 0 ? (
                              <span className="seed-badge-warning">검토 {groupReview}</span>
                            ) : (
                              <span className="seed-badge-success">모두 자동 통과</span>
                            )}
                          </span>
                          <svg aria-hidden className="ms-chevron h-4 w-4 shrink-0 text-fg-subtle group-open:rotate-180" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 6l4 4 4-4"/>
                          </svg>
                        </summary>
                        <div className="overflow-x-auto border-t border-stroke">
                          <PeopleTable rows={g.rows} sameAff={sameAff} conflicted={conflictedAggIds} />
                        </div>
                      </details>
                    );
                  })}
                </div>
              )
            ) : (
              <div>
                <div className="flex items-center gap-2 border-b border-stroke px-4 py-2 text-sm text-fg-muted">
                  <span className="font-medium text-fg">{flatLabel}</span>
                  <span>{shown.length}명</span>
                  {q && <span className="text-fg-subtle">— “{q}” 검색 결과</span>}
                </div>
                <div className="overflow-x-auto">
                  {shown.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-fg-muted">
                      {q ? `“${q}”에 해당하는 관계자가 없습니다.` : '해당 항목이 없습니다.'}
                    </p>
                  ) : (
                    <PeopleTable
                      rows={[...shown].sort(byReviewThenName)}
                      sameAff={sameAff}
                      conflicted={conflictedAggIds}
                    />
                  )}
                </div>
              </div>
            )}
          </section>

          {/* 면접위원 초빙 — 풀에서 비충돌 전문가를 골라 담고 엑셀로 산출(명단은 DB 영속). */}
          {poolReady && (
            <InvitePanel
              applicantId={applicant.id}
              categories={inviteCategories}
              initialDae={applicant.fieldDae ?? ''}
              initialMid={applicant.fieldMid ?? ''}
              initialCandidates={inviteCandidates.items}
              initialTotal={inviteCandidates.total}
              initialInvitations={invitationList}
            />
          )}

          {/* 제출 문서 */}
          <section className="seed-card overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-stroke bg-bg-layer px-4 py-2.5">
              <span className="h-4 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
              <span className="text-[13px] font-bold tracking-[0.04em] text-fg">제출 문서</span>
              <span className="seed-badge-neutral">{documents.length}건</span>
              <span className="text-[11px] text-fg-subtle">— 유형별로 묶었습니다. 클릭하면 원문·검출 관계자를 나란히 봅니다.</span>
            </div>
            <div className="p-3">
              <DocumentList
                items={documents.map((d) => ({
                  id: d.id,
                  filename: d.filename,
                  label: DOC_TYPE_LABELS_KO[d.docType],
                  format: d.sourceFormat,
                  people: docPeopleList.get(d.id) ?? [],
                  pageCount: d.pageCount,
                  // 텍스트가 있는데 0명 → 추출 실패 가능성. 카드에 경고 배지로 드러낸다.
                  zeroWarn: isTextish(d) && (docPeople.get(d.id) ?? 0) === 0,
                }))}
              />
            </div>
          </section>
        </div>

        {/* ── 우측 사이드레일 — 진단(제척·자동점검). xl 미만에선 메인 위로(order-first). ── */}
        <aside className="order-first space-y-5 xl:order-none xl:sticky xl:top-[4.5rem] xl:max-h-[calc(100vh-5.5rem)] xl:overflow-y-auto">
          {/* 전문가 풀 대조 — 관계자와 이름이 일치하는 심사위원 후보(제척 대상). */}
          <ExpertConflictSection poolCount={poolCount} conflicts={conflicts} />

          {/* 자동 점검 — 추출 결과 신뢰성 게이트(누락을 숨기지 않음). 최종 판단은 사람. */}
          <section className="seed-card overflow-hidden">
            <header className="flex items-center gap-2 border-b border-stroke bg-bg-layer px-4 py-2.5 text-sm">
              <span className="h-4 w-1 shrink-0 rounded-full bg-info" aria-hidden />
              <span className="font-semibold text-fg">자동 점검</span>
              <span className="text-fg-subtle">— 본인 제외 · 커버리지 · 검토 필요</span>
            </header>
            <ul className="divide-y divide-stroke">
              {checks.map((c) => (
                <li key={c.id} className="flex items-start gap-2.5 px-4 py-2.5 text-sm">
                  <CheckDot level={c.level} />
                  <div className="min-w-0">
                    <p className={c.level === 'warn' ? 'font-medium text-warning' : 'text-fg'}>
                      {c.label}
                    </p>
                    {c.detail && (
                      <p className="truncate text-xs text-fg-muted" title={c.detail}>
                        {c.detail}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {/* 분석 범위·추정 한계 고지(벤치마킹) — 자동 결과는 초안이며 최종 판단은 사람. */}
      <p className="border-t border-stroke pt-4 text-center text-xs text-fg-subtle">
        연관자 식별은 지원자 제출자료에 한정됩니다 · 한글 추정·동일소속(추정)은 검토 참고용이며 최종
        확인이 필요합니다
      </p>
    </div>
  );
}

/** 자동 점검 행 앞의 상태 점 — pass=그린, warn=앰버, info=블루. */
function CheckDot({ level }: { level: CheckLevel }) {
  const cls = level === 'pass' ? 'bg-success' : level === 'warn' ? 'bg-warning' : 'bg-info';
  return <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

/** 전문가 분류체계 경로를 짧게 — 첫 경로 + "외 N". */
function fieldLabel(fields: ExpertField[]): string {
  const f = fields[0];
  const path = [f.dae, f.mid, f.sub, f.det].filter(Boolean).join(' > ');
  return fields.length > 1 ? `${path} 외 ${fields.length - 1}` : path;
}

/**
 * 전문가 풀 대조 — 관계자와 이름이 일치하는 심사위원 후보(제척 대상)를 보여준다. 이름 일치 기준이라
 * 동명이인일 수 있으므로 소속·분야를 함께 제시하고 최종 판단은 사람이 한다(자동 차단 없음).
 */
function ExpertConflictSection({
  poolCount,
  conflicts,
}: {
  poolCount: number;
  conflicts: ExpertConflict[];
}) {
  if (poolCount === 0) {
    return (
      <section className="seed-card flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-sm">
        <span className="font-semibold text-fg">전문가 풀 대조</span>
        <span className="text-fg-subtle">
          — 전문가 풀 미등록. <code className="text-fg-muted">scripts/import-experts.ts</code> 로 명단을
          적재하면 제척 대상이 표시됩니다.
        </span>
      </section>
    );
  }
  return (
    <section className="seed-card overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-stroke bg-bg-layer/60 px-4 py-2.5 text-sm">
        <span className="h-4 w-1 shrink-0 rounded-full bg-danger" aria-hidden />
        <span className="font-semibold text-fg">전문가 풀 대조 — 제척 대상</span>
        <span className="text-fg-subtle">
          풀 {poolCount.toLocaleString()}명 중 일치 {conflicts.length}명
          {conflicts.some((c) => c.confidence === 'low') &&
            ` · 확인 필요 ${conflicts.filter((c) => c.confidence === 'low').length}`}
        </span>
      </header>
      {conflicts.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-fg-muted">
          관계자와 이름이 일치하는 전문가가 없습니다 — 제척 대상 없음.
        </p>
      ) : (
        <ul className="divide-y divide-stroke">
          {conflicts.map((c) => (
            <li key={c.expert.id} className="space-y-1 px-4 py-3 text-sm">
              <p className="flex flex-wrap items-center gap-1.5 font-semibold text-fg">
                {c.expert.name}
                {c.coiTypes.map((t) => (
                  <span key={t.code} className="seed-badge-danger" title={`제척 유형: ${t.label}`}>
                    {t.label}
                  </span>
                ))}
                {c.confidence === 'low' && (
                  <span
                    className="seed-badge-warning"
                    title={`풀에 같은 이름 ${c.homonymCount}명 · 소속 등 부차증거 없음 — 다른 사람일 수 있어 직접 대조 필요`}
                  >
                    확인 필요{c.homonymCount > 1 ? ` (동명이인 ${c.homonymCount})` : ''}
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-fg-muted">
                {[c.expert.affiliation, c.expert.position].filter(Boolean).join(' · ') || '소속 미상'}
                {c.expert.fields.length > 0 && ` · ${fieldLabel(c.expert.fields)}`}
              </p>
              {/* 왜 걸렸나 — 근거 문서·페이지(클릭 시 원문 해당 쪽). */}
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-subtle">
                <span>
                  관계자 일치 <span className="font-medium text-fg">{c.matchedNames.join(', ')}</span>
                </span>
                {c.sources.map((s, i) => (
                  <a
                    key={`${s.documentId}-${i}`}
                    href={`/api/file/${s.documentId}#page=${s.page}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-info underline-offset-2 hover:underline"
                    title="원문 해당 쪽 열기"
                  >
                    {DOC_TYPE_LABELS_KO[s.docType]} p.{s.page} {ROLE_LABELS_KO[s.role]} ↗
                  </a>
                ))}
              </p>
              {c.expert.email && <p className="text-xs text-fg-subtle">{c.expert.email}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-stroke px-4 py-2 text-xs text-fg-subtle">
        유형·근거는 표준(NSF/NIH/COPE) 참고용 분류이며, 동명이인('확인 필요')일 수 있으니 근거 문서로 최종
        확인하세요. 제척은 사람이 확정합니다.
      </p>
    </section>
  );
}

/** Shared people table — identical column layout in every group card and the flat view. */
function PeopleTable({
  rows,
  sameAff,
  conflicted,
}: {
  rows: PersonAggregate[];
  /** aggregateId → 본인과 동일하다고 추정된 기관명 (기관 단위 제척 근거 배지). */
  sameAff: Map<string, string>;
  /** 전문가 풀과 이름이 일치한 관계자 aggregateId 집합 (제척 후보 배지). */
  conflicted: Set<string>;
}) {
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
      {/* thead: 11px+bold+tracking-wide — 본문 행(text-sm 14px)과 크기 차로 컬럼 헤더 역할 명확화 */}
      <thead className="bg-bg-layer text-left">
        <tr>
          <th className="px-4 py-2.5 text-[11px] font-bold tracking-wide text-fg-muted">이름</th>
          <th className="px-4 py-2.5 text-[11px] font-bold tracking-wide text-fg-muted">역할</th>
          <th className="px-4 py-2.5 text-[11px] font-bold tracking-wide text-fg-muted">소속</th>
          <th className="px-4 py-2.5 text-[11px] font-bold tracking-wide text-fg-muted">출처</th>
          <th className="px-4 py-2.5 text-[11px] font-bold tracking-wide text-fg-muted">상태</th>
          <th className="px-4 py-2.5" />
        </tr>
      </thead>
      <tbody className="divide-y divide-stroke">
        {rows.map((p) => (
          <tr key={p.id} className="align-top transition-colors duration-100 hover:bg-bg-layer/50">
            <td className="px-4 py-3 font-semibold text-fg">
              {p.canonicalName}
              <KoreanEstimate name={p.canonicalName} />
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
              {sameAff.has(p.id) && (
                <span
                  className="seed-badge-warning mt-1 inline-block"
                  title={`본인 소속과 동일 기관 추정: ${sameAff.get(p.id)} — 기관 단위 제척 근거`}
                >
                  동일소속
                </span>
              )}
            </td>
            <td className="px-4 py-3 text-fg-muted">
              {p.sources.map((s, i) => (
                <a
                  key={`${s.documentId}-${i}`}
                  href={`/api/file/${s.documentId}`}
                  target="_blank"
                  rel="noreferrer"
                  title={s.evidence ?? s.filename}
                  className="mr-2 inline-block whitespace-nowrap text-info underline-offset-2 transition-colors hover:text-info/80 hover:underline"
                >
                  {DOC_TYPE_LABELS_KO[s.docType]} p.{s.page}
                </a>
              ))}
            </td>
            <td className="space-y-1 px-4 py-3">
              {conflicted.has(p.id) && (
                <span
                  className="seed-badge-danger block"
                  title="전문가 풀과 이름 일치 — 이 지원자 심사에서 제척 검토 대상(동명이인 가능)"
                >
                  제척
                </span>
              )}
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

/** 로마자 표기 이름의 한글 추정 병기 — 심사위원 풀(한글명) 수기 대조 보조. 추정 불가면 아무것도 안 그린다. */
function KoreanEstimate({ name }: { name: string }) {
  const est = estimateKoreanName(name);
  if (!est) return null;
  return (
    <span
      className="mt-0.5 block text-xs font-normal text-fg-subtle"
      title="로마자 표기에서 추정한 한글명 — 검토 참고용이며 확정이 아닙니다"
    >
      한글 추정: {est}
    </span>
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
      : `${chip} border border-stroke-strong bg-bg text-fg-muted hover:border-accent/40 hover:bg-accent-subtle/30 hover:text-fg`;
  return (
    <Link href={view === 'all' ? `/applicants/${id}` : `/applicants/${id}?view=${view}`} className={`no-underline ${base}`}>
      {label} {count}
    </Link>
  );
}
