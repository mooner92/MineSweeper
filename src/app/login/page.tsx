import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/LoginForm';
import { SITE } from '@/lib/site';

export const metadata: Metadata = { title: `로그인 | ${SITE.name}` };

export default function LoginPage() {
  return (
    <div className="mx-auto flex max-w-sm flex-col justify-center py-16">
      <div className="seed-card space-y-5 p-8">
        <div className="space-y-1 text-center">
          <p className="text-2xl">⛏️</p>
          <h1 className="text-xl font-bold">{SITE.name}</h1>
          <p className="text-sm text-fg-muted">{SITE.tagline}</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
        <p className="text-center text-xs text-fg-subtle">
          내부 도구입니다 — 계정이 필요하면 {SITE.operator}에 문의하세요.
        </p>
      </div>
    </div>
  );
}
