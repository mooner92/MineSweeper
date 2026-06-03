'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

interface StatusResponse {
  status: string;
  progress?: number;
}

export function UploadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

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
    const input = e.currentTarget.elements.namedItem('file') as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;

    setBusy(true);
    setStatus('업로드 중…');
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!res.ok) {
      setStatus('업로드 실패');
      setBusy(false);
      return;
    }
    const { applicantId } = (await res.json()) as { applicantId: string };
    setStatus('추출 진행 중…');
    await poll(applicantId);
    setBusy(false);
    router.push(`/applicants/${applicantId}`);
    router.refresh();
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
      {status && <p className="w-full text-sm text-fg-muted">{status}</p>}
    </form>
  );
}
