'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

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
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function poll(applicantId: string): Promise<void> {
    for (let i = 0; i < 180; i++) {
      const r = await fetch(`/api/status/${applicantId}`, { cache: 'no-store' });
      if (r.ok) {
        const s = (await r.json()) as StatusResponse;
        setStatus(`추출 ${s.status} (${s.progress ?? 0}%)`);
        if (s.status === 'done' || s.status === 'error') return;
      }
      await new Promise((res) => setTimeout(res, 1000));
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    const input = e.currentTarget.elements.namedItem('file') as HTMLInputElement | null;
    const file = input?.files?.[0];
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
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
      <input
        type="file"
        name="file"
        accept=".zip"
        disabled={busy}
        className="block text-sm text-fg-muted file:mr-3 file:rounded-seed file:border-0 file:bg-bg-layer file:px-3 file:py-2 file:text-sm file:font-semibold file:text-fg"
      />
      <button type="submit" className="seed-btn-primary" disabled={busy}>
        업로드 &amp; 추출
      </button>
      <p className="w-full text-xs text-fg-subtle">
        공개 도메인 업로드는 약 100MB까지입니다. 더 큰 압축파일은 내부망 직접 주소(:3100)로
        접속하거나 zip을 나눠 올려주세요.
      </p>
      {status && <p className="w-full text-sm text-fg-muted">{status}</p>}
      {error && <p className="w-full text-sm font-medium text-danger">{error}</p>}
    </form>
  );
}
