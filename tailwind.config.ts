import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Triplets RGB pilotés par CSS vars (cf globals.css) — requis pour
        // bg-primary/10 etc. (le navigateur ne peut pas lire une var dans
        // une couleur rgba Tailwind compile en `rgb(var(--x) / .NN)`).
        background: 'rgb(var(--background-rgb) / <alpha-value>)',
        'background-soft': 'rgb(var(--background-soft-rgb) / <alpha-value>)',
        foreground: 'rgb(var(--foreground-rgb) / <alpha-value>)',
        primary: 'rgb(var(--primary-rgb) / <alpha-value>)',
        'primary-on-dark': 'rgb(var(--primary-on-dark-rgb) / <alpha-value>)',
        secondary: 'rgb(var(--secondary-rgb) / <alpha-value>)',
        'secondary-on-dark': 'rgb(var(--secondary-on-dark-rgb) / <alpha-value>)',
        alert: 'rgb(var(--alert-rgb) / <alpha-value>)',
        // Base plateforme, valeurs complètes (pas d'utilitaire d'opacité requis)
        'foreground-muted': 'var(--foreground-muted)',
        'foreground-secondary': 'var(--foreground-secondary)',
        card: 'var(--card)',
        border: 'var(--border)',
        'border-control': 'var(--border-control)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        pill: 'var(--radius-pill)',
      },
      fontFamily: {
        display: ['var(--font-bricolage)', 'system-ui', 'sans-serif'],
        body: ['var(--font-geist)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
