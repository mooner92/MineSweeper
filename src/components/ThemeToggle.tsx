'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

/** 선택한 테마를 html.dark 클래스로 반영. system은 OS 설정을 따른다. */
function applyTheme(theme: Theme): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

const SunIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
const MoonIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);
const SystemIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

const OPTIONS: Array<{ v: Theme; label: string; icon: () => JSX.Element }> = [
  { v: 'light', label: '밝게', icon: SunIcon },
  { v: 'dark', label: '어둡게', icon: MoonIcon },
  { v: 'system', label: '시스템', icon: SystemIcon },
];

/** 밝게/어둡게/시스템 3단 토글. 선택은 localStorage에 저장되고, system 모드는 OS 변경을 추종한다. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(((localStorage.getItem('theme') as Theme) || 'system'));
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme, mounted]);

  // 마운트 전엔 자리만 잡아 레이아웃 시프트/하이드레이션 불일치를 막는다.
  if (!mounted) return <div className="h-8 w-[90px]" aria-hidden />;

  function choose(t: Theme): void {
    setTheme(t);
    localStorage.setItem('theme', t);
  }

  return (
    <div role="group" aria-label="테마 선택" className="flex items-center rounded-seed border border-stroke p-0.5">
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const active = theme === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => choose(o.v)}
            aria-pressed={active}
            title={`테마: ${o.label}`}
            className={`flex h-7 w-7 items-center justify-center rounded-[7px] transition-colors ${
              active ? 'bg-bg-layer text-fg' : 'text-fg-subtle hover:text-fg'
            }`}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
