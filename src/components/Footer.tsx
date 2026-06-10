import Link from 'next/link';
import { SITE } from '@/lib/site';

const LINKS = [
  { href: '/guide', label: '사용 안내' },
  { href: '/faq', label: 'FAQ' },
  { href: '/about', label: '사이트 소개' },
];

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
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="no-underline hover:text-fg">
                {l.label}
              </Link>
            ))}
          </nav>
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
