import { fileURLToPath } from 'node:url';

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
  // Next 16 passou a rodar `tsc` durante `next build` e quebra em erros
  // pré-existentes de duplicação de @types/react no monorepo Nx: apps/web
  // tem v19 (Next 16 exige) e o root tem v18 hoisted pelo react-native do
  // apps/mobile. Os tipos divergem e o build para em 700+ erros TS2786/TS2322.
  // Fix correto pra eliminar: overrides forçando v19 globalmente + regenerar
  // package-lock.json. Workaround sem mexer lockfile: typecheck roda à parte
  // via `npm run typecheck` (que tolera os warnings).
  typescript: {
    ignoreBuildErrors: true,
  },
  // typedRoutes DESLIGADO por enquanto: Next 16 com type-checking estrito quebra
  // qualquer <Link href={`/customers/${id}`}> dinâmico — custo alto pra ganho
  // marginal em projeto que monta href em runtime constantemente. Reativar
  // numa janela dedicada de v1.1 com `as Route` cast em ~10 lugares.
  typedRoutes: false,
  // Em monorepo, o Next 16 procura por múltiplos package-lock.json e fica em
  // dúvida sobre qual diretório é o root. Apontamos explicitamente pro repo.
  //
  // fileURLToPath, NÃO `.pathname`: pathname devolve a URL percent-encoded, então
  // um checkout em caminho com espaço ou acento (ex.: "~/Área de trabalho/NetX")
  // vira "/home/user/%C3%81rea%20de%20trabalho/NetX" — diretório que não existe.
  // O Turbopack então falha no boot com "Invalid distDirRoot: '.next'". Em
  // /opt/netx passava por acaso, por ser ASCII puro e sem espaços.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
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
