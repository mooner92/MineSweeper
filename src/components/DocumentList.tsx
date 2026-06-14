'use client';

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { ROLE_LABELS_KO, type Role, type SourceFormat, type SourceKind } from '@/lib/domain';

/** 한 문서에서 검출된 인물 한 명 — 드로어 좌측 "누가·어디서" 목록의 한 행. */
export interface DocPersonRef {
  aggregateId: string;
  name: string;
  /** 로마자 이름의 한글 추정(없으면 null) — 검토 참고용. */
  koreanEst: string | null;
  roles: Role[];
  /** 소속(없으면 null). */
  affiliation: string | null;
  /** 이 문서 안에서 이름이 나온 쪽번호(오름차순). */
  pages: number[];
  /** 이 문서에서 이 사람의 검출 형태(printed 외 seal/signature/handwritten이면 검토상 중요). */
  sourceKinds: SourceKind[];
  /** 검출 근거 스니펫(원문 줄). */
  evidence: string | null;
  needsHuman: boolean;
  isSelf: boolean;
}

export interface DocItem {
  id: string;
  filename: string;
  /** Korean doc-type label, resolved server-side. */
  label: string;
  format: SourceFormat;
  /** 이 문서에서 검출된 인물(본인 포함). 카드 배지의 '관계자 N명'은 본인 제외 수. */
  people: DocPersonRef[];
  pageCount: number;
  /** 텍스트가 있는데 관계자 0명 — 추출 실패 가능성, 카드에 경고 배지로 드러낸다. */
  zeroWarn?: boolean;
}

const relationCount = (d: DocItem) => d.people.filter((p) => !p.isSelf).length;

/**
 * 문서 카드 목록 + 슬라이드 패널 뷰어(노션식 사이드 피크). 카드를 클릭하면 우측에서 2단 패널이
 * 슬라이드된다 — 좌측엔 "이 문서에서 검출된 관계자"(이름·역할·페이지·근거), 우측엔 원문(PDF/이미지/
 * 추출 텍스트). 좌측의 카드나 `p.N` 칩을 누르면 우측 PDF가 해당 쪽으로 이동한다.
 */
/** 파일 형식 글리프 — 카드 좌측의 작은 색 라벨(PDF/IMG/HWP/TXT). */
const FORMAT_GLYPH: Partial<Record<SourceFormat, { label: string; cls: string }>> = {
  pdf: { label: 'PDF', cls: 'bg-danger-subtle text-danger' },
  image: { label: 'IMG', cls: 'bg-accent-subtle text-accent' },
  hwp: { label: 'HWP', cls: 'bg-success-subtle text-success' },
  text: { label: 'TXT', cls: 'bg-bg-layer text-fg-muted' },
};

