'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: '지원자' },
  { href: '/review-queue', label: '검토 필요 큐' },
  { href: '/guide', label: '사용 안내' },
];

/** Header nav with the current page highlighted (담당자가 지금 어디에 있는지 보이게). */
export function NavLinks() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' || pathname.startsWith('/applicants') : pathname.startsWith(href);

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
    </nav>
  );
}
