import Link from 'next/link';
import { DOC_TYPE_LABELS_KO, FLAG_TYPE_LABELS_KO, type FlagType } from '@/lib/domain';
import { getReviewQueue } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: { flag?: string };
}) {
  const all = await getReviewQueue();
  const activeFlag = searchParams.flag ?? 'all';
  const items = activeFlag === 'all' ? all : all.filter((it) => it.flag.flagType === activeFlag);

  // Build filter chips from the flag types actually present.
  const present = Array.from(new Set(all.map((it) => it.flag.flagType))) as FlagType[];
  const exportHref =
    activeFlag === 'all'
      ? '/api/review-queue/export'
      : `/api/review-queue/export?flag=${encodeURIComponent(activeFlag)}`;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <nav aria-label="breadcrumb" className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Link href="/" className="hover:text-fg transition-colors">지원자 목록</Link>
            <span aria-hidden className="text-stroke-strong">/</span>
            <span className="font-medium text-fg" aria-current="page">검토 필요 큐</span>
          </nav>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">검토 필요 큐</h1>
            {items.length > 0 && <span className="seed-badge-warning">{items.length}건</span>}
          </div>
          <p className="text-sm text-fg-muted">
            도장·손글씨·판독난해 서명·비전 판독 필요 항목을 한 곳에 모았습니다.
          </p>
        </div>
        <a className="seed-btn-neutral no-underline" href={exportHref}>
          리스트 내보내기 (CSV)
        </a>
      </header>

      <div className="flex flex-wrap gap-2">
        <FilterChip label="전체" href="/review-queue" active={activeFlag === 'all'} count={all.length} />
        {present.map((ft) => (
          <FilterChip
            key={ft}
            label={FLAG_TYPE_LABELS_KO[ft]}
            href={`/review-queue?flag=${ft}`}
            active={activeFlag === ft}
            count={all.filter((it) => it.flag.flagType === ft).length}
          />
        ))}
      </div>

      {items.length === 0 ? (
        <div className="seed-card p-10 text-center">
          <p className="text-base text-fg-muted">검토 대기 항목이 없습니다. 🎉</p>
          <p className="mt-1 text-sm text-fg-subtle">
            도장·서명·동명이인 항목이 생기면 여기에 모입니다.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <li key={it.flag.id} className="seed-card overflow-hidden transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-sm">
              {it.flag.flagType === 'ambiguous' && it.candidates ? (
                // 동명이인/약어: 후보 이름별로 원문 파일·페이지 링크를 나열해 비교하게 한다.
                <div>
                  {/* 헤더 바 — 이미지 카드와 동일한 패턴으로 통일(배지 위치 일관성) */}
                  <div className="flex items-center justify-between gap-2 border-b border-stroke bg-bg-layer px-3 py-2">
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
                                  <div className="flex h-40 w-28 flex-col items-center justify-center gap-1 rounded-seed border border-stroke bg-bg-layer p-2 text-center">
                                    <span className="text-2xl">📄</span>
                                    <span className="text-xs font-semibold uppercase text-fg-muted">
                                      {s.sourceFormat}
                                    </span>
                                    {s.filename && (
                                      <span className="line-clamp-2 break-all text-xs text-fg-subtle">
                                        {s.filename}
                                      </span>
                                    )}
                                    <span className="text-xs font-medium text-accent">원문 보기</span>
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
              <div className="relative aspect-[4/3] bg-bg-layer">
                {/* 플래그 유형 배지 — 이미지 위 절대 위치, 갤러리 스캔 시 유형 먼저 인식 */}
                <span className="absolute left-2 top-2 z-10 seed-badge-warning shadow-sm">
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
                ) : it.documentId && it.sourceFormat === 'image' ? (
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
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-fg-subtle">
                    미리보기 없음
                  </div>
                )}
              </div>
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
                      className="shrink-0 text-xs text-fg-muted hover:text-fg transition-colors"
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
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({
  label,
  href,
  active,
  count,
}: {
  label: string;
  href: string;
  active: boolean;
  count: number;
}) {
  const chip =
    'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors';
  return (
    <Link
      href={href}
      className={`no-underline ${
        active
          ? `${chip} bg-accent text-fg-oncolor`
          : `${chip} border border-stroke-strong bg-bg text-fg-muted no-underline hover:border-accent/40 hover:bg-accent-subtle/30 hover:text-fg`
      }`}
    >
      {label} {count}
    </Link>
  );
}
