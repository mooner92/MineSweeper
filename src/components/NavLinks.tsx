'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

const ITEMS = [
  { href: '/', label: '지원자' },
  { href: '/review-queue', label: '검토 필요 큐' },
  { href: '/guide', label: '사용 안내' },
];

/** Header nav with the current page highlighted (담당자가 지금 어디에 있는지 보이게). */
export function NavLinks() {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' || pathname.startsWith('/applicants') : pathname.startsWith(href);

  // 로그인 화면에서는 네비/로그아웃을 보여줄 이유가 없다.
  if (pathname === '/login') return null;

  async function logout(): Promise<void> {
    setSigningOut(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    router.push('/login');
    router.refresh();
  }

  return (
    <nav className="flex items-center gap-1 text-sm">
      {ITEMS.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          aria-current={isActive(it.href) ? 'page' : undefined}
          className={`no-underline ${
            isActive(it.href)
              ? 'seed-btn bg-accent-subtle font-semibold text-accent'
              : 'seed-btn-ghost'
          }`}
        >
          {it.label}
        </Link>
      ))}
      <span className="mx-1 h-4 w-px bg-stroke" aria-hidden />
      <button type="button" className="seed-btn-ghost" disabled={signingOut} onClick={logout}>
        로그아웃
      </button>
    </nav>
  );
}
