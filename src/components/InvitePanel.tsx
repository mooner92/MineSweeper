'use client';

import { useEffect, useRef, useState } from 'react';
import type { Expert, Invitation } from '@/db/schema';
import type { ExpertField } from '@/lib/domain';

interface Category {
  dae: string;
  mids: string[];
}

/**
 * 분야 요약 — `대 > 중 (세부1, 세부2…)` 형태로 보여 왜 매칭됐는지 드러낸다. 분야 필터(dae/mid)가
 * 있으면 **그 필터에 맞는 분야를 우선** 표시한다(예: 물국토>물관리 필터 중인데 첫 분야가 기후대기여서
 * 헷갈리는 문제 해결). short=행 표시용(첫 그룹 + 외 N), full=hover 전체.
 */
function fieldSummary(
  fields: ExpertField[],
  dae?: string,
  mid?: string,
): { short: string; full: string } {
  if (fields.length === 0) return { short: '', full: '' };
  // 필터에 맞는 분야 우선(없으면 전체).
  const matched = dae
    ? fields.filter((f) => f.dae === dae && (!mid || f.mid === mid))
    : [];
  const relevant = matched.length > 0 ? matched : fields;

  // 대 > 중 별로 세부분야(없으면 소분류)를 모은다.
  const groups = new Map<string, Set<string>>();
  for (const f of relevant) {
    const key = [f.dae, f.mid].filter(Boolean).join(' > ');
    if (!groups.has(key)) groups.set(key, new Set());
    const leaf = f.det || f.sub;
    if (leaf) groups.get(key)!.add(leaf);
  }
  const render = ([key, leaves]: [string, Set<string>]) => {
    const list = [...leaves];
    if (list.length === 0) return key;
    const shown = list.slice(0, 4).join(', ');
    return `${key} (${shown}${list.length > 4 ? ` 외 ${list.length - 4}` : ''})`;
  };
  const entries = [...groups];
  const full = entries.map(render).join(' · ');
  const first = entries[0] ? render(entries[0]) : '';
  const extraGroups = entries.length - 1;
  const short = extraGroups > 0 ? `${first} · 외 ${extraGroups}분야` : first;
  return { short, full };
}

const avatarChar = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

/** 후보 목록 1회 표시/증가 단위. '더 보기'로 누적해 전체까지 볼 수 있다. */
const PAGE = 60;

/**
 * 면접위원 초빙(섭외) 워크플로 — 전문가 풀에서 후보를 분야/검색으로 좁혀 골라 담고, 담은 명단을
 * 엑셀로 내보낸다. 제척 대상·이미 담은 인원은 후보에서 제외된다. 명단은 DB에 영속(스냅샷)된다.
 */
