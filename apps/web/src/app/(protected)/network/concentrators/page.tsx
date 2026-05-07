import { redirect } from 'next/navigation';

/**
 * Rota legada — substituída por POPs + Equipamentos. Redireciona pra
 * lista de equipamentos (caso de uso mais próximo do antigo "concentradores").
 */
export default function LegacyConcentratorsPage() {
  redirect('/network/equipment');
}
