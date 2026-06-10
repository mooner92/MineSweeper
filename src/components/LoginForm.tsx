'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: form.get('username'), password: form.get('password') }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? `로그인 실패 (HTTP ${res.status})`);
        setBusy(false);
        return;
      }
      const next = params.get('next');
      // Only ever return to an in-app path (no protocol-relative/open redirects).
      router.push(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
      router.refresh();
    } catch {
      setError('서버에 연결할 수 없습니다.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block space-y-1">
        <span className="text-sm font-medium text-fg-muted">아이디</span>
        <input
          name="username"
          autoComplete="username"
          required
          autoFocus
          className="seed-input w-full py-2"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-fg-muted">비밀번호</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="seed-input w-full py-2"
        />
      </label>
      {error && <p className="text-sm font-medium text-danger">{error}</p>}
      <button type="submit" className="seed-btn-primary w-full" disabled={busy}>
        {busy ? '확인 중…' : '로그인'}
      </button>
    </form>
  );
}
