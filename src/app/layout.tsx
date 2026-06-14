import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { NavLinks } from '@/components/NavLinks';
import './globals.css';

export const metadata: Metadata = {
  title: 'Minesweeper — 이해충돌 관계자 검토',
  description: '지원자 첨부서류에서 이해충돌 관계자를 추출하고 사람이 검토·확정하는 시스템',
};

// 페인트 전에 테마를 적용해 깜빡임(FOUC)을 막는다. localStorage 'theme' = light|dark|system(기본).
const THEME_INIT = `(function(){try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-10 border-b border-stroke bg-bg">
          <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between px-5 sm:px-6 xl:px-10 2xl:px-14">
            <Link href="/" className="text-lg font-bold text-fg no-underline">
              ⛏️ Minesweeper
            </Link>
            <NavLinks />
          </div>
        </header>
        <main className="mx-auto w-full max-w-screen-2xl flex-1 px-5 py-8 sm:px-6 xl:px-10 2xl:px-14">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
