'use client';

/**
 * ApplicantReviewClient — client island for the 관계자 검토 work-area (ERP-style 2-pane).
 *
 * Layout: a persistent LEFT sidebar (filter facets + 자동 점검) as grid column 1, and the
 * 관계자 검토 table as column 2. The page (page.tsx) is full-bleed (PC-only ERP), so the
 * sidebar sits in the left margin instead of being crammed into a centered container.
 *
 * Each person row is a Notion-style toggle: the row shows name/role/status/actions; clicking it
 * expands a detail panel with 소속, 출처, and — for 제척(expert-pool match) — the full conflict
 * detail (expert 소속·직위·분야, 일치 관계자, 근거 문서·페이지, 이메일). That detail used to live in a
 * right rail; it isn't always-needed, so it's now on-demand per person.
 *
 * Props are all serializable (no Map/Set/function) so Next.js can pass them server→client.
 */

import { useCallback, useMemo, useState } from 'react';
import { ConfidenceBadge, FinalStatusBadge, RoleBadges } from '@/components/badges';
import { GroupToggle } from '@/components/GroupToggle';
import { PersonActions } from '@/components/PersonActions';
import { estimateKoreanName } from '@/lib/hangulize';
import { DOC_TYPE_LABELS_KO, ROLE_LABELS_KO, ROLES, type DocType, type Role } from '@/lib/domain';
import type { ApplicantCheck, CheckLevel } from '@/lib/checks';
import type { PersonAggregate } from '@/db/schema';

/** 한 관계자가 전문가 풀과 이름이 일치했을 때의 제척 상세 — 행 토글 안에서 펼쳐 보여 준다. */
export interface ConflictDetail {
  expertName: string;
  affiliation: string | null;
  position: string | null;
  /** `대 > 중 > 세부 외 N` — 서버에서 미리 만든 분야 경로 문자열. */
  fieldsLabel: string;
  matchedNames: string[];
  coiTypes: { code: string; label: string }[];
  confidence: 'high' | 'low';
  homonymCount: number;
  email: string | null;
  sources: { documentId: string; page: number; docType: DocType; role: Role }[];
}

// ─── domain helpers (kept local to this client bundle) ──────────────────────

const needsReview = (p: PersonAggregate) =>
  (p.needsHuman || p.nameCandidates.length > 1) && p.finalStatus === 'pending';

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

function byReviewThenName(a: PersonAggregate, b: PersonAggregate): number {
  if (needsReview(a) !== needsReview(b)) return needsReview(a) ? -1 : 1;
  return a.canonicalName.localeCompare(b.canonicalName, 'ko');
}

