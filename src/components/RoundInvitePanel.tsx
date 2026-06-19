'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DOC_TYPE_LABELS_KO, ROLE_LABELS_KO } from '@/lib/domain';
import type { Expert } from '@/db/schema';
import type { RoundApplicant, RoundConflict } from '@/lib/rounds';

/**
 * 회차 통합 제척·섭외 패널 — 대조할 지원자(서류 합격자)를 고르면 그들의 제척 합집합과, 풀에서 그
 * 합집합을 제거한 섭외 가능 전문가를 보여 준다. 선택·분야·검색이 바뀌면 서버에서 다시 계산한다.
 */

interface Category {
  dae: string;
  mids: string[];
}

const PAGE = 60;
const avatarChar = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

function fieldsShort(e: Pick<Expert, 'fields'>): string {
  const f = e.fields[0];
  if (!f) return '';
  const path = [f.dae, f.mid, f.sub, f.det].filter(Boolean).join(' > ');
  return e.fields.length > 1 ? `${path} 외 ${e.fields.length - 1}` : path;
}

export function RoundInvitePanel({
  round,
  applicants,
  categories,
  initialConflicts,
  initialItems,
  initialTotal,
  initialExcludedCount,
  poolTotal,
}: {
  round: string;
  applicants: RoundApplicant[];
  categories: Category[];
  initialConflicts: RoundConflict[];
  initialItems: Expert[];
  initialTotal: number;
  initialExcludedCount: number;
  poolTotal: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(applicants.map((a) => a.id)));
  const [dae, setDae] = useState('');
  const [mid, setMid] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [conflicts, setConflicts] = useState(initialConflicts);
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [excludedCount, setExcludedCount] = useState(initialExcludedCount);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);
  const seq = useRef(0); // 경쟁 상태 방지 — 가장 최신 요청의 응답만 반영한다.

  const midOptions = categories.find((c) => c.dae === dae)?.mids ?? [];
  const selKey = useMemo(() => [...selected].sort().join(','), [selected]);

  async function fetchView(ids: string[], d: string, m: string, query: string, lim: number) {
    const myId = ++seq.current;
    setLoading(true);
    try {
      const r = await fetch('/api/rounds/candidates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          applicantIds: ids,
          dae: d || null,
          mid: m || null,
          q: query.trim() || null,
          limit: lim,
        }),
      });
      const j = (await r.json()) as {
        conflicts: RoundConflict[];
        items: Expert[];
        total: number;
        excludedCount: number;
      };
      if (myId !== seq.current) return; // 더 최신 요청이 떴으면 이 응답은 버린다(stale 방지)
      setConflicts(j.conflicts ?? []);
      setItems(j.items ?? []);
      setTotal(j.total ?? 0);
      setExcludedCount(j.excludedCount ?? 0);
    } finally {
      if (myId === seq.current) setLoading(false);
    }
  }

  // 지원자 선택·분야·검색 변경 시 재계산(검색은 디바운스). 최초 마운트는 서버 초기값 사용.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      setLimit(PAGE);
      void fetchView([...selected], dae, mid, q, PAGE);
    }, 250);
    return () => clearTimeout(t);
  }, [selKey, dae, mid, q]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleApplicant(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function loadMore() {
    const next = limit + PAGE;
    setLimit(next);
    void fetchView([...selected], dae, mid, q, next);
  }

  const selectedIds = [...selected];
  const canExport = selectedIds.length > 0;
  const exportBase =
    `/api/rounds/export?round=${encodeURIComponent(round)}` +
    `&applicantIds=${encodeURIComponent(selectedIds.join(','))}` +
    (dae ? `&dae=${encodeURIComponent(dae)}` : '') +
    (mid ? `&mid=${encodeURIComponent(mid)}` : '');

  return (
    <div className="space-y-5">
      {/* ── 대조할 지원자(서류 합격자) 선택 ── */}
      <section className="seed-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-stroke bg-bg-layer px-4 py-2.5">
          <span className="h-4 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
          <span className="text-sm font-semibold text-fg">대조할 지원자</span>
          <span className="text-xs text-fg-subtle">
            선택 {selected.size} / 총 {applicants.length}명
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSelected(new Set(applicants.map((a) => a.id)))}
              className="seed-btn-ghost px-2.5 py-1 text-xs"
            >
              모두 선택
            </button>
            <span className="text-xs text-fg-subtle">·</span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="seed-btn-ghost px-2.5 py-1 text-xs"
            >
              해제
            </button>
          </div>
        </div>
        <ul className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto p-3">
          {applicants.map((a) => {
            const active = selected.has(a.id);
            return (
              <li key={a.id}>
                <label
                  className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
                    active
                      ? 'border-accent/40 bg-accent-subtle text-fg'
                      : 'border-stroke bg-bg text-fg-muted hover:bg-bg-layer'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleApplicant(a.id)}
                    className="size-3.5 shrink-0 accent-accent"
                  />
                  <span className="whitespace-nowrap">{a.name}</span>
                  {a.jobStatus && a.jobStatus !== 'done' && (
                    <span className="text-[11px] text-warning">({a.jobStatus})</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── 결과 2단: 제척 대상 / 섭외 가능 ── */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        {/* 제척 대상 */}
        <section className="seed-card overflow-hidden">
          <header className="flex flex-wrap items-center gap-2 border-b border-stroke bg-bg-layer/60 px-4 py-2.5 text-sm">
            <span className="h-4 w-1 shrink-0 rounded-full bg-danger" aria-hidden />
            <span className="font-semibold text-fg">제척 대상</span>
            <span className="text-fg-subtle">
              풀 {poolTotal.toLocaleString()}명 중 {excludedCount}명 제외
              {conflicts.some((c) => c.confidence === 'low') &&
                ` · 확인 필요 ${conflicts.filter((c) => c.confidence === 'low').length}`}
            </span>
            {canExport && (
              <a
                href={`${exportBase}&format=csv&type=excluded`}
                className="seed-btn-neutral ml-auto px-2 py-0.5 text-xs no-underline"
              >
                CSV
              </a>
            )}
          </header>
          {conflicts.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-fg-muted">
              {loading ? '계산 중…' : '선택한 지원자와 이름이 일치하는 전문가가 없습니다 — 제척 대상 없음.'}
            </p>
          ) : (
            <ul className="max-h-[34rem] divide-y divide-stroke overflow-y-auto">
              {conflicts.map((c) => (
                <ConflictRow key={c.expert.id} c={c} />
              ))}
            </ul>
          )}
          <p className="border-t border-stroke px-4 py-2 text-[11px] text-fg-subtle">
            이름 일치 기준이라 동명이인('확인 필요')일 수 있으니 근거 문서로 최종 확인하세요. 제척은
            사람이 확정합니다.
          </p>
        </section>

        {/* 섭외 가능 전문가 */}
        <section className="seed-card overflow-hidden">
          <header className="flex flex-wrap items-center gap-2 border-b border-stroke bg-bg-layer/60 px-4 py-2.5 text-sm">
            <span className="h-4 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
            <span className="font-semibold text-fg">섭외 가능 전문가</span>
            <span className="text-fg-subtle">제척 제외 {total.toLocaleString()}명</span>
            {canExport && (
              <span className="ml-auto flex items-center gap-1.5">
                <a
                  href={`${exportBase}&format=csv&type=candidates`}
                  className="seed-btn-neutral px-2 py-0.5 text-xs no-underline"
                >
                  CSV
                </a>
                <a
                  href={`${exportBase}&format=xlsx`}
                  className="seed-btn-primary px-2.5 py-0.5 text-xs no-underline"
                  title="섭외 가능 + 제척 대상(사유) 2시트"
                >
                  ⬇ 엑셀
                </a>
              </span>
            )}
          </header>

          <div className="flex flex-wrap gap-2 border-b border-stroke p-3">
            <select
              className="seed-input"
              value={dae}
              onChange={(e) => {
                setDae(e.target.value);
                setMid('');
              }}
              aria-label="대분류"
            >
              <option value="">전체 분야</option>
              {categories.map((c) => (
                <option key={c.dae} value={c.dae}>
                  {c.dae}
                </option>
              ))}
            </select>
            <select
              className="seed-input"
              value={mid}
              onChange={(e) => setMid(e.target.value)}
              disabled={!dae}
              aria-label="중분류"
            >
              <option value="">중분류 전체</option>
              {midOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              type="search"
              className="seed-input min-w-0 flex-1"
              placeholder="이름·소속·분야 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="전문가 검색"
            />
          </div>

          <ul className="max-h-[30rem] divide-y divide-stroke overflow-y-auto">
            {items.length === 0 ? (
              <li className="py-8 text-center text-sm text-fg-muted">
                {loading ? '검색 중…' : '조건에 맞는 섭외 가능 전문가가 없습니다.'}
              </li>
            ) : (
              items.map((e) => {
                const fields = fieldsShort(e);
                return (
                  <li key={e.id} className="flex items-center gap-2.5 px-3 py-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-layer text-xs font-bold text-fg-muted">
                      {avatarChar(e.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">
                        {e.name}
                        {e.position && (
                          <span className="ml-1.5 text-xs font-normal text-fg-subtle">{e.position}</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-fg-muted">{e.affiliation ?? '소속 미상'}</p>
                      {fields && <p className="truncate text-xs text-info">{fields}</p>}
                    </div>
                    {e.email && <span className="shrink-0 text-xs text-fg-subtle">{e.email}</span>}
                  </li>
                );
              })
            )}
          </ul>
          {items.length < total && (
            <button
              type="button"
              className="seed-btn-neutral m-3 w-[calc(100%-1.5rem)] py-1.5 text-xs"
              onClick={loadMore}
              disabled={loading}
            >
              더 보기 ({(total - items.length).toLocaleString()}명 남음)
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

/** 제척 전문가 한 행 — 클릭하면 지원자별 사유(매칭 이름·유형·근거)를 펼친다. */
function ConflictRow({ c }: { c: RoundConflict }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors hover:bg-bg-layer/50"
        aria-expanded={open}
      >
        <svg
          aria-hidden
          className={`mt-1 h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform ${open ? 'rotate-90' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-fg">
            {c.expert.name}
            {c.confidence === 'low' ? (
              <span className="seed-badge-warning" title="동명이인 가능 — 직접 대조 필요">
                확인 필요{c.homonymCount > 1 ? ` (동명이인 ${c.homonymCount})` : ''}
              </span>
            ) : (
              <span className="seed-badge-danger">제척</span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-fg-muted">
            {[c.expert.affiliation, c.expert.position].filter(Boolean).join(' · ') || '소속 미상'}
          </span>
          <span className="mt-0.5 block text-xs text-fg-subtle">
            충돌 지원자 {c.byApplicant.length}명: {c.byApplicant.map((a) => a.applicantName).join(', ')}
          </span>
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-stroke bg-bg-layer/30 px-4 py-2.5">
          {c.byApplicant.map((a) => (
            <div key={a.applicantId} className="text-xs">
              <p className="flex flex-wrap items-center gap-1.5 font-medium text-fg">
                {a.applicantName}
                {a.coiTypes.map((t) => (
                  <span key={t.code} className="seed-badge-danger" title="제척 유형">
                    {t.label}
                  </span>
                ))}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-fg-subtle">
                <span>
                  관계자 일치 <span className="font-medium text-fg">{a.matchedNames.join(', ')}</span>
                </span>
                {a.sources.map((s, i) => (
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
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
