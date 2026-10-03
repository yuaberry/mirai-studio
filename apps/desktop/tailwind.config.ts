import type { Config } from 'tailwindcss'

export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        mirai: {
          base: 'var(--bg-base)',
          raise: 'var(--bg-raise)',
          panel: 'var(--bg-panel)',
          hover: 'var(--bg-hover)',
          border: 'var(--border)',
          'border-strong': 'var(--border-strong)',
          text: 'var(--text)',
          dim: 'var(--text-dim)',
          faint: 'var(--text-faint)',
          accent: 'var(--accent)',
          'accent-2': 'var(--accent-2)',
          'accent-3': 'var(--accent-3)',
          success: 'var(--success)',
          warn: 'var(--warn)',
          danger: 'var(--danger)',
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk Variable"', 'Space Grotesk', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
