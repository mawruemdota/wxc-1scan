import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: { colors: { ink: '#092b2f', pine: '#0b766b', fog: '#f1f7f5' } } },
  plugins: []
} satisfies Config;
