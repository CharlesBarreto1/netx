// Tailwind 4 — usa o plugin @tailwindcss/postcss em vez do velho `tailwindcss`.
// Autoprefixer não é mais necessário (Tailwind 4 já trata vendor prefixes).
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
