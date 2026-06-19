import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocumentList, type DocPersonRef } from '@/components/DocumentList';
import { RunningIndicator } from '@/components/RunningIndicator';
import { StatCell } from '@/components/StatCell';
import { buildApplicantChecks, sharedInstitution } from '@/lib/checks';
import { InvitePanel } from '@/components/InvitePanel';
import { findExpertConflicts, getExpertPoolCount } from '@/lib/experts';
import { getExpertCategories, getInvitations, getInviteCandidates } from '@/lib/invite';
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
import { ApplicantReviewClient, type ConflictDetail } from '@/components/ApplicantReviewClient';

export const dynamic = 'force-dynamic';

const needsReview = (p: PersonAggregate) =>
  (p.needsHuman || p.nameCandidates.length > 1) && p.finalStatus === 'pending';

export default async function ApplicantPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await getApplicantReview(params.id);
  if (!data) notFound();

  const { applicant, aggregates, documents, job, openFlags } = data;
  const people = aggregates.filter((a) => !a.isSelf);
  const self = aggregates.filter((a) => a.isSelf);
  const reviewCount = people.filter(needsReview).length;

  // 전문가 풀 대조(제척)
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
  // 제외(rejected)된 관계자는 제척 대상에서도 빼야 일관적 — 동명이인(같은 이름키)이 매칭돼도 제외 건은
  // 이미 사람이 배제한 것이므로 다시 제척으로 띄우지 않는다. (findExpertConflicts 입력과 동일 모집단)
  const conflictedAggIds = new Set(
    people
      .filter((p) => p.finalStatus !== 'rejected' && conflictKeys.has(nameKey(p.canonicalName)))
      .map((p) => p.id),
  );

  // 면접위원 초빙
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

  // 동일 소속기관(추정) — converted to plain Record<string,string> for client prop serialization
  const selfAffiliations = self.map((s) => s.affiliation);
  const sameAffMap = new Map<string, string>();
  for (const p of people) {
    const inst = sharedInstitution(selfAffiliations, p.affiliation);
    if (inst) sameAffMap.set(p.id, inst);
  }
  const sameAff: Record<string, string> = Object.fromEntries(sameAffMap);

  // Serializable array of conflicted aggregate ids
  const conflicted: string[] = [...conflictedAggIds];

  // 관계자별 제척 상세 — 표의 행 토글에서 펼쳐 보여 줄 전문가 풀 일치 정보(이름키 일치 기준).
  const conflictsByAgg: Record<string, ConflictDetail[]> = {};
  for (const p of people) {
    if (!conflictedAggIds.has(p.id)) continue; // 제척 배지가 붙는 관계자에만 상세를 만든다(제외 건 제외)
    const matched = conflicts.filter((c) => c.expert.nameKey === nameKey(p.canonicalName));
    conflictsByAgg[p.id] = matched.map((c) => ({
      expertName: c.expert.name,
      affiliation: c.expert.affiliation,
      position: c.expert.position,
      fieldsLabel: c.expert.fields.length > 0 ? fieldLabel(c.expert.fields) : '',
      matchedNames: c.matchedNames,
      coiTypes: c.coiTypes.map((t) => ({ code: t.code, label: t.label })),
      confidence: c.confidence,
      homonymCount: c.homonymCount,
      email: c.expert.email,
      sources: c.sources.map((s) => ({
        documentId: s.documentId,
        page: s.page,
        docType: s.docType,
        role: s.role,
      })),
    }));
  }

  // Roles actually present, in ROLES priority order
  const rolesPresent = ROLES.filter((r) => people.some((p) => p.roles.includes(r)));

  // 문서별 추출 인원
  const docPeople = new Map<string, number>();
  for (const p of people) {
    for (const id of new Set(p.sources.map((s) => s.documentId))) {
      docPeople.set(id, (docPeople.get(id) ?? 0) + 1);
    }
  }

  // 문서별 검출 인물(드로어 패널용)
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
      if (s.evidence && !evidenceByDoc.has(s.documentId))
        evidenceByDoc.set(s.documentId, s.evidence);
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
    list.sort(
      (a, b) =>
        (a.pages[0] ?? 0) - (b.pages[0] ?? 0) || a.name.localeCompare(b.name, 'ko'),
    );
  }

  // 자동 점검
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
    sameAffiliationCount: sameAffMap.size,
  });

  // 수동 확인 필요 문서 (추출 0명 or 스캔)
  const manualCheck = documents
    .filter((d) => (docPeople.get(d.id) ?? 0) === 0)
    .map((d) => ({
      d,
      reason:
        d.sourceFormat === 'image' || !d.hasTextLayer
          ? '스캔·이미지 — 비전 추출, 직접 확인'
          : d.sourceFormat === 'hwp'
            ? 'HWP — 직접 확인'
            : '텍스트 있는데 0명 — 추출 누락 가능',
    }));

  const roleSummary = rolesPresent
    .map((r) => `${ROLE_LABELS_KO[r]} ${people.filter((p) => p.roles.includes(r)).length}`)
    .join(' · ');
  const selfAffsClean = [...new Set(selfAffiliations.filter((x): x is string => !!x))];

  return (
    <div className="mx-[calc(50%-50vw)] space-y-5 px-4 sm:px-6 xl:px-10 2xl:px-14">
      {/* ── 헤더 ── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <nav aria-label="breadcrumb" className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Link href="/" className="transition-colors hover:text-fg">
              지원자 목록
            </Link>
            <span aria-hidden className="text-stroke-strong">
              /
            </span>
            <span className="font-medium text-fg" aria-current="page">
              {applicant.name}
            </span>
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
          {/* 첫 방문자 orientation — 이 페이지가 무엇을 하는 곳인지 한 줄로 */}
          <p className="mt-0.5 text-sm text-fg-muted">
            제척·이해충돌 검토 페이지입니다. 관계자를 확인하고 제척 대상을 걸러 면접위원 초빙
            명단을 완성하세요.
          </p>
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
          <a
            className="seed-btn-neutral no-underline"
            href={`/api/export/${applicant.id}?format=csv`}
          >
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

      <StepStrip
        manualCount={manualCheck.length}
        reviewCount={reviewCount}
        conflictCount={conflictedAggIds.size}
        conflictsKnown={poolCount > 0}
        inviteReady={poolReady}
      />

      {/* ── 핵심 수치 요약 ── */}
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
          value={sameAffMap.size}
          label="동일소속(추정)"
          tone={sameAffMap.size > 0 ? 'warning' : undefined}
          detail="본인 소속과 같은 기관"
        />
        <StatCell
          index={3}
          value={poolCount > 0 ? conflictedAggIds.size : '—'}
          label="제척 대상"
          tone={conflictedAggIds.size > 0 ? 'danger' : undefined}
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
          detail={manualCheck.length > 0 ? `수동 확인 ${manualCheck.length}건` : '전 문서 추출됨'}
        />
      </section>

      {/* ── 수동 확인 필요 게이트 — 누락을 지나칠 수 없게 상단에 고정 ── */}
      {manualCheck.length > 0 && (
        <section
          id="step-gate"
          className="seed-card scroll-mt-20 overflow-hidden border-l-4 border-l-warning"
        >
          {/* 배지 행: icon + 배지만. 설명은 아래 별도 행으로 분리해 가독성 확보 */}
          <div className="flex flex-wrap items-center gap-2 border-b border-stroke bg-warning-subtle px-4 py-2.5">
            <span aria-hidden className="text-base">
              ⚠
            </span>
            <span className="text-sm font-bold text-warning">
              수동 확인 필요 {manualCheck.length}건
            </span>
          </div>
          <p className="border-b border-stroke bg-warning-subtle/40 px-4 py-2 text-xs text-fg-muted">
            자동 추출이 0명이거나 스캔·이미지 문서입니다. 관련인은 모두 제척되므로, 빠진 관련인이
            없는지 원문을 직접 확인하세요.
          </p>
          <ul className="divide-y divide-stroke">
            {manualCheck.map(({ d, reason }) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
              >
                <span className="seed-badge-neutral shrink-0">{DOC_TYPE_LABELS_KO[d.docType]}</span>
                <span className="min-w-0 flex-1 truncate text-fg" title={d.filename}>
                  {d.filename}
                </span>
                <span className="shrink-0 text-xs font-medium text-warning">{reason}</span>
                <a
                  href={`/api/file/${d.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="seed-btn-neutral shrink-0 px-2 py-0.5 text-xs no-underline"
                >
                  원문 열기 ↗
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        ── 본문 2단 그리드 (PC ERP, 풀블리드) ──
        [좌측 사이드바: 필터 + 자동 점검] [메인: 관계자 검토 표(전체 너비)]
        제척 상세는 우측 레일 대신 표의 행 토글에서 펼친다 — 항상 봐야 하는 정보가 아니므로 on-demand.
        ApplicantReviewClient returns a fragment: <aside>(col1) + <div>(col2).
        md 이하: 1열로 쌓임(사이드바 → 표).
      ──*/}
      <div
        id="step-review"
        className="grid scroll-mt-20 grid-cols-1 items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]"
      >
        <ApplicantReviewClient
          people={people}
          sameAff={sameAff}
          conflicted={conflicted}
          conflictsByAgg={conflictsByAgg}
          rolesPresent={rolesPresent}
          checks={checks}
        />
      </div>

      {/* InvitePanel and DocumentList span full width below the grid */}
      {poolReady && (
        <div id="step-invite" className="scroll-mt-20">
          <InvitePanel
            applicantId={applicant.id}
            categories={inviteCategories}
            initialDae={applicant.fieldDae ?? ''}
            initialMid={applicant.fieldMid ?? ''}
            initialCandidates={inviteCandidates.items}
            initialTotal={inviteCandidates.total}
            initialInvitations={invitationList}
          />
        </div>
      )}

      <section className="seed-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-stroke bg-bg-layer px-4 py-2.5">
          <span className="h-4 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
          <span className="text-[13px] font-bold tracking-[0.04em] text-fg">제출 문서</span>
          <span className="seed-badge-neutral">{documents.length}건</span>
          <span className="text-[11px] text-fg-subtle">
            — 유형별로 묶었습니다. 클릭하면 원문·검출 관계자를 나란히 봅니다.
          </span>
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
              zeroWarn: (docPeople.get(d.id) ?? 0) === 0,
            }))}
          />
        </div>
      </section>

      <p className="border-t border-stroke pt-4 text-center text-xs text-fg-subtle">
        연관자 식별은 지원자 제출자료에 한정됩니다 · 한글 추정·동일소속(추정)은 검토 참고용이며
        최종 확인이 필요합니다
      </p>
    </div>
  );
}

// ─── server-only sub-components ──────────────────────────────────────────────

/**
 * 검토 단계 안내 스트립 — 첫 방문자가 "어디서 무엇을 확인하는지"를 한 줄로 파악하고, 클릭하면 해당
 * 섹션으로 바로 이동한다. 주의가 필요한 단계(수동확인·검토필요·제척)만 색으로 강조하고 나머지는
 * 차분하게(neutral) 둬 시각 노이즈를 줄인다. 목표 단계(면접위원 초빙)는 브랜드 그린으로 표시.
 */
function StepStrip({
  manualCount,
  reviewCount,
  conflictCount,
  conflictsKnown,
  inviteReady,
}: {
  manualCount: number;
  reviewCount: number;
  conflictCount: number;
  conflictsKnown: boolean;
  inviteReady: boolean;
}) {
  const steps: Array<{
    n: number;
    label: string;
    href?: string;
    count: number | null;
    attention: 'warning' | 'danger' | 'goal' | null;
  }> = [
    {
      n: 1,
      label: '수동 확인',
      href: manualCount > 0 ? '#step-gate' : undefined,
      count: manualCount,
      attention: manualCount > 0 ? 'warning' : null,
    },
    {
      n: 2,
      label: '관계자 검토',
      href: '#step-review',
      count: reviewCount,
      attention: reviewCount > 0 ? 'warning' : null,
    },
    {
      n: 3,
      label: '제척 확정',
      href: '#step-review',
      count: conflictsKnown ? conflictCount : null,
      attention: conflictCount > 0 ? 'danger' : null,
    },
    {
      n: 4,
      label: '면접위원 초빙',
      href: inviteReady ? '#step-invite' : undefined,
      count: null,
      attention: 'goal',
    },
  ];
  return (
    <nav
      aria-label="검토 단계"
      className="seed-card flex items-center gap-1 overflow-x-auto px-2 py-1.5"
    >
      {steps.map((s, i) => {
        const tone =
          s.attention === 'warning'
            ? { text: 'text-warning', dot: 'bg-warning-subtle text-warning' }
            : s.attention === 'danger'
              ? { text: 'text-danger', dot: 'bg-danger-subtle text-danger' }
              : s.attention === 'goal'
                ? { text: 'text-accent', dot: 'bg-accent-subtle text-accent' }
                : { text: 'text-fg-muted', dot: 'bg-bg-layer text-fg-subtle' };
        const inner = (
          <>
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${tone.dot}`}
            >
              {s.n}
            </span>
            <span className={`whitespace-nowrap text-sm font-medium ${tone.text}`}>{s.label}</span>
            {s.count != null && s.count > 0 && (
              <span
                className={`shrink-0 rounded-full px-1.5 text-[11px] font-bold ${
                  s.attention === 'danger'
                    ? 'bg-danger-subtle text-danger'
                    : 'bg-warning-subtle text-warning'
                }`}
              >
                {s.count}
              </span>
            )}
          </>
        );
        return (
          <div key={s.n} className="flex items-center gap-1">
            {i > 0 && (
              <svg
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 text-stroke-strong"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 4l4 4-4 4" />
              </svg>
            )}
            {s.href ? (
              <a
                href={s.href}
                className="flex items-center gap-1.5 rounded-seed px-2 py-1 no-underline transition-colors hover:bg-bg-layer"
              >
                {inner}
              </a>
            ) : (
              <span className="flex items-center gap-1.5 px-2 py-1">{inner}</span>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function fieldLabel(fields: ExpertField[]): string {
  const f = fields[0];
  const path = [f.dae, f.mid, f.sub, f.det].filter(Boolean).join(' > ');
  return fields.length > 1 ? `${path} 외 ${fields.length - 1}` : path;
}

// 전문가 풀 일치(제척) 상세는 이제 ApplicantReviewClient의 행 토글에서 펼쳐 보여 준다
// (전 우측 레일의 ExpertConflictSection 제거 — page.tsx에서 conflictsByAgg로 가공해 전달).
