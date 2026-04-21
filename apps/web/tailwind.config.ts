import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff8ff',
          100: '#dbeefe',
          200: '#bcdcff',
          300: '#93c5fd',
          400: '#4d9dfb',
          500: '#0d6efd',
          600: '#0b5ed7',
          700: '#0a58ca',
          800: '#0a4aa3',
          900: '#083a80',
        },
      },
    },
  },
  plugins: [],
};

export default config;
