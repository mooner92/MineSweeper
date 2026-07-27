import type { Config } from 'tailwindcss';

/**
 * seed-design–inspired semantic tokens.
 * Colors resolve to CSS variables declared in src/app/globals.css so the palette can be
 * themed in one place. Roles mirror Daangn seed-design conventions (bg layers, neutral
 * foreground scale, a carrot accent, plus success/warning for the review badges).
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: 'var(--seed-bg)', // surface-1 (카드)
          layer: 'var(--seed-bg-layer)', // canvas (페이지 배경)
          elevated: 'var(--seed-bg-elevated)', // surface-2 (강조 카드·보조 버튼)
          raised: 'var(--seed-bg-raised)', // surface-3 (칩·키캡)
        },
        fg: {
          DEFAULT: 'var(--seed-fg)',
          muted: 'var(--seed-fg-muted)',
          subtle: 'var(--seed-fg-subtle)',
          oncolor: 'var(--seed-fg-oncolor)',
        },
        stroke: {
          DEFAULT: 'var(--seed-stroke)',
          strong: 'var(--seed-stroke-strong)',
        },
        accent: {
          DEFAULT: 'var(--seed-accent)',
          pressed: 'var(--seed-accent-pressed)',
          subtle: 'var(--seed-accent-subtle)',
          fg: 'var(--seed-accent-fg)', // 액센트 표면 위 텍스트 (Vault 옐로 → 검정)
        },
        info: {
          DEFAULT: 'var(--seed-info)',
          subtle: 'var(--seed-info-subtle)',
        },
        success: {
          DEFAULT: 'var(--seed-success)',
          subtle: 'var(--seed-success-subtle)',
        },
        warning: {
          DEFAULT: 'var(--seed-warning)',
          subtle: 'var(--seed-warning-subtle)',
        },
        danger: {
          DEFAULT: 'var(--seed-danger)',
          subtle: 'var(--seed-danger-subtle)',
        },
      },
      borderRadius: {
        seed: '8px', // CTA·인풋 — 엔지니어드 톤 (파일럿: 10px)
        'seed-lg': '12px', // 카드 (파일럿: 16px)
        'seed-xl': '24px', // CTA 배너 패널
      },
      // 디스플레이는 타이트(1.17~1.21), 본문은 여유(1.5~1.71) — 이 대비가 브랜드 보이스.
      fontSize: {
        'display-md': ['40px', { lineHeight: '1.19', letterSpacing: '-0.025em' }],
        headline: ['28px', { lineHeight: '1.21', letterSpacing: '-0.021em' }],
        'card-title': ['22px', { lineHeight: '1.18', letterSpacing: '-0.018em' }],
        subhead: ['20px', { lineHeight: '1.35', letterSpacing: '-0.01em' }],
        'body-lg': ['18px', { lineHeight: '1.69' }],
        caption: ['13px', { lineHeight: '1.38', letterSpacing: '0.015em' }],
      },
      fontFamily: {
        sans: ['var(--seed-font-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
