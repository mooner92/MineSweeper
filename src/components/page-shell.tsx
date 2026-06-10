import type { ReactNode } from 'react';
import { BackLink } from './BackLink';

/** Centered article shell for the static info pages (사용 안내 / FAQ / 사이트 소개). */
export function ContentShell({
  title,
  subtitle,
  updated,
  children,
}: {
  title: string;
  subtitle?: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <BackLink />
      <article className="seed-card space-y-7 p-6 sm:p-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="text-sm text-fg-muted">{subtitle}</p>}
          {updated && <p className="text-xs text-fg-subtle">마지막 수정일 {updated}</p>}
        </header>
        {children}
      </article>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-fg-muted">{children}</div>
    </section>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg-muted">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

/** A native (JS-free) accordion FAQ item. */
export function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group seed-card overflow-hidden">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3 text-sm font-semibold text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <span>
          <span className="text-accent">Q. </span>
          {q}
        </span>
        <span className="shrink-0 text-fg-subtle transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-stroke px-4 py-3 text-sm leading-relaxed text-fg-muted">
        {children}
      </div>
    </details>
  );
}
