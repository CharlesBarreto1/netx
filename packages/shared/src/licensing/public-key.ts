/**
 * Chave PÚBLICA Ed25519 usada pra verificar o token de licença assinado pelo
 * Hub (netx-hub). A privada correspondente vive SÓ no Hub — nunca neste repo.
 *
 * Formato: SPKI/DER em base64. Trocar esta chave = rotação de chave de
 * licenciamento: exige atualizar o NetX dos clientes (`sudo netx-update`).
 * Por isso é evento raro e planejado.
 *
 * ⚠️ Esta é a chave de DEV (gerada 2026-06-10). Para produção, gere um novo par
 * (ver docs/licensing.md), guarde a privada no cofre do Hub e substitua o valor
 * abaixo pela pública nova.
 */
export const LICENSE_PUBLIC_KEY_SPKI_B64 =
  'MCowBQYDK2VwAyEAKALs/wCTJKX34/ELwAEfj488wtQq3ykgJjV5xXc7FSE=';