function FormatGlyph({ format }: { format: SourceFormat }) {
  const g = FORMAT_GLYPH[format] ?? { label: 'DOC', cls: 'bg-bg-layer text-fg-muted' };
  return (
    <span
      aria-hidden
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-seed text-[10px] font-bold ${g.cls}`}
    >
      {g.label}
    </span>
  );
}

export function DocumentList({ items }: { items: DocItem[] }) {
  const [open, setOpen] = useState<DocItem | null>(null);

  // 문서유형(라벨) 그룹 — 최초 등장 순서 유지. 15건을 유형별로 묶어 스캔하기 쉽게.
  const groups: Array<{ label: string; docs: DocItem[] }> = [];
  const groupIdx = new Map<string, number>();
  for (const d of items) {
    let i = groupIdx.get(d.label);
    if (i === undefined) {
      i = groups.length;
      groupIdx.set(d.label, i);
      groups.push({ label: d.label, docs: [] });
    }
    groups[i].docs.push(d);
  }

  return (
    <>
      <div className="space-y-2">
        {groups.map((g) => {
          const warnCount = g.docs.filter((d) => d.zeroWarn).length;
          return (
            <details key={g.label} className="group seed-card overflow-hidden" open>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-bg-layer/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                  {g.label}
                  <span className="font-normal text-fg-subtle">{g.docs.length}건</span>
                  {warnCount > 0 && (
                    <span className="seed-badge-warning">확인 {warnCount}</span>
                  )}
                </span>
                <span
                  aria-hidden
                  className="shrink-0 text-fg-subtle transition-transform group-open:rotate-180"
                >
                  ⌄
                </span>
              </summary>
              <ul className="divide-y divide-stroke border-t border-stroke">
                {g.docs.map((d) => {
                  const n = relationCount(d);
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => setOpen(d)}
                        className="group/row flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-bg-layer/50"
                      >
                        <FormatGlyph format={d.format} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-fg" title={d.filename}>
                            {d.filename}
                          </span>
                          <span className="mt-0.5 block text-xs">
                            {d.pageCount > 0 && <span className="text-fg-muted">{d.pageCount}쪽 · </span>}
                            {d.zeroWarn ? (
                              <span
                                className="font-medium text-warning"
                                title="텍스트가 있는데 관계자가 검출되지 않았습니다 — 원문 확인 권장"
                              >
                                관계자 0명 — 확인
                              </span>
                            ) : (
                              <span className={n > 0 ? 'font-medium text-fg' : 'text-fg-subtle'}>
                                관계자 {n}명
                              </span>
                            )}
                          </span>
                        </span>
                        <span
                          aria-hidden
                          className="shrink-0 text-lg text-fg-subtle transition-transform group-hover/row:translate-x-0.5"
                        >
                          ›
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </div>

      {open && <DocDrawer doc={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function DocDrawer({ doc, onClose }: { doc: DocItem; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // 우측 PDF가 보여줄 쪽번호. 좌측 카드/페이지 칩을 누르면 갱신된다(PDF만 해당).
  const [page, setPage] = useState<number | null>(null);

  // ESC로 닫기 + 열려 있는 동안 본문 스크롤 잠금 + 닫기 버튼 포커스.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const isPdf = doc.format === 'pdf';

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="ms-overlay absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`문서 보기: ${doc.filename}`}
        className="ms-drawer absolute inset-y-0 right-0 flex w-full max-w-5xl flex-col bg-bg shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-stroke px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-sm font-semibold text-fg" title={doc.filename}>
              {doc.filename}
            </p>
            <p className="text-xs text-fg-muted">
              <span className="seed-badge-neutral mr-1.5 align-middle">{doc.label}</span>
              {doc.pageCount > 0 && `${doc.pageCount}쪽 · `}관계자 {relationCount(doc)}명
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <a
              href={`/api/file/${doc.id}?download=1`}
              className="seed-btn-neutral no-underline"
              title="원본 파일 다운로드"
            >
              ⬇ 다운로드
            </a>
            {(doc.format === 'pdf' || doc.format === 'image') && (
              <a
                href={`/api/file/${doc.id}`}
                target="_blank"
                rel="noreferrer"
                className="seed-btn-ghost no-underline"
                title="새 탭에서 열기"
              >
                새 탭 ↗
              </a>
            )}
            <button
              ref={closeRef}
              type="button"
              className="seed-btn-ghost"
              onClick={onClose}
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <PeoplePanel
            people={doc.people}
            canJump={isPdf}
            activePage={page}
            onJump={isPdf ? setPage : undefined}
          />
          <div className="min-h-0 flex-1 overflow-auto bg-bg-layer">
            <DocBody doc={doc} page={page} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── avatar ───────────────────────────────────────────────────────────────────
// 이름 해시 기반 5색 파레트 — 동일 인물은 항상 같은 색.
// KEI 브랜드(그린·블루·그레이) 조화 팔레트 — 사람 식별용 색 칩.
const AVATAR_PALETTES = [
  { bg: 'bg-[#e1f6f0]', text: 'text-[#00866a]', ring: 'ring-[#a9e5d6]' }, // 브랜드 그린
  { bg: 'bg-[#e2f4fc]', text: 'text-[#0079a8]', ring: 'ring-[#a9ddf2]' }, // 브랜드 블루
  { bg: 'bg-[#eef0ef]', text: 'text-[#5c5e5b]', ring: 'ring-[#d0d4d2]' }, // KEI 그레이
  { bg: 'bg-[#e8f5ea]', text: 'text-[#2e7d54]', ring: 'ring-[#b8e0c4]' }, // 딥그린
  { bg: 'bg-[#eef0ff]', text: 'text-[#4f5bd0]', ring: 'ring-[#cdd3f7]' }, // 인디고
] as const;

function avatarPalette(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_PALETTES[h % AVATAR_PALETTES.length];
}

/** 한글이면 성(첫 글자), 로마자면 첫 대문자. */
function nameInitial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

// ── sourceKind ────────────────────────────────────────────────────────────────
const SOURCE_KIND_CHIPS: Partial<Record<SourceKind, { label: string; title: string }>> = {
  seal: { label: '도장', title: '인영(도장) 검출 — 원문에서 날인 확인 권장' },
  signature: { label: '서명', title: '서명 검출 — 자필 서명 확인 권장' },
  handwritten: { label: '손글씨', title: '손글씨 검출 — 자필 기재 확인 권장' },
};

/** 좌측 "이 문서에서 검출된 관계자" 목록 — 카드 전체 클릭 시 우측 PDF를 해당 쪽으로 점프. */
function PeoplePanel({
  people,
  canJump,
  activePage,
  onJump,
}: {
  people: DocPersonRef[];
  canJump: boolean;
  activePage: number | null;
  onJump?: (page: number) => void;
}) {
  return (
    <aside className="flex max-h-56 shrink-0 flex-col border-b border-stroke md:max-h-none md:w-80 md:border-b-0 md:border-r">
      <header className="border-b border-stroke bg-bg-layer/60 px-4 py-2.5">
        <p className="text-sm font-semibold text-fg">검출된 관계자 {people.length}명</p>
        <p className="mt-0.5 text-xs text-fg-subtle">
          {canJump
            ? '카드를 누르면 오른쪽 문서가 해당 쪽으로 이동합니다'
            : '검출 위치(쪽)와 근거를 함께 표시합니다'}
        </p>
      </header>
      {people.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-fg-muted">
          이 문서에서 검출된 이름이 없습니다.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto py-1.5">
          {people.map((p) => (
            <li key={p.aggregateId}>
              <PersonCard
                person={p}
                canJump={canJump}
                activePage={activePage}
                onJump={onJump}
              />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function PersonCard({
  person,
  canJump,
  activePage,
  onJump,
}: {
  person: DocPersonRef;
  canJump: boolean;
  activePage: number | null;
  onJump?: (page: number) => void;
}) {
  const firstPage = person.pages[0] ?? null;
  // 이 카드에 속한 페이지 중 현재 뷰어 페이지와 일치하는 게 있으면 활성
  const isActive = activePage !== null && person.pages.includes(activePage);

  const handleCardActivate = () => {
    if (canJump && firstPage != null) onJump?.(firstPage);
  };

  const handleCardKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardActivate();
    }
  };

  const notableKinds = person.sourceKinds.filter((k) => k in SOURCE_KIND_CHIPS);
  const palette = avatarPalette(person.name);

  return (
    <div
      role={canJump ? 'button' : undefined}
      tabIndex={canJump ? 0 : undefined}
      onClick={canJump ? handleCardActivate : undefined}
      onKeyDown={canJump ? handleCardKeyDown : undefined}
      aria-label={
        canJump && firstPage != null ? `${person.name} — ${firstPage}쪽으로 이동` : person.name
      }
      aria-pressed={canJump ? isActive : undefined}
      className={[
        'relative mx-3 my-1.5 rounded-seed border border-l-2 bg-bg px-3 py-2.5 transition-all',
        isActive
          ? 'border-stroke border-l-accent bg-accent-subtle/30'
          : 'border-stroke border-l-transparent',
        canJump
          ? 'cursor-pointer hover:border-stroke-strong hover:border-l-accent/60 hover:bg-bg-layer/50 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'
          : 'cursor-default',
        person.isSelf ? 'opacity-60' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* ── 행 1: 아바타 + 이름/koreanEst + 우측 상태 배지 ── */}
      <div className="flex items-center gap-2.5">
        {/* 아바타 — 이름 해시 색상, 이니셜 표시 */}
        <div
          aria-hidden="true"
          className={[
            'flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full text-[13px] font-bold ring-1',
            palette.bg,
            palette.text,
            palette.ring,
          ].join(' ')}
        >
          {nameInitial(person.name)}
        </div>

        {/* 이름 + 한글 추정 */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold leading-tight text-fg">
            {person.name}
            {person.koreanEst && (
              <span className="ml-1.5 text-[12px] font-normal text-fg-subtle">
                ({person.koreanEst})
              </span>
            )}
          </p>
          {person.affiliation && (
            <p
              className="mt-0.5 truncate text-[12px] leading-tight text-fg-muted"
              title={person.affiliation}
            >
              {person.affiliation}
            </p>
          )}
        </div>

        {/* 우측 상태 배지 */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          {person.isSelf && (
            <span className="seed-badge-neutral whitespace-nowrap" title="지원자 본인">
              본인
            </span>
          )}
          {person.needsHuman && (
            <span
              className="seed-badge-warning whitespace-nowrap"
              title="자동 추출 신뢰도 낮음 — 원문 직접 확인 필요"
            >
              미확인
            </span>
          )}
        </div>
      </div>

      {/* ── 행 2: 역할 배지 + sourceKind 경고 칩 (아바타 폭만큼 들여쓰기) ── */}
      {(person.roles.length > 0 || notableKinds.length > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-[42px]">
          {person.roles.map((r) => (
            <span key={r} className="seed-badge-neutral">
              {ROLE_LABELS_KO[r]}
            </span>
          ))}
          {notableKinds.map((k) => {
            const chip = SOURCE_KIND_CHIPS[k]!;
            return (
              <span
                key={k}
                title={chip.title}
                className="rounded-seed border border-warning/40 bg-warning-subtle px-1.5 py-0.5 text-[11px] leading-none text-warning"
              >
                {chip.label}
              </span>
            );
          })}
        </div>
      )}

      {/* ── 행 3: 페이지 칩 (아바타 폭만큼 들여쓰기, 각 칩은 독립 버튼) ── */}
      {person.pages.length > 0 && (
        <div
          className="mt-1 flex flex-wrap items-center gap-1 pl-[42px]"
          onClick={(e) => e.stopPropagation()}
        >
          {person.pages.map((pg) =>
            canJump ? (
              <button
                key={pg}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onJump?.(pg);
                }}
                title={`${pg}쪽으로 이동`}
                aria-label={`${pg}쪽으로 이동`}
                className={[
                  'rounded-seed border px-1.5 py-0.5 text-[11px] font-medium leading-none transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                  activePage === pg
                    ? 'border-accent bg-accent-subtle text-accent'
                    : 'border-stroke text-fg-muted hover:border-stroke-strong hover:bg-bg-layer',
                ].join(' ')}
              >
                p.{pg}
              </button>
            ) : (
              <span
                key={pg}
                className="rounded-seed border border-stroke px-1.5 py-0.5 text-[11px] leading-none text-fg-subtle"
              >
                p.{pg}
              </span>
            ),
          )}
        </div>
      )}

      {/* ── 행 4: 근거 스니펫 (2줄 클램프, 전체 표시는 title로) ── */}
      {person.evidence && (
        <p
          className="mt-1.5 line-clamp-2 rounded-seed bg-bg-layer px-2 py-1.5 text-[11px] leading-relaxed text-fg-muted"
          title={person.evidence}
        >
          &ldquo;{person.evidence}&rdquo;
        </p>
      )}
    </div>
  );
}

function DocBody({ doc, page }: { doc: DocItem; page: number | null }) {
  if (doc.format === 'pdf') {
    // 브라우저 내장 PDF 뷰어. #page 앵커로 특정 쪽 이동 — page가 바뀌면 key로 리마운트해
    // 같은 문서 안에서의 재점프도 확실히 동작시킨다(내장 뷰어는 hash 변경만으로 항상 이동하진 않음).
    const src = `/api/file/${doc.id}#page=${page ?? 1}&view=FitH`;
    return (
      <iframe
        key={page ?? 'first'}
        src={src}
        title={doc.filename}
        className="h-full min-h-[60vh] w-full"
      />
    );
  }
  if (doc.format === 'image') {
    return (
      <div className="flex min-h-full items-start justify-center p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/file/${doc.id}`} alt={doc.filename} className="max-w-full rounded-seed" />
      </div>
    );
  }
  // hwp / hwpx / text — 추출 텍스트 읽기 전용 뷰.
  return <ExtractedText docId={doc.id} format={doc.format} />;
}

