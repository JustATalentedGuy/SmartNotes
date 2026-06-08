/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:      '#0d0d14',
        surface: '#13131f',
        card:    '#1a1a2a',
        border:  '#2a2a3d',
        muted:   '#52526e',
        accent:  { DEFAULT: '#6366f1', hover: '#4f52d4' },
        success: '#22c55e',
        warning: '#f59e0b',
        danger:  '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
