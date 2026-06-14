'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';

/* Inline SVG icons — no external icon library dependency. 16×16, currentColor. */
function IconApplicants() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M2.5 13c0-2.485 2.462-4.5 5.5-4.5s5.5 2.015 5.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconQueue() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="2" rx="1" fill="currentColor" />
      <rect x="2" y="7" width="12" height="2" rx="1" fill="currentColor" />
      <rect x="2" y="11.5" width="7" height="2" rx="1" fill="currentColor" />
      <path
        d="M12 10.5l2 2-2 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconGuide() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 8.5V8c0-.828.672-1.5 1.5-1.5S11 6.672 11 7.5c0 .552-.336 1.032-.832 1.266L8 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="12" r="0.75" fill="currentColor" />
    </svg>
  );
}

const ITEMS = [
  { href: '/', label: '지원자', Icon: IconApplicants },
  { href: '/review-queue', label: '검토 필요 큐', Icon: IconQueue },
  { href: '/guide', label: '사용 안내', Icon: IconGuide },
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
    <nav className="flex items-center gap-0.5 text-sm" aria-label="주 내비게이션">
      {ITEMS.map((it) => {
        const active = isActive(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={`no-underline ${
              active
                ? 'seed-btn bg-accent-subtle font-bold text-fg border-b-2 border-accent rounded-b-none'
                : 'seed-btn-ghost font-medium'
            }`}
          >
            <it.Icon />
            {it.label}
          </Link>
        );
      })}
      <span className="mx-1.5 h-4 w-px bg-stroke" aria-hidden />
      <ThemeToggle />
      <button type="button" className="seed-btn-ghost" disabled={signingOut} onClick={logout}>
        로그아웃
      </button>
    </nav>
  );
}
