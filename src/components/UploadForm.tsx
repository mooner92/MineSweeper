'use client';

import { useRouter } from 'next/navigation';
import { type DragEvent, type FormEvent, useRef, useState } from 'react';

interface StatusResponse {
  status: string;
  progress?: number;
}

// Cloudflare's free/pro plans cap request bodies at ~100MB on the public domain. Uploads larger
// than this never reach the server (no trace) — so we catch it client-side with a clear message.
const PROXY_LIMIT_BYTES = 100 * 1024 * 1024;
const MB = 1024 * 1024;

/** True when served over a direct LAN/localhost host (no Cloudflare proxy → server limit applies). */
function isDirectHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    /^192\.168\./.test(h) ||
    /^10\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function poll(applicantId: string): Promise<void> {
    for (let i = 0; i < 180; i++) {
      const r = await fetch(`/api/status/${applicantId}`, { cache: 'no-store' });
      if (r.ok) {
        const s = (await r.json()) as StatusResponse;
        setStatus(`추출 ${s.status}`);
        setProgress(s.progress ?? 0);
        if (s.status === 'done' || s.status === 'error') return;
      }
      await new Promise((res) => setTimeout(res, 1000));
    }
  }

  function pick(f: File | undefined | null): void {
    setError(null);
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) {
      setError('zip 파일만 업로드할 수 있습니다.');
      return;
    }
    setFile(f);
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    pick(e.dataTransfer.files?.[0]);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError('zip 파일을 선택하세요.');
      return;
    }

    // Pre-flight: a >100MB upload through the public (Cloudflare) domain is blocked at the edge
    // before it reaches the server. Guide the user to the internal address or to splitting the zip.
    if (!isDirectHost() && file.size > PROXY_LIMIT_BYTES) {
      setError(
        `이 파일은 ${(file.size / MB).toFixed(0)}MB입니다. 공개 도메인은 약 100MB까지만 업로드됩니다. ` +
          '내부망 직접 주소(서버 IP의 :3100)로 접속해 업로드하거나, zip을 나눠서 올려주세요.',
      );
      return;
    }

    setBusy(true);
    setStatus('업로드 중…');
    setProgress(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        let reason = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) reason = j.error;
        } catch {
          // Non-JSON response — typically a proxy (Cloudflare) HTML error page for an oversized body.
          if (res.status === 413)
            reason = '파일이 너무 큽니다 (프록시 약 100MB 제한). 내부망 직접 주소로 업로드하세요.';
        }
        setError(`업로드 실패: ${reason}`);
        setStatus(null);
        setBusy(false);
        return;
      }
      const { applicantId } = (await res.json()) as { applicantId: string };
      setStatus('추출 진행 중…');
      await poll(applicantId);
      setBusy(false);
      router.push(`/applicants/${applicantId}`);
      router.refresh();
    } catch {
      // fetch threw — usually the proxy reset the connection on a too-large body.
      setError(
        '업로드 중 연결이 끊겼습니다. 파일이 크면(약 100MB↑) 공개 도메인 프록시에서 차단될 수 있습니다 — ' +
          '내부망 직접 주소(:3100)로 업로드하거나 zip을 나눠주세요.',
      );
      setStatus(null);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {/* Drop zone doubles as the file picker — click or drag a zip onto it. */}
      <div
        role="button"
        tabIndex={0}
        aria-label="zip 파일 선택 또는 드래그하여 업로드"
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !busy) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-seed-lg border-2 border-dashed px-6 py-8 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          dragOver
            ? 'border-accent bg-accent-subtle'
            : file
              ? 'border-stroke-strong bg-bg-layer/50'
              : 'border-stroke bg-bg-layer/30 hover:border-stroke-strong hover:bg-bg-layer/60'
        } ${busy ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          name="file"
          accept=".zip"
          disabled={busy}
          className="hidden"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => pick(e.target.files?.[0])}
        />
        {file ? (
          <>
            <p className="text-sm font-semibold text-fg">📦 {file.name}</p>
            <p className="text-xs text-fg-subtle">
              {(file.size / MB).toFixed(1)}MB · 다른 파일을 선택하려면 클릭
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-fg-muted">
              zip 파일을 여기에 끌어다 놓거나 <span className="text-accent">클릭해서 선택</span>
            </p>
            <p className="text-xs text-fg-subtle">지원자 1명의 첨부서류 압축파일 (.zip)</p>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="seed-btn-primary" disabled={busy || !file}>
          {busy ? '처리 중…' : '업로드 & 추출'}
        </button>
        <p className="text-xs text-fg-subtle">
          공개 도메인 업로드는 약 100MB까지 — 더 큰 파일은 내부망 직접 주소(:3100) 또는 zip 분할.
        </p>
      </div>

      {status && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-accent">
            {status}
            {progress != null ? ` (${progress}%)` : ''}
          </p>
          {progress != null && (
            <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-bg-layer">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${Math.max(progress, 4)}%` }}
              />
            </div>
          )}
        </div>
      )}
      {error && <p className="text-sm font-medium text-danger">{error}</p>}
    </form>
  );
}
