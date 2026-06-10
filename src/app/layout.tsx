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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-10 border-b border-stroke bg-bg">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
            <Link href="/" className="text-lg font-bold text-fg no-underline">
              ⛏️ Minesweeper
            </Link>
            <NavLinks />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
