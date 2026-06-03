import type { Config } from 'tailwindcss';

/**
 * seed-design–inspired semantic tokens.
 * Colors resolve to CSS variables declared in src/app/globals.css so the palette can be
 * themed in one place. Roles mirror Daangn seed-design conventions (bg layers, neutral
 * foreground scale, a carrot accent, plus success/warning for the review badges).
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: 'var(--seed-bg)',
          layer: 'var(--seed-bg-layer)',
          elevated: 'var(--seed-bg-elevated)',
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
        seed: '10px',
        'seed-lg': '16px',
      },
      fontFamily: {
        sans: ['var(--seed-font-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