function ExtractedText({ docId, format }: { docId: string; format: SourceFormat }) {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; text: string }
  >({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ kind: 'loading' });
    fetch(`/api/doc-text/${docId}`)
      .then(async (r) => {
        const j = (await r.json()) as { text?: string; error?: string };
        if (!alive) return;
        if (!r.ok || j.text == null)
          setState({ kind: 'error', message: j.error ?? `HTTP ${r.status}` });
        else setState({ kind: 'ok', text: j.text });
      })
      .catch(() => alive && setState({ kind: 'error', message: '불러오지 못했습니다.' }));
    return () => {
      alive = false;
    };
  }, [docId]);

  if (state.kind === 'loading') {
    return (
      <p className="p-6 text-sm text-fg-muted">텍스트 추출 중… (큰 HWP는 수 초 걸립니다)</p>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="space-y-2 p-6 text-sm">
        <p className="font-medium text-danger">{state.message}</p>
        <p className="text-fg-muted">원문은 상단 다운로드 버튼으로 받아 한글에서 확인하세요.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 p-4">
      {format === 'hwp' && (
        <p className="rounded-seed bg-warning-subtle px-3 py-2 text-xs text-warning">
          HWP는 <strong>추출 텍스트(읽기 전용)</strong>로 표시됩니다 — 표·도장·서식 등 원문
          레이아웃은 다운로드해 한글에서 확인하세요.
        </p>
      )}
      <pre className="seed-card max-w-full whitespace-pre-wrap break-words p-4 text-[13px] leading-relaxed text-fg">
        {state.text || '(추출된 텍스트가 없습니다)'}
      </pre>
    </div>
  );
}
