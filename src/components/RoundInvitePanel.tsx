'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CheckboxFilterList } from '@/components/CheckboxFilterList';
import { DOC_TYPE_LABELS_KO, ROLE_LABELS_KO } from '@/lib/domain';
import type { Expert, RoundPool } from '@/db/schema';
import type { RoundApplicant, RoundConflict } from '@/lib/rounds';

/**
 * 회차 통합 제척·섭외 패널 (ERP 2단: 좌 컨트롤 / 우 결과).
 * 좌측 사이드바: ① 이 회차 면접 감독관 명단(업로드/교체·전역 풀 폴백) ② 대조할 지원자(서류 합격자)
 * 체크박스. 우측: 제척 종합 + 섭외 가능 전문가. 선택·분야·검색 변경 시 서버에서 다시 계산한다.
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

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const s = typeof d === 'string' ? d : d.toISOString();
  return s.slice(0, 10);
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
  poolSource,
  poolMeta,
}: {
  round: string;
  applicants: RoundApplicant[];
  categories: Category[];
  initialConflicts: RoundConflict[];
  initialItems: Expert[];
  initialTotal: number;
  initialExcludedCount: number;
  poolTotal: number;
  poolSource: 'round' | 'global';
  poolMeta: RoundPool | null;
}) {
  const router = useRouter();
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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // 골라 담은 면접위원(id→Expert) — 필터·페이지가 바뀌어도 선택은 유지된다.
  const [picked, setPicked] = useState<Map<string, Expert>>(new Map());
  const first = useRef(true);
  const seq = useRef(0); // 경쟁 상태 방지 — 가장 최신 요청의 응답만 반영.
  const fileRef = useRef<HTMLInputElement>(null);

  const midOptions = categories.find((c) => c.dae === dae)?.mids ?? [];
  const selKey = useMemo(() => [...selected].sort().join(','), [selected]);
  const noSelection = selected.size === 0;

  async function fetchView(ids: string[], d: string, m: string, query: string, lim: number) {
    const myId = ++seq.current;
    setLoading(true);
    try {
      const r = await fetch('/api/rounds/candidates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          round,
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
      if (myId !== seq.current) return;
      setConflicts(j.conflicts ?? []);
      setItems(j.items ?? []);
      setTotal(j.total ?? 0);
      setExcludedCount(j.excludedCount ?? 0);
    } finally {
      if (myId === seq.current) setLoading(false);
    }
  }

  // 지원자 선택·분야·검색 변경 시 재계산(검색 디바운스). 최초 마운트는 서버 초기값 사용.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (selected.size === 0) {
      // 대조할 지원자가 없으면 계산하지 않는다 — 빈 선택을 '풀 전체가 섭외 가능'으로 오해시키지 않도록.
      seq.current++; // 진행 중이던 응답 무효화
      setConflicts([]);
      setItems([]);
      setTotal(0);
      setExcludedCount(0);
      setLoading(false);
      return;
    }
    const t = setTimeout(() => {
      setLimit(PAGE);
      void fetchView([...selected], dae, mid, q, PAGE);
    }, 250);
    return () => clearTimeout(t);
  }, [selKey, dae, mid, q]); // eslint-disable-line react-hooks/exhaustive-deps

  // 회차 명단 교체로 분야 분류가 바뀌면, 선택돼 있던 대/중분류가 새 명단에 없을 수 있다 — 그대로 두면
  // 섭외 가능 목록이 조용히 0건이 된다. 없는 분야면 선택을 초기화한다(stale 필터 방지).
  useEffect(() => {
    if (dae && !categories.some((c) => c.dae === dae)) {
      setDae('');
      setMid('');
    } else if (mid && !midOptions.includes(mid)) {
      setMid('');
    }
  }, [categories]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function togglePick(e: Expert) {
    setPicked((prev) => {
      const n = new Map(prev);
      n.has(e.id) ? n.delete(e.id) : n.set(e.id, e);
      return n;
    });
  }
  function pickVisible() {
    setPicked((prev) => {
      const n = new Map(prev);
      for (const e of items) n.set(e.id, e);
      return n;
    });
  }

  // 골라 담은 면접위원만 내보내기 — expertIds를 서버로 POST해 xlsx/csv를 받아 다운로드한다.
  async function exportSelected(format: 'xlsx' | 'csv') {
    const ids = [...picked.keys()];
    if (ids.length === 0) return;
    const r = await fetch('/api/rounds/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ round, expertIds: ids, format }),
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${round === 'none' ? '미상' : round}_선택면접위원.${format === 'csv' ? 'csv' : 'xlsx'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // 회차 명단 업로드 → 서버 재계산(새 풀 메타 props) + 현재 선택 기준 재조회.
  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(`/api/rounds/${encodeURIComponent(round)}/pool`, {
        method: 'POST',
        body: fd,
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setUploadError(j.error ?? '업로드에 실패했습니다.');
        return;
      }
      router.refresh();
      await fetchView([...selected], dae, mid, q, PAGE);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onClearPool() {
    if (!window.confirm('이 회차 전용 명단을 삭제하고 전역 전문가 풀로 되돌릴까요?')) return;
    setUploading(true);
    setUploadError(null);
    try {
      await fetch(`/api/rounds/${encodeURIComponent(round)}/pool`, { method: 'DELETE' });
      router.refresh();
      await fetchView([...selected], dae, mid, q, PAGE);
    } finally {
      setUploading(false);
    }
  }

  const selectedIds = [...selected];
  const canExport = selectedIds.length > 0;
  const exportBase =
    `/api/rounds/export?round=${encodeURIComponent(round)}` +
    `&applicantIds=${encodeURIComponent(selectedIds.join(','))}` +
    (dae ? `&dae=${encodeURIComponent(dae)}` : '') +
    (mid ? `&mid=${encodeURIComponent(mid)}` : '');

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* ── 좌측 컨트롤 사이드바 ── */}
      <aside className="space-y-4 lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto">
        {/* 면접 감독관 명단(이 회차 풀) */}
        <div className="seed-card p-4">
          <h2 className="ms-eyebrow">면접 감독관 명단</h2>
          {poolSource === 'round' && poolMeta ? (
            <p className="mt-1 text-xs text-fg-muted">
              <span className="font-semibold text-fg">이 회차 전용 명단 {poolMeta.count.toLocaleString()}명</span>
              <br />
              {poolMeta.filename && <span className="break-all">{poolMeta.filename}</span>}
              {poolMeta.uploadedAt && (
                <span className="block text-fg-subtle">적재 {fmtDate(poolMeta.uploadedAt)}</span>
              )}
            </p>
          ) : (
            <p className="mt-1 text-xs text-fg-muted">
              전역 전문가 풀 {poolTotal.toLocaleString()}명 기준
              <span className="block text-fg-subtle">이 회차 전용 명단이 없습니다.</span>
            </p>
          )}

          <label className="seed-btn-neutral mt-2 w-full cursor-pointer justify-center py-1.5 text-xs">
            {uploading ? '처리 중…' : poolSource === 'round' ? '명단 교체(xlsx)' : '명단 업로드(xlsx)'}
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              onChange={onUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
          <a
            href="/api/expert-template"
            className="mt-1 block text-center text-[11px] text-accent underline-offset-2 hover:underline"
          >
            ⬇ 예시 양식(xlsx) 받기 — 채워서 업로드
          </a>
          {poolSource === 'round' && (
            <button
              type="button"
              onClick={onClearPool}
              disabled={uploading}
              className="seed-btn-ghost mt-1 w-full py-1 text-xs text-fg-subtle"
            >
              전역 풀로 되돌리기
            </button>
          )}
          {uploadError && <p className="mt-1.5 text-xs text-danger">{uploadError}</p>}
          <p className="mt-2 text-[11px] text-fg-subtle">
            전문가 풀과 같은 xlsx 포맷(ID·성명·소속기관·분류체계…). 업로드하면 이 회차는 그 명단으로
            대조합니다.
          </p>
        </div>

        {/* 대조할 지원자(서류 합격자) — 다른 화면과 동일한 재사용 체크박스 필터 컴포넌트 */}
        <CheckboxFilterList
          title="대조할 지원자"
          items={applicants.map((a) => ({
            id: a.id,
            label: a.name,
            note: a.jobStatus && a.jobStatus !== 'done' ? a.jobStatus : undefined,
          }))}
          selected={selected}
          onToggle={toggleApplicant}
          onSelectAll={() => setSelected(new Set(applicants.map((a) => a.id)))}
          onClear={() => setSelected(new Set())}
        />
      </aside>

      {/* ── 우측 결과 ── */}
      <div className="min-w-0 space-y-5">
        {/* 회차 요약 — 자료 모아두기용 핵심 수치 (조인트 스탯 타일) */}
        <section className="space-y-1.5">
          <p className="ms-eyebrow">회차 현황</p>
          <div className="seed-card grid grid-cols-2 sm:grid-cols-4">
            <div className="border-r border-stroke px-4 py-3">
              <p className="ms-eyebrow">대조 지원자</p>
              <p className="mt-0.5 text-2xl font-semibold text-fg">
                {selected.size}
                <span className="text-sm font-normal text-fg-subtle">/{applicants.length}</span>
              </p>
            </div>
            <div className="px-4 py-3 sm:border-r sm:border-stroke">
              <p className="ms-eyebrow">제척</p>
              <p className="mt-0.5 text-2xl font-semibold text-danger">{excludedCount}</p>
            </div>
            <div className="border-r border-t border-stroke px-4 py-3 sm:border-t-0">
              <p className="ms-eyebrow">섭외 가능</p>
              <p className="mt-0.5 text-2xl font-semibold text-accent">{total.toLocaleString()}</p>
            </div>
            <div className="border-t border-stroke px-4 py-3 sm:border-t-0">
              <p className="ms-eyebrow">명단 · {poolSource === 'round' ? '이 회차 전용' : '전역 풀'}</p>
              <p className="mt-0.5 text-2xl font-semibold text-fg">
                {poolTotal.toLocaleString()}
                <span className="text-sm font-normal text-fg-subtle">명</span>
              </p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 items-start gap-5 2xl:grid-cols-2">
          {/* 제척 대상 */}
          <section className="seed-card overflow-hidden">
            <header className="flex flex-wrap items-center gap-2 border-b border-stroke bg-bg-elevated/60 px-4 py-2.5 text-sm">
              <span className="h-4 w-1 shrink-0 rounded-full bg-danger" aria-hidden />
              <span className="font-semibold text-fg">제척 대상</span>
              <span className="text-fg-subtle">
                {excludedCount}명 제외
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
                {noSelection
                  ? '왼쪽에서 대조할 지원자를 선택하세요.'
                  : loading
                    ? '계산 중…'
                    : '선택한 지원자와 이름이 일치하는 전문가가 없습니다 — 제척 대상 없음.'}
              </p>
            ) : (
              <ul className="max-h-[32rem] divide-y divide-stroke overflow-y-auto">
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
            <header className="flex flex-wrap items-center gap-2 border-b border-stroke bg-bg-elevated/60 px-4 py-2.5 text-sm">
              <span className="h-4 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
              <span className="font-semibold text-fg">섭외 가능 전문가</span>
              <span className="text-fg-subtle">
                제척 제외 {total.toLocaleString()}명{picked.size > 0 ? ` · 선택 ${picked.size}` : ''}
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                {picked.size > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => exportSelected('csv')}
                      className="seed-btn-neutral px-2 py-0.5 text-xs"
                    >
                      선택 CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => exportSelected('xlsx')}
                      className="seed-btn-primary px-2.5 py-0.5 text-xs"
                      title="선택한 면접위원만 엑셀로"
                    >
                      ⬇ 선택 엑셀 ({picked.size})
                    </button>
                  </>
                ) : (
                  canExport && (
                    <>
                      <a
                        href={`${exportBase}&format=csv&type=candidates`}
                        className="seed-btn-neutral px-2 py-0.5 text-xs no-underline"
                        title="섭외 가능 전문가 전체 CSV"
                      >
                        전체 CSV
                      </a>
                      <a
                        href={`${exportBase}&format=xlsx`}
                        className="seed-btn-neutral px-2.5 py-0.5 text-xs no-underline"
                        title="섭외 가능 + 제척 대상(사유) 2시트"
                      >
                        전체 엑셀
                      </a>
                    </>
                  )
                )}
              </span>
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

            <div className="flex items-center justify-between gap-2 border-b border-stroke bg-bg-elevated/30 px-3 py-1.5 text-xs">
              <span className="text-fg-subtle">
                {picked.size > 0
                  ? `${picked.size}명 선택됨 — 선택 엑셀로 내보내기`
                  : '체크해서 면접위원을 골라 담으세요'}
              </span>
              <span className="flex items-center gap-1.5">
                <button type="button" onClick={pickVisible} className="text-accent hover:underline">
                  보이는 목록 담기
                </button>
                {picked.size > 0 && (
                  <>
                    <span className="text-fg-subtle">·</span>
                    <button
                      type="button"
                      onClick={() => setPicked(new Map())}
                      className="text-fg-muted hover:underline"
                    >
                      선택 해제
                    </button>
                  </>
                )}
              </span>
            </div>

            <ul className="max-h-[30rem] divide-y divide-stroke overflow-y-auto">
              {items.length === 0 ? (
                <li className="py-8 text-center text-sm text-fg-muted">
                  {noSelection
                    ? '왼쪽에서 대조할 지원자를 선택하세요.'
                    : loading
                      ? '검색 중…'
                      : '조건에 맞는 섭외 가능 전문가가 없습니다.'}
                </li>
              ) : (
                items.map((e) => {
                  const fields = fieldsShort(e);
                  const isPicked = picked.has(e.id);
                  return (
                    <li key={e.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors hover:bg-bg-elevated ${
                          isPicked ? 'bg-accent-subtle/40' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isPicked}
                          onChange={() => togglePick(e)}
                          className="size-4 shrink-0 accent-accent"
                        />
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-elevated text-xs font-bold text-fg-muted">
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
                      </label>
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
        className="flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors hover:bg-bg-elevated"
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
        <div className="space-y-2 border-t border-stroke bg-bg-elevated/30 px-4 py-2.5">
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
