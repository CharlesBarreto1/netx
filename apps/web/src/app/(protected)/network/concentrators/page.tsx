'use client';

import { Server } from 'lucide-react';

/**
 * /network/concentrators — placeholder pra cadastro de BNGs / OLTs.
 *
 * Roadmap (quando entrar): CRUD de equipamentos com IP, vendor, secret RADIUS,
 * automação de provisionamento. Hoje serve só pra reservar a rota e o
 * caminho na sidebar — a próxima fase de Rede vai sentar aqui.
 */
export default function ConcentratorsPage() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Concentradores</h1>
        <p className="text-sm text-text-muted">
          Gestión de BNGs / OLTs / equipos de borde de la red.
        </p>
      </header>

      <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
        <Server className="mx-auto h-10 w-10 text-text-muted" />
        <h2 className="mt-3 text-lg font-semibold">En desarrollo</h2>
        <p className="mt-1 max-w-md mx-auto text-sm text-text-muted">
          Esta página será el cadastro de equipos de red con IP, vendor
          (Mikrotik, Huawei, ZTE...), secret RADIUS y automación de
          provisionamiento. Reservada para la próxima iteración.
        </p>
      </div>
    </div>
  );
}
