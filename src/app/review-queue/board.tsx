'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { DOC_TYPE_LABELS_KO, FLAG_TYPE_LABELS_KO, type FlagType } from '@/lib/domain';
import type { QueueItem } from '@/lib/data';

/**
 * 검토 필요 큐 — 당근마켓 스타일 좌측 필터 사이드바 + 결과 그리드.
 *
 * 기존엔 상단 가로 칩 한 줄로 '유형'만 걸렀는데, 항목이 많아지면 어느 지원자의
 * 무슨 유형인지 한눈에 좁히기 어려웠다. 좌측에 '유형 / 지원자' 다중 선택 필터를
 * sticky로 두어(스크롤을 따라다님) 즉시(클라이언트) 좁혀 볼 수 있게 한다.
 *
 * 필터 규칙: 같은 그룹 안에서는 OR, 그룹 사이에서는 AND (일반적인 패싯 검색).
 * 선택이 없으면 그 그룹은 제약 없음(= 전체).
 */
export function ReviewQueueBoard({ items }: { items: QueueItem[] }) {
  const [flagSel, setFlagSel] = useState<Set<string>>(new Set());
  const [appSel, setAppSel] = useState<Set<string>>(new Set());

  // 전체(미필터) 기준 카운트 — 필터를 걸어도 각 옵션의 모집단 크기는 고정으로 보여 준다.
  const flagFacets = useMemo(() => facetCounts(items, (it) => it.flag.flagType), [items]);
  const appFacets = useMemo(
    () =>
      facetCounts(
        items,
        (it) => it.applicantId,
        (it) => it.applicantName ?? it.applicantId,
      ),
    [items],
  );

  const filtered = useMemo(
    () =>
      items.filter(
        (it) =>
          (flagSel.size === 0 || flagSel.has(it.flag.flagType)) &&
          (appSel.size === 0 || appSel.has(it.applicantId)),
      ),
    [items, flagSel, appSel],
  );

  const hasFilter = flagSel.size > 0 || appSel.size > 0;
  const reset = () => {
    setFlagSel(new Set());
    setAppSel(new Set());
  };

  // CSV 내보내기 API는 단일 flag 파라미터만 받는다 — 유형을 정확히 하나 골랐을 때만 좁혀 내보내고,
  // 그 외(다중·없음)에는 전체를 내보낸다(지원자 필터는 내보내기에 반영되지 않음).
  const exportHref =
    flagSel.size === 1
      ? `/api/review-queue/export?flag=${encodeURIComponent([...flagSel][0])}`
      : '/api/review-queue/export';

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <nav aria-label="breadcrumb" className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Link href="/" className="hover:text-fg transition-colors">지원자 목록</Link>
            <span aria-hidden className="text-stroke-strong">/</span>
            <span className="font-medium text-fg" aria-current="page">검토 필요 큐</span>
          </nav>
          <p className="ms-eyebrow">사람이 눈으로 봐야 하는 것</p>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">검토 필요 큐</h1>
            {filtered.length > 0 && <span className="seed-badge-warning">{filtered.length}건</span>}
          </div>
          <p className="text-sm text-fg-muted">
            도장·손글씨·판독난해 서명·비전 판독 필요 항목을 한 곳에 모았습니다.
          </p>
        </div>
        <a className="seed-btn-neutral no-underline" href={exportHref}>
          리스트 내보내기 (CSV)
        </a>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* 좌측 필터 — lg 이상에서 sticky로 스크롤을 따라다닌다. */}
        <aside className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:w-64 lg:shrink-0 lg:overflow-y-auto">
          <div className="seed-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">필터</h2>
              {hasFilter && (
                <button
                  type="button"
                  onClick={reset}
                  className="text-xs font-medium text-accent hover:underline underline-offset-2"
                >
                  초기화
                </button>
              )}
            </div>

            <FilterGroup
              title="유형"
              facets={flagFacets}
              selected={flagSel}
              onToggle={(v) => setFlagSel(toggle(flagSel, v))}
              labelOf={(key) => FLAG_TYPE_LABELS_KO[key as FlagType] ?? key}
            />

            <FilterGroup
              title="지원자"
              facets={appFacets}
              selected={appSel}
              onToggle={(v) => setAppSel(toggle(appSel, v))}
              scroll
            />
          </div>
        </aside>

        {/* 결과 */}
        <div className="min-w-0 flex-1">
          {filtered.length === 0 ? (
            <div className="seed-card p-10 text-center">
              <p className="text-base text-fg-muted">
                {hasFilter ? '선택한 필터에 해당하는 항목이 없습니다.' : '검토 대기 항목이 없습니다. 🎉'}
              </p>
              <p className="mt-1 text-sm text-fg-subtle">
                {hasFilter ? (
                  <button type="button" onClick={reset} className="text-accent hover:underline">
                    필터 초기화
                  </button>
                ) : (
                  '도장·서명·동명이인 항목이 생기면 여기에 모입니다.'
                )}
              </p>
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((it) => (
                <QueueCard key={it.flag.id} item={it} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

interface Facet {
  key: string;
  label: string;
  count: number;
}

/** key별 카운트 + 표시 라벨을 모아 카운트 내림차순으로 반환. */
function facetCounts(
  items: QueueItem[],
  keyOf: (it: QueueItem) => string,
  labelOf?: (it: QueueItem) => string,
): Facet[] {
  const map = new Map<string, Facet>();
  for (const it of items) {
    const key = keyOf(it);
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { key, label: labelOf ? labelOf(it) : key, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function FilterGroup({
  title,
  facets,
  selected,
  onToggle,
  labelOf,
  scroll,
}: {
  title: string;
  facets: Facet[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  labelOf?: (key: string) => string;
  scroll?: boolean;
}) {
  if (facets.length === 0) return null;
  return (
    <div className="mt-4 border-t border-stroke pt-3 first:mt-3">
      <p className="ms-eyebrow mb-2">{title}</p>
      <ul className={scroll ? 'max-h-64 space-y-0.5 overflow-y-auto pr-1' : 'space-y-0.5'}>
        {facets.map((f) => {
          const active = selected.has(f.key);
          return (
            <li key={f.key}>
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-seed px-2 py-1.5 text-sm transition-colors ${
                  active ? 'bg-accent-subtle text-fg' : 'text-fg-muted hover:bg-bg-elevated hover:text-fg'
                }`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => onToggle(f.key)}
                  className="size-3.5 shrink-0 accent-accent"
                />
                <span className="min-w-0 flex-1 truncate" title={labelOf ? labelOf(f.key) : f.label}>
                  {labelOf ? labelOf(f.key) : f.label}
                </span>
                <span className="shrink-0 text-xs text-fg-subtle">{f.count}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 큐 카드 한 장 — 동명이인(후보 비교)과 도장·서명·이미지(크롭 미리보기)를 분기 렌더. */
function QueueCard({ item: it }: { item: QueueItem }) {
  return (
    <li className="seed-card overflow-hidden transition-transform duration-150 hover:-translate-y-0.5">
      {it.flag.flagType === 'ambiguous' && it.candidates ? (
        // 동명이인/약어: 후보 이름별로 원문 파일·페이지 링크를 나열해 비교하게 한다.
        <div>
          {/* 헤더 바 — 이미지 카드와 동일한 패턴으로 통일(배지 위치 일관성) */}
          <div className="flex items-center justify-between gap-2 border-b border-stroke bg-bg-elevated px-3 py-2">
            <span className="seed-badge-warning">{FLAG_TYPE_LABELS_KO.ambiguous}</span>
            <span className="text-xs font-medium text-fg-muted">
              {it.applicantName ? (
                <Link href={`/applicants/${it.applicantId}`} className="hover:underline underline-offset-2">
                  {it.applicantName}
                </Link>
              ) : (
                it.applicantId
              )}
            </span>
          </div>
          <div className="space-y-2 p-3">
            <p className="text-xs text-fg-muted">
              같은 사람인지 다른 사람인지 — 아래 원문 페이지를 열어 비교하세요.
            </p>
            <ul className="space-y-2">
              {it.candidates.map((c) => (
                <li key={c.name} className="rounded-seed border border-stroke p-2">
                  <p className="text-sm font-semibold">{c.name}</p>
                  {c.sources.length === 0 ? (
                    <p className="text-xs text-fg-subtle">출처 없음</p>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {c.sources.map((s, i) => (
                        <a
                          key={`${s.documentId}-${s.page}-${i}`}
                          href={`/api/file/${s.documentId}#page=${s.page}`}
                          target="_blank"
                          rel="noreferrer"
                          title={`${s.filename} · 클릭하면 원문 ${s.page}쪽`}
                          className="block no-underline text-info hover:text-info/80 hover:underline underline-offset-2"
                        >
                          {s.sourceFormat === 'pdf' || s.sourceFormat === 'image' ? (
                            // 해당 이름이 나온 페이지 썸네일(온디맨드 렌더·캐시). 클릭=원문 페이지.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`/api/page/${s.documentId}?page=${s.page}`}
                              alt={`${DOC_TYPE_LABELS_KO[s.docType]} p.${s.page}`}
                              loading="lazy"
                              className="h-40 w-auto rounded-seed border border-stroke bg-bg object-contain"
                            />
                          ) : (
                            // HWP 등 렌더 불가 포맷 — 깨진 이미지 대신 깔끔한 타일(원문 열기).
                            <div className="flex h-40 w-28 flex-col items-center justify-center gap-1 rounded-seed border border-stroke bg-bg-elevated p-2 text-center">
                              <span className="text-2xl">📄</span>
                              <span className="text-xs font-semibold uppercase text-fg-muted">
                                {s.sourceFormat}
                              </span>
                              {s.filename && (
                                <span className="line-clamp-2 break-all text-xs text-fg-subtle">
                                  {s.filename}
                                </span>
                              )}
                              <span className="text-xs font-medium text-info">원문 보기</span>
                            </div>
                          )}
                          <span className="mt-0.5 block text-center text-xs text-fg-muted">
                            {DOC_TYPE_LABELS_KO[s.docType]} p.{s.page}
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <>
          {/* 보여 줄 이미지가 있을 때만 4:3 리세스를 잡는다 — 없으면 빈 상자가 갤러리를 지배한다. */}
          {it.flag.cropPath || (it.documentId && it.sourceFormat === 'image') ? (
            <div className="relative aspect-[4/3] border-b border-stroke bg-bg-layer">
              {/* 플래그 유형 배지 — 이미지 위 절대 위치, 갤러리 스캔 시 유형 먼저 인식 */}
              <span className="absolute left-2 top-2 z-10 seed-badge-warning">
                {FLAG_TYPE_LABELS_KO[it.flag.flagType]}
              </span>
              {it.flag.cropPath ? (
                // Detected seal/signature region — show the crop directly (human eyeballs it).
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/crop/${it.flag.id}`}
                  alt="detected region"
                  className="h-full w-full object-contain"
                />
              ) : (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/file/${it.documentId}`}
                    alt={it.filename ?? ''}
                    className="h-full w-full object-contain"
                  />
                  {it.bbox && (
                    // Crop overlay: outline the extracted region over the source image.
                    <div
                      className="pointer-events-none absolute border-2 border-accent"
                      style={{
                        left: `${it.bbox.x * 100}%`,
                        top: `${it.bbox.y * 100}%`,
                        width: `${it.bbox.w * 100}%`,
                        height: `${it.bbox.h * 100}%`,
                        backgroundColor: 'color-mix(in srgb, var(--seed-warning) 18%, transparent)',
                      }}
                    />
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 border-b border-stroke bg-bg-elevated px-3 py-2.5">
              <span className="seed-badge-warning">{FLAG_TYPE_LABELS_KO[it.flag.flagType]}</span>
              <span className="text-xs text-fg-subtle">미리보기 없음 — 원문에서 확인</span>
            </div>
          )}
          <div className="space-y-1 p-3">
            <div className="flex items-center justify-between gap-2">
              {/* 지원자 이름 — 갤러리 스캔 시 맥락 식별의 핵심 */}
              <p className="truncate text-sm font-semibold text-fg">
                {it.applicantName ? (
                  <Link href={`/applicants/${it.applicantId}`} className="hover:underline underline-offset-2">
                    {it.applicantName}
                  </Link>
                ) : (
                  it.applicantId
                )}
              </p>
              {it.documentId && (
                <a
                  className="shrink-0 text-xs font-medium text-info hover:text-info/80 transition-colors"
                  href={`/api/file/${it.documentId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  원문 보기
                </a>
              )}
            </div>
            <p className="truncate text-xs text-fg-muted">
              {it.personName ?? it.flag.label ?? it.filename ?? '—'}
            </p>
          </div>
        </>
      )}
    </li>
  );
}
