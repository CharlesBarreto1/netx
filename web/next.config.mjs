/** @type {import('next').NextConfig} */
const nextConfig = {
  // O app web do Hub fala com a API do Hub. Em dev, default :4000.
  // Em prod, aponte NEXT_PUBLIC_HUB_API pra URL pública da API.
  reactStrictMode: true,
};

export default nextConfig;
