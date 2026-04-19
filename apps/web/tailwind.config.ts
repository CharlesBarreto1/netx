import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff8ff',
          100: '#dbeefe',
          500: '#0d6efd',
          600: '#0b5ed7',
          700: '#0a58ca',
        },
      },
    },
  },
  plugins: [],
};

export default config;