function CheckDot({ level }: { level: CheckLevel }) {
  const cls = level === 'pass' ? 'bg-success' : level === 'warn' ? 'bg-warning' : 'bg-info';
  return <span aria-hidden className={`mt-1 h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

// ─── filter sidebar (presentational) ─────────────────────────────────────────

interface StatusOption {
  key: string;
  label: string;
  count: number;
  colorCls: string;
}
interface RoleOption {
  role: Role;
  label: string;
  count: number;
}

/**
 * 좌측 사이드바 — 필터 패싯(상태·역할) + 자동 점검. 순수 표현 컴포넌트로, 카운트·옵션 노출 여부는
 * 부모가 패싯 검색 의미(검색 ∩ 다른 그룹 선택, 자기 그룹 선택은 제외)로 계산해 내려준다 → 카운트가
 * 항상 표에 보이는 행 수와 일치한다.
 */
function FilterSidebar({
  statusOptions,
  roleOptions,
  statusSel,
  roleSel,
  onToggleStatus,
  onToggleRole,
  onReset,
  checks,
}: {
  statusOptions: StatusOption[];
  roleOptions: RoleOption[];
  statusSel: Set<string>;
  roleSel: Set<string>;
  onToggleStatus: (v: string) => void;
  onToggleRole: (v: string) => void;
  onReset: () => void;
  checks: ApplicantCheck[];
}) {
  const hasFilter = statusSel.size > 0 || roleSel.size > 0;
  const rowCls = (active: boolean) =>
    `flex cursor-pointer items-center gap-2 rounded-seed px-2 py-1.5 text-sm transition-colors ${
      active ? 'bg-accent-subtle text-fg' : 'text-fg-muted hover:bg-bg-layer hover:text-fg'
    }`;

  return (
    <div className="seed-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-fg">필터</h2>
        {hasFilter && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs font-medium text-accent underline-offset-2 hover:underline"
          >
            초기화
          </button>
        )}
      </div>
      <p className="mt-0.5 text-xs text-fg-subtle">좁혀서 검토하세요</p>

      {statusOptions.length > 0 && (
        <div className="mt-4 border-t border-stroke pt-3">
          <p className="mb-2 text-xs font-semibold text-fg-muted">상태</p>
          <ul className="space-y-0.5">
            {statusOptions.map((o) => {
              const active = statusSel.has(o.key);
              return (
                <li key={o.key}>
                  <label className={rowCls(active)}>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => onToggleStatus(o.key)}
                      className="size-3.5 shrink-0 accent-accent"
                    />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    <span
                      className={`shrink-0 text-xs font-semibold ${active ? 'text-fg-muted' : o.colorCls}`}
                    >
                      {o.count}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {roleOptions.length > 0 && (
        <div className="mt-4 border-t border-stroke pt-3">
          <p className="mb-2 text-xs font-semibold text-fg-muted">역할</p>
          <ul className="space-y-0.5">
            {roleOptions.map((o) => {
              const active = roleSel.has(o.role);
              return (
                <li key={o.role}>
                  <label className={rowCls(active)}>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => onToggleRole(o.role)}
                      className="size-3.5 shrink-0 accent-accent"
                    />
                    <span className="min-w-0 flex-1 truncate" title={o.label}>
                      {o.label}
                    </span>
                    <span className="shrink-0 text-xs text-fg-subtle">{o.count}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {checks.length > 0 && (
        <div className="mt-4 border-t border-stroke pt-3">
          <p className="mb-2 text-xs font-semibold text-fg-muted">자동 점검</p>
          <ul className="space-y-1.5">
            {checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-xs">
                <CheckDot level={c.level} />
                <div className="min-w-0">
                  <p className={c.level === 'warn' ? 'font-medium text-warning' : 'text-fg-muted'}>
                    {c.label}
                  </p>
                  {c.detail && (
                    <p className="truncate text-fg-subtle" title={c.detail}>
                      {c.detail}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── people table (master rows + per-row detail toggle) ──────────────────────

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

/** 행 토글로 펼쳐지는 상세 — 소속·출처(+ 제척이면 전문가 풀 일치 상세). */
function PersonDetail({
  p,
  sameAffInst,
  conflicts,
}: {
  p: PersonAggregate;
  sameAffInst?: string;
  conflicts: ConflictDetail[] | null;
}) {
  return (
    <div className="space-y-3 rounded-seed border border-stroke bg-bg p-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">소속</p>
          <p className="mt-0.5 text-fg-muted">{p.affiliation ?? '—'}</p>
          {sameAffInst && (
            <p className="mt-0.5 text-xs text-warning">
              본인 소속과 동일 기관 추정: {sameAffInst} — 기관 단위 제척 근거
            </p>
          )}
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">출처</p>
          {p.sources.length === 0 ? (
            <p className="mt-0.5 text-xs text-fg-subtle">출처 없음</p>
          ) : (
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
              {p.sources.map((s, i) => (
                <a
                  key={`${s.documentId}-${i}`}
                  href={`/api/file/${s.documentId}`}
                  target="_blank"
                  rel="noreferrer"
                  title={s.evidence ?? s.filename}
                  className="whitespace-nowrap text-info underline-offset-2 hover:underline"
                >
                  {DOC_TYPE_LABELS_KO[s.docType]} p.{s.page}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {conflicts && conflicts.length > 0 && (
        <div className="space-y-2">
          {conflicts.map((d, i) => (
            <div
              key={`${d.expertName}-${i}`}
              className="rounded-seed border border-danger/30 bg-danger-subtle/40 p-2.5"
            >
              <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-fg">
                <span className="text-fg-muted">전문가 풀 일치:</span> {d.expertName}
                {d.coiTypes.map((t) => (
                  <span key={t.code} className="seed-badge-danger" title={`제척 유형: ${t.label}`}>
                    {t.label}
                  </span>
                ))}
                {d.confidence === 'low' && (
                  <span
                    className="seed-badge-warning"
                    title={`풀에 같은 이름 ${d.homonymCount}명 · 부차증거 없음 — 다른 사람일 수 있어 직접 대조 필요`}
                  >
                    확인 필요{d.homonymCount > 1 ? ` (동명이인 ${d.homonymCount})` : ''}
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-fg-muted">
                {[d.affiliation, d.position].filter(Boolean).join(' · ') || '소속 미상'}
                {d.fieldsLabel && ` · ${d.fieldsLabel}`}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-subtle">
                <span>
                  관계자 일치 <span className="font-medium text-fg">{d.matchedNames.join(', ')}</span>
                </span>
                {d.sources.map((s, j) => (
                  <a
                    key={`${s.documentId}-${j}`}
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
              {d.email && <p className="mt-1 text-xs text-fg-subtle">{d.email}</p>}
            </div>
          ))}
          <p className="text-[11px] text-fg-subtle">
            유형·근거는 표준(NSF/NIH/COPE) 참고용 분류이며, 동명이인(&lsquo;확인 필요&rsquo;)일 수
            있으니 근거 문서로 최종 확인하세요. 제척은 사람이 확정합니다.
          </p>
        </div>
      )}
    </div>
  );
}

function PersonRow({
  p,
  sameAff,
  conflicted,
  conflicts,
}: {
  p: PersonAggregate;
  sameAff: Record<string, string>;
  conflicted: Set<string>;
  conflicts: ConflictDetail[] | null;
}) {
  const [open, setOpen] = useState(false);
  const isConflicted = conflicted.has(p.id);
  return (
    <>
      <tr
        onClick={() => setOpen((o) => !o)}
        className="cursor-pointer align-top transition-colors duration-100 hover:bg-bg-layer/50"
      >
        <td className="py-3 pl-3 pr-1 align-middle">
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? '상세 접기' : '상세 펼치기'}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-seed text-fg-subtle transition-colors hover:bg-bg-layer hover:text-fg"
          >
            <svg
              aria-hidden
              className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
        </td>
        <td className="px-2 py-3 font-semibold text-fg">
          {p.canonicalName}
          <KoreanEstimate name={p.canonicalName} />
          {p.nameCandidates.length > 1 && (
            <span className="mt-0.5 block text-xs font-normal text-warning">
              후보: {p.nameCandidates.map((c) => c.name).join(' / ')}
            </span>
          )}
        </td>
        <td className="px-3 py-3">
          <RoleBadges roles={p.roles} />
        </td>
        <td className="px-3 py-3">
          {/* 배지는 내용 너비만 차지하도록 flex-col + items-start — block을 쓰면 넓어진 열을 가득 채워
              제척 빨강이 형광펜처럼 과하게 칠해진다(이 버그 수정). */}
          <div className="flex flex-col items-start gap-1">
            {isConflicted && (
              <span
                className="seed-badge-danger"
                title="전문가 풀과 이름 일치 — 이 지원자 심사에서 제척 검토 대상(동명이인 가능). 행을 펼쳐 상세를 보세요"
              >
                제척
              </span>
            )}
            {sameAff[p.id] && (
              <span
                className="seed-badge-warning"
                title={`본인 소속과 동일 기관 추정: ${sameAff[p.id]} — 기관 단위 제척 근거`}
              >
                동일소속
              </span>
            )}
            <ConfidenceBadge needsHuman={p.needsHuman} />
            <FinalStatusBadge status={p.finalStatus} />
          </div>
        </td>
        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
          <PersonActions
            aggregateId={p.id}
            currentName={p.canonicalName}
            candidates={p.nameCandidates}
          />
        </td>
      </tr>
      {open && (
        <tr className="bg-bg-layer/30">
          <td aria-hidden />
          <td colSpan={4} className="px-2 pb-4 pr-3 pt-1">
            <PersonDetail p={p} sameAffInst={sameAff[p.id]} conflicts={conflicts} />
          </td>
        </tr>
      )}
    </>
  );
}

function PeopleTable({
  rows,
  sameAff,
  conflicted,
  conflictsByAgg,
}: {
  rows: PersonAggregate[];
  sameAff: Record<string, string>;
  conflicted: Set<string>;
  conflictsByAgg: Record<string, ConflictDetail[]>;
}) {
  return (
    <table className="w-full table-fixed text-sm">
      <colgroup>
        <col className="w-10" />
        <col className="w-[34%]" />
        <col className="w-[24%]" />
        <col className="w-[24%]" />
        <col />
      </colgroup>
      <thead className="bg-bg-layer text-left">
        <tr>
          <th className="py-2.5" aria-hidden />
          <th className="px-2 py-2.5 text-[11px] font-bold tracking-wide text-fg-muted">이름</th>
          <th className="px-3 py-2.5 text-[11px] font-bold tracking-wide text-fg-muted">역할</th>
          <th className="px-3 py-2.5 text-[11px] font-bold tracking-wide text-fg-muted">상태</th>
          <th className="px-3 py-2.5" />
        </tr>
      </thead>
      <tbody className="divide-y divide-stroke">
        {rows.map((p) => (
          <PersonRow
            key={p.id}
            p={p}
            sameAff={sameAff}
            conflicted={conflicted}
            conflicts={conflictsByAgg[p.id] ?? null}
          />
        ))}
      </tbody>
    </table>
  );
}

// ─── exported component ──────────────────────────────────────────────────────

export function ApplicantReviewClient({
  people,
  sameAff,
  conflicted,
  conflictsByAgg,
  rolesPresent,
  checks,
}: {
  people: PersonAggregate[];
  /** aggregateId → institution name (plain Record — serializable from server) */
  sameAff: Record<string, string>;
  /** aggregateIds that matched the expert pool */
  conflicted: string[];
  /** aggregateId → 제척 상세(전문가 풀 일치). 행 토글에서 펼쳐 보여 준다. */
  conflictsByAgg: Record<string, ConflictDetail[]>;
  rolesPresent: Role[];
  /** 자동 점검 결과 — 좌측 사이드바 하단에 표시(우측 레일 제거에 따라 이동). */
  checks: ApplicantCheck[];
}) {
  const [statusSel, setStatusSel] = useState<Set<string>>(new Set());
  const [roleSel, setRoleSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');

  // Stable derived Sets from the serialized arrays/objects
  const conflictedSet = useMemo(() => new Set(conflicted), [conflicted]);
  const sameAffKeys = useMemo(() => new Set(Object.keys(sameAff)), [sameAff]);

  function toggleStatus(v: string) {
    setStatusSel((prev) => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });
  }

  function toggleRole(v: string) {
    setRoleSel((prev) => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });
  }

  function reset() {
    setStatusSel(new Set());
    setRoleSel(new Set());
    setQ('');
  }

  const hasFilter = statusSel.size > 0 || roleSel.size > 0;
  const activeFilterCount = statusSel.size + roleSel.size;
  const reviewCount = useMemo(() => people.filter(needsReview).length, [people]);

  // 상태 필터: 선택된 키 AND. 역할 필터: 선택된 역할 OR. (useCallback로 안정화해 패싯 카운트 의존성에 사용)
  const passStatus = useCallback(
    (p: PersonAggregate) => {
      for (const key of statusSel) {
        if (key === 'review' && !needsReview(p)) return false;
        if (key === 'conflict' && !conflictedSet.has(p.id)) return false;
        if (key === 'sameAff' && !sameAffKeys.has(p.id)) return false;
      }
      return true;
    },
    [statusSel, conflictedSet, sameAffKeys],
  );
  const passRole = useCallback(
    (p: PersonAggregate) => roleSel.size === 0 || p.roles.some((r) => roleSel.has(r)),
    [roleSel],
  );

  // 검색은 표·사이드바 카운트 공통의 모집단 축소 — 둘이 어긋나지 않도록 같은 기반에서 센다.
  const qTrim = q.trim();
  const ql = qTrim.toLowerCase();
  const searchScoped = useMemo(
    () =>
      !qTrim
        ? people
        : people.filter(
            (p) =>
              p.canonicalName.toLowerCase().includes(ql) ||
              (p.affiliation ?? '').toLowerCase().includes(ql) ||
              (estimateKoreanName(p.canonicalName) ?? '').includes(qTrim) ||
              p.roles.some((r) => ROLE_LABELS_KO[r].includes(qTrim)),
          ),
    [people, qTrim, ql],
  );

  // 패싯 카운트 기반: 자기 그룹 선택은 빼고(다른 그룹 선택 + 검색만 반영) 센다 — 표준 패싯 검색.
  const statusCountBase = useMemo(() => searchScoped.filter(passRole), [searchScoped, passRole]);
  const roleCountBase = useMemo(() => searchScoped.filter(passStatus), [searchScoped, passStatus]);

  // 표시 행 = 검색 ∩ 상태 ∩ 역할
  const shown = useMemo(
    () => searchScoped.filter((p) => passStatus(p) && passRole(p)),
    [searchScoped, passStatus, passRole],
  );

  // 상태 옵션 — 전체 모집단에 존재하는 상태만 노출(검색해도 옵션이 깜빡이지 않게), 카운트는 검색·역할 반영.
  const statusOptions = useMemo<StatusOption[]>(() => {
    const opts: StatusOption[] = [];
    if (people.some(needsReview))
      opts.push({
        key: 'review',
        label: '검토 필요',
        count: statusCountBase.filter(needsReview).length,
        colorCls: 'text-warning',
      });
    if (people.some((p) => conflictedSet.has(p.id)))
      opts.push({
        key: 'conflict',
        label: '제척',
        count: statusCountBase.filter((p) => conflictedSet.has(p.id)).length,
        colorCls: 'text-danger',
      });
    if (people.some((p) => sameAffKeys.has(p.id)))
      opts.push({
        key: 'sameAff',
        label: '동일소속',
        count: statusCountBase.filter((p) => sameAffKeys.has(p.id)).length,
        colorCls: 'text-warning',
      });
    return opts;
  }, [people, statusCountBase, conflictedSet, sameAffKeys]);

  // 역할 옵션 — 전체에 존재하는 역할만, 카운트는 검색·상태 반영. (한 사람이 여러 역할이면 합계 > 인원수)
  const roleOptions = useMemo<RoleOption[]>(
    () =>
      rolesPresent.map((r) => ({
        role: r,
        label: ROLE_LABELS_KO[r],
        count: roleCountBase.filter((p) => p.roles.includes(r)).length,
      })),
    [rolesPresent, roleCountBase],
  );

  // Grouped mode: only when no sidebar filters and no search query
  const groupedMode = !hasFilter && !qTrim;

  const groups = useMemo(() => {
    if (!groupedMode) return [];
    return [...rolesPresent, null].flatMap((role) => {
      const rows = people.filter((p) => primaryRole(p) === role).sort(byReviewThenName);
      return rows.length ? [{ role: role as Role | null, rows }] : [];
    });
  }, [groupedMode, people, rolesPresent]);

  const sidebarProps = {
    statusOptions,
    roleOptions,
    statusSel,
    roleSel,
    onToggleStatus: toggleStatus,
    onToggleRole: toggleRole,
    onReset: reset,
    checks,
  };

  return (
    <>
      {/* ── 좌측 사이드바 — PC ERP: 항상 표시, 스크롤을 따라다님 ── */}
      <aside
        aria-label="관계자 필터"
        className="lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto"
      >
        <FilterSidebar {...sidebarProps} />
      </aside>

      {/* ── 메인 — 관계자 검토 표 ── */}
      <div className="min-w-0">
        <section className="seed-card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-stroke bg-bg-layer px-4 py-2.5">
            <span className="h-4 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
            <span className="text-sm font-semibold text-fg">관계자 검토</span>
            <span className="text-xs text-fg-subtle">— 행을 클릭하면 소속·출처·제척 상세가 열립니다</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="이름·소속 검색"
                aria-label="관계자 검색"
                className="seed-input w-44"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ('')}
                  className="text-sm text-fg-muted underline-offset-2 hover:underline"
                >
                  지우기
                </button>
              )}
              {groupedMode && groups.length > 1 && <GroupToggle />}
            </div>
          </div>

          {groupedMode ? (
            groups.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-fg-muted">
                추출된 관계자가 없습니다.
              </p>
            ) : (
              <div className="divide-y divide-stroke">
                {groups.map((g, i) => {
                  const groupReview = g.rows.filter(needsReview).length;
                  const defaultOpen = groupReview > 0 || (reviewCount === 0 && i === 0);
                  return (
                    <details
                      key={g.role ?? 'etc'}
                      data-role-group
                      open={defaultOpen}
                      className="group"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-l-[3px] border-l-accent px-4 py-3 transition-colors hover:bg-bg-layer/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                        <span className="flex flex-wrap items-center gap-2 text-[13px] font-bold tracking-[0.04em] text-fg">
                          {g.role ? ROLE_LABELS_KO[g.role] : '기타'}
                          <span className="font-normal normal-case tracking-normal text-fg-subtle">
                            {g.rows.length}명
                          </span>
                          {groupReview > 0 ? (
                            <span className="seed-badge-warning">검토 {groupReview}</span>
                          ) : (
                            <span className="seed-badge-success">모두 자동 통과</span>
                          )}
                        </span>
                        <svg
                          aria-hidden
                          className="ms-chevron h-4 w-4 shrink-0 text-fg-subtle group-open:rotate-180"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M4 6l4 4 4-4" />
                        </svg>
                      </summary>
                      <div className="overflow-x-auto border-t border-stroke">
                        <PeopleTable
                          rows={g.rows}
                          sameAff={sameAff}
                          conflicted={conflictedSet}
                          conflictsByAgg={conflictsByAgg}
                        />
                      </div>
                    </details>
                  );
                })}
              </div>
            )
          ) : (
            <div>
              <div className="flex items-center gap-2 border-b border-stroke px-4 py-2 text-sm text-fg-muted">
                <span className="font-medium text-fg">
                  {hasFilter || qTrim ? '필터 결과' : '전체'}
                </span>
                <span>{shown.length}명</span>
                {qTrim && <span className="text-fg-subtle">&mdash; &ldquo;{q}&rdquo; 검색 결과</span>}
                {hasFilter && !qTrim && (
                  <span className="text-fg-subtle">&mdash; 필터 {activeFilterCount}개 적용됨</span>
                )}
              </div>
              <div className="overflow-x-auto">
                {shown.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-fg-muted">
                    {qTrim
                      ? `"${q}"에 해당하는 관계자가 없습니다.`
                      : '선택한 필터에 해당하는 관계자가 없습니다.'}
                  </p>
                ) : (
                  <PeopleTable
                    rows={[...shown].sort(byReviewThenName)}
                    sameAff={sameAff}
                    conflicted={conflictedSet}
                    conflictsByAgg={conflictsByAgg}
                  />
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
