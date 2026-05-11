/** @type {import('next').NextConfig} */
//
// Dois env vars distintos por design:
//
//   NEXT_PUBLIC_API_URL  — URL que o BROWSER usa (lib/api.ts).
//                          Padrão `/api` = same-origin → sem CORS, sem
//                          mixed content. Só sobrescreva se o frontend e o
//                          backend estiverem em domínios diferentes.
//
//   INTERNAL_API_URL     — URL que o SERVIDOR Next usa pra proxiar o rewrite
//                          `/api/*`. Padrão `http://localhost:3000/api` (gateway
//                          local). NÃO é exposta ao browser.
//
// Em produção típica (Nginx → Next na 3200, gateway na 3000), os defaults já
// funcionam — não precisa setar nenhuma das duas.
//
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // typedRoutes DESLIGADO por enquanto: Next 16 com type-checking estrito quebra
  // qualquer <Link href={`/customers/${id}`}> dinâmico — custo alto pra ganho
  // marginal em projeto que monta href em runtime constantemente. Reativar
  // numa janela dedicada de v1.1 com `as Route` cast em ~10 lugares.
  typedRoutes: false,
  // Em monorepo, o Next 16 procura por múltiplos package-lock.json e fica em
  // dúvida sobre qual diretório é o root. Apontamos explicitamente pro repo.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.INTERNAL_API_URL ?? 'http://localhost:3000/api'}/:path*`,
      },
    ];
  },
};

export default nextConfig;
