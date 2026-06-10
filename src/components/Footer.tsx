import Link from 'next/link';
import { SITE } from '@/lib/site';

const LINKS = [
  { href: '/guide', label: '사용 안내' },
  { href: '/faq', label: 'FAQ' },
  { href: '/about', label: '사이트 소개' },
];

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="mt-12 border-t border-stroke bg-bg">
      <div className="mx-auto max-w-6xl space-y-6 px-5 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 text-sm">
            <p className="font-bold text-fg">⛏️ {SITE.name}</p>
            <p className="text-fg-subtle">{SITE.tagline}</p>
            <p className="text-fg-subtle">
              문의{' '}
              <a className="hover:underline" href={`mailto:${SITE.contactEmail}`}>
                {SITE.contactEmail}
              </a>
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
              {LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="no-underline hover:text-fg">
                  {l.label}
                </Link>
              ))}
            </nav>
            <a
              href={SITE.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-seed border border-stroke bg-bg px-2.5 py-1.5 text-xs font-medium text-fg-muted no-underline transition-colors hover:bg-bg-layer hover:text-fg"
            >
              <GitHubMark className="h-4 w-4" />
              <span>GitHub</span>
            </a>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-fg-subtle">
          © {SITE.copyrightYears} {SITE.operator}. 본 시스템은 채용 이해충돌 검토를 보조하는 내부
          도구이며, <strong className="font-semibold">자동 추출 결과는 초안</strong>입니다 — 최종
          판단은 담당자가 합니다. 지원자 개인정보는 온프레 환경에만 저장되며 외부로 전송되지
          않습니다.
        </p>
      </div>
    </footer>
  );
}
