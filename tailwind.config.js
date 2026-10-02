/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        space: {
          950: 'rgb(var(--s950) / <alpha-value>)',
          900: 'rgb(var(--s900) / <alpha-value>)',
          800: 'rgb(var(--s800) / <alpha-value>)',
          700: 'rgb(var(--s700) / <alpha-value>)',
          600: 'rgb(var(--s600) / <alpha-value>)',
        },
        accent: {
          cyan: 'rgb(var(--c-cyan) / <alpha-value>)',
          violet: 'rgb(var(--c-violet) / <alpha-value>)',
          blue: 'rgb(var(--c-blue) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 24px -4px rgb(var(--c-cyan) / 0.35)',
        'glow-violet': '0 0 24px -4px rgb(var(--c-violet) / 0.35)',
      },
      keyframes: {
        twinkle: { '0%,100%': { opacity: '0.25' }, '50%': { opacity: '0.9' } },
        fall: {
          '0%': { transform: 'translate3d(0,-10vh,0) rotate(0deg)', opacity: '0' },
          '10%': { opacity: '0.9' },
          '90%': { opacity: '0.9' },
          '100%': { transform: 'translate3d(var(--dx,20px),110vh,0) rotate(var(--rot,360deg))', opacity: '0' },
        },
        float: {
          '0%': { transform: 'translate3d(0,10vh,0)', opacity: '0' },
          '10%': { opacity: '0.7' },
          '90%': { opacity: '0.7' },
          '100%': { transform: 'translate3d(var(--dx,20px),-110vh,0)', opacity: '0' },
        },
        rise: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        twinkle: 'twinkle 4s ease-in-out infinite',
        rise: 'rise 0.35s ease-out both',
      },
    },
  },
  plugins: [],
}
