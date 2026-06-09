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
        <div>
          <h1 className="text-xl font-bold">검토 필요 큐</h1>
          <p className="text-sm text-fg-muted">
            도장·손글씨·판독난해 서명·비전 판독 필요 항목을 한 곳에 모았습니다. ({items.length})
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
        <p className="seed-card p-6 text-sm text-fg-muted">검토 대기 항목이 없습니다.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <li key={it.flag.id} className="seed-card overflow-hidden">
              {it.flag.flagType === 'ambiguous' && it.candidates ? (
                // 동명이인/약어: 후보 이름별로 원문 파일·페이지 링크를 나열해 비교하게 한다.
                <div className="space-y-2 p-3">
                  <div className="flex items-center justify-between">
                    <span className="seed-badge-warning">{FLAG_TYPE_LABELS_KO.ambiguous}</span>
                    <span className="text-xs text-fg-subtle">
                      {it.applicantName ? (
                        <Link href={`/applicants/${it.applicantId}`}>{it.applicantName}</Link>
                      ) : (
                        it.applicantId
                      )}
                    </span>
                  </div>
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
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {c.sources.map((s, i) => (
                              <a
                                key={`${s.documentId}-${s.page}-${i}`}
                                href={`/api/file/${s.documentId}#page=${s.page}`}
                                target="_blank"
                                rel="noreferrer"
                                title={s.filename}
                                className="seed-badge-neutral no-underline"
                              >
                                {DOC_TYPE_LABELS_KO[s.docType]} p.{s.page}
                              </a>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
              <div className="relative aspect-[4/3] bg-bg-layer">
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
                          backgroundColor: 'rgba(255, 111, 15, 0.18)',
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
                <div className="flex items-center justify-between">
                  <span className="seed-badge-warning">{FLAG_TYPE_LABELS_KO[it.flag.flagType]}</span>
                  {it.documentId && (
                    <a
                      className="text-xs"
                      href={`/api/file/${it.documentId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      원문 보기
                    </a>
                  )}
                </div>
                <p className="truncate text-sm font-semibold">
                  {it.personName ?? it.flag.label ?? it.filename ?? '문서'}
                </p>
                <p className="text-xs text-fg-muted">
                  {it.applicantName ? (
                    <Link href={`/applicants/${it.applicantId}`}>{it.applicantName}</Link>
                  ) : (
                    it.applicantId
                  )}
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
  return (
    <Link
      href={href}
      className={`no-underline ${active ? 'seed-badge bg-accent text-fg-oncolor' : 'seed-badge-neutral'}`}
    >
      {label} {count}
    </Link>
  );
}