export function InvitePanel({
  applicantId,
  categories,
  initialDae,
  initialMid,
  initialCandidates,
  initialTotal,
  initialInvitations,
}: {
  applicantId: string;
  categories: Category[];
  initialDae: string;
  initialMid: string;
  initialCandidates: Expert[];
  initialTotal: number;
  initialInvitations: Invitation[];
}) {
  const [dae, setDae] = useState(initialDae);
  const [mid, setMid] = useState(initialMid);
  const [q, setQ] = useState('');
  const [candidates, setCandidates] = useState<Expert[]>(initialCandidates);
  const [total, setTotal] = useState(initialTotal);
  const [limit, setLimit] = useState(PAGE);
  const [invitations, setInvitations] = useState<Invitation[]>(initialInvitations);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  // 최초 마운트에는 서버가 준 initial 데이터를 그대로 쓰고, 이후 필터 변경 때만 다시 불러온다.
  const first = useRef(true);

  const midOptions = categories.find((c) => c.dae === dae)?.mids ?? [];

  async function fetchCandidates(d: string, m: string, query: string, lim: number) {
    setLoading(true);
    try {
      const p = new URLSearchParams({ applicantId, limit: String(lim) });
      if (d) p.set('dae', d);
      if (m) p.set('mid', m);
      if (query.trim()) p.set('q', query.trim());
      const r = await fetch(`/api/invite/candidates?${p}`);
      const j = (await r.json()) as { items: Expert[]; total: number };
      setCandidates(j.items ?? []);
      setTotal(j.total ?? 0);
    } finally {
      setLoading(false);
    }
  }

  // 필터(dae/mid/q) 변경 시 표시 개수를 초기화하고 후보 재조회 — q는 디바운스.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      setLimit(PAGE);
      void fetchCandidates(dae, mid, q, PAGE);
    }, 250);
    return () => clearTimeout(t);
  }, [dae, mid, q]); // eslint-disable-line react-hooks/exhaustive-deps

  function loadMore() {
    const next = limit + PAGE;
    setLimit(next);
    void fetchCandidates(dae, mid, q, next);
  }

  function persistField(d: string, m: string) {
    void fetch('/api/invite/field', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ applicantId, dae: d || null, mid: m || null }),
    });
  }

  function onDae(d: string) {
    setDae(d);
    setMid('');
    persistField(d, '');
  }
  function onMid(m: string) {
    setMid(m);
    persistField(dae, m);
  }

  async function add(expert: Expert) {
    setPending(expert.id);
    try {
      const r = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ applicantId, expertId: expert.id }),
      });
      const j = (await r.json()) as { invitations: Invitation[] };
      setInvitations(j.invitations ?? []);
      setCandidates((cs) => cs.filter((c) => c.id !== expert.id)); // 담은 후보는 목록에서 제거
      setTotal((t) => Math.max(0, t - 1));
    } finally {
      setPending(null);
    }
  }

  async function remove(inv: Invitation) {
    setPending(inv.expertId);
    try {
      const r = await fetch('/api/invite', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ applicantId, expertId: inv.expertId }),
      });
      const j = (await r.json()) as { invitations: Invitation[] };
      setInvitations(j.invitations ?? []);
      void fetchCandidates(dae, mid, q, limit); // 뺀 인원이 후보로 다시 보이도록
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="seed-card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stroke bg-bg-layer/60 px-4 py-2.5 text-sm">
        <span className="font-semibold text-fg">
          면접위원 초빙 <span className="font-normal text-fg-subtle">— 풀에서 골라 담기</span>
        </span>
        <span className="text-fg-subtle">담은 인원 {invitations.length}명</span>
      </header>

      <div className="grid gap-px bg-stroke md:grid-cols-2">
        {/* 좌: 후보 검색·선택 */}
        <div className="bg-bg p-4">
          <div className="flex flex-wrap gap-2">
            <select
              className="seed-input"
              value={dae}
              onChange={(e) => onDae(e.target.value)}
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
              onChange={(e) => onMid(e.target.value)}
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
              aria-label="후보 검색"
            />
          </div>

          <p className="mt-2 text-xs text-fg-subtle">
            후보 <span className="font-semibold text-fg-muted">{total.toLocaleString()}</span>명 중{' '}
            {Math.min(candidates.length, total).toLocaleString()}명 표시
            {loading && ' · 불러오는 중…'}
            <span className="ml-1">— 제척·기담음 제외</span>
          </p>

          <ul className="mt-2 max-h-[28rem] divide-y divide-stroke overflow-auto">
            {candidates.length === 0 ? (
              <li className="py-8 text-center text-sm text-fg-muted">
                {loading ? '검색 중…' : '조건에 맞는 후보가 없습니다.'}
              </li>
            ) : (
              candidates.map((e) => {
                const fields = fieldSummary(e.fields, dae, mid);
                return (
                  <li key={e.id} className="flex items-center gap-2.5 py-2">
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
                      <p className="truncate text-xs text-fg-muted" title={e.affiliation ?? undefined}>
                        {e.affiliation ?? '소속 미상'}
                      </p>
                      {fields.short && (
                        <p className="truncate text-xs text-info" title={fields.full}>
                          {fields.short}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="seed-btn-neutral shrink-0 px-2.5 py-1 text-xs"
                      onClick={() => void add(e)}
                      disabled={pending === e.id}
                    >
                      담기
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {candidates.length < total && (
            <button
              type="button"
              className="seed-btn-neutral mt-2 w-full py-1.5 text-xs"
              onClick={loadMore}
              disabled={loading}
            >
              더 보기 ({(total - candidates.length).toLocaleString()}명 남음)
            </button>
          )}
        </div>

        {/* 우: 담은 초빙 명단 */}
        <div className="bg-bg p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-fg">초빙 명단 {invitations.length}명</p>
            <a
              href={`/api/invite/export?applicantId=${applicantId}`}
              className={`seed-btn-primary px-2.5 py-1 text-xs no-underline ${invitations.length === 0 ? 'pointer-events-none opacity-50' : ''}`}
              aria-disabled={invitations.length === 0}
            >
              ⬇ 엑셀 내보내기
            </a>
          </div>

          <ul className="mt-2 max-h-[28rem] divide-y divide-stroke overflow-auto">
            {invitations.length === 0 ? (
              <li className="py-8 text-center text-sm text-fg-muted">
                왼쪽에서 후보를 골라 담으세요. 담은 명단은 저장되어 다시 와도 유지됩니다.
              </li>
            ) : (
              invitations.map((inv) => {
                const fields = fieldSummary(inv.fields);
                return (
                <li key={inv.id} className="flex items-center gap-2.5 py-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-xs font-bold text-accent">
                    {avatarChar(inv.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">
                      {inv.name}
                      {inv.position && (
                        <span className="ml-1.5 text-xs font-normal text-fg-subtle">{inv.position}</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-fg-muted" title={inv.affiliation ?? undefined}>
                      {inv.affiliation ?? '소속 미상'}
                      {inv.email && ` · ${inv.email}`}
                    </p>
                    {fields.short && (
                      <p className="truncate text-xs text-info" title={fields.full}>
                        {fields.short}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="seed-btn-ghost shrink-0 px-2 py-1 text-xs text-danger"
                    onClick={() => void remove(inv)}
                    disabled={pending === inv.expertId}
                    title="명단에서 빼기"
                  >
                    빼기
                  </button>
                </li>
                );
              })
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}
