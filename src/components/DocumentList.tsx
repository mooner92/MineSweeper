'use client';

import { useEffect, useRef, useState } from 'react';
import type { SourceFormat } from '@/lib/domain';

export interface DocItem {
  id: string;
  filename: string;
  /** Korean doc-type label, resolved server-side. */
  label: string;
  format: SourceFormat;
  people: number;
  pageCount: number;
}

/**
 * 문서 카드 목록 + 슬라이드 패널 뷰어(노션식 사이드 피크). 카드를 클릭하면 우측에서 패널이
 * 슬라이드되어 원문을 보여준다 — PDF/이미지는 그대로 렌더, HWP/텍스트는 추출 텍스트(읽기 전용).
 * 패널엔 항상 다운로드/새 탭 버튼이 있다.
 */
export function DocumentList({ items }: { items: DocItem[] }) {
  const [open, setOpen] = useState<DocItem | null>(null);

  return (
    <>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => setOpen(d)}
              className="seed-card flex w-full items-center justify-between gap-3 p-3 text-left text-sm transition-colors hover:border-stroke-strong hover:bg-bg-layer/40"
            >
              <span className="truncate" title={d.filename}>
                {d.filename}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span
                  className={`text-xs ${d.people > 0 ? 'font-semibold text-fg' : 'text-fg-subtle'}`}
                >
                  관계자 {d.people}명
                </span>
                <span className="seed-badge-neutral">{d.label}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {open && <DocDrawer doc={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function DocDrawer({ doc, onClose }: { doc: DocItem; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

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
        className="ms-drawer absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col bg-bg shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-stroke px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-sm font-semibold text-fg" title={doc.filename}>
              {doc.filename}
            </p>
            <p className="text-xs text-fg-muted">
              <span className="seed-badge-neutral mr-1.5 align-middle">{doc.label}</span>
              {doc.pageCount > 0 && `${doc.pageCount}쪽 · `}관계자 {doc.people}명
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

        <div className="min-h-0 flex-1 overflow-auto bg-bg-layer">
          <DocBody doc={doc} />
        </div>
      </div>
    </div>
  );
}

function DocBody({ doc }: { doc: DocItem }) {
  if (doc.format === 'pdf') {
    // 브라우저 내장 PDF 뷰어(읽기 전용 표시).
    return <iframe src={`/api/file/${doc.id}`} title={doc.filename} className="h-full w-full" />;
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
        if (!r.ok || j.text == null) setState({ kind: 'error', message: j.error ?? `HTTP ${r.status}` });
        else setState({ kind: 'ok', text: j.text });
      })
      .catch(() => alive && setState({ kind: 'error', message: '불러오지 못했습니다.' }));
    return () => {
      alive = false;
    };
  }, [docId]);

  if (state.kind === 'loading') {
    return <p className="p-6 text-sm text-fg-muted">텍스트 추출 중… (큰 HWP는 수 초 걸립니다)</p>;
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
