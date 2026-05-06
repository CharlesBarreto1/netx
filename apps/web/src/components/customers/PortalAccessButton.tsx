'use client';

import { Copy, KeyRound } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/sonner';
import { ApiError, api } from '@/lib/api';

/**
 * Botão "Portal" no detalhe do cliente.
 *
 * Operador clica → backend gera código de 8 chars + hash. O código aparece
 * UMA vez no modal pra ser copiado e passado pro cliente fora de banda
 * (WhatsApp, ligação). Se o operador fechar sem copiar, precisa gerar de
 * novo (invalida o anterior).
 */
export function PortalAccessButton({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    try {
      const res = await api.post<{ code: string; expiresAt: string }>(
        `/v1/customers/${customerId}/portal-access`,
      );
      setCode(res.code);
      setExpiresAt(res.expiresAt);
      setOpen(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : 'Error');
    } finally {
      setLoading(false);
    }
  }

  function copyCode() {
    if (!code) return;
    void navigator.clipboard?.writeText(code);
    toast.success('Código copiado');
  }

  function close() {
    setOpen(false);
    setCode(null);
    setExpiresAt(null);
  }

  return (
    <>
      <Button variant="outline" onClick={handleGenerate} loading={loading}>
        <KeyRound className="h-3.5 w-3.5" />
        Acceso al portal
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Código de acceso al portal"
        description="Pásale este código al cliente. Se mostrará una sola vez — si lo perdés, generá uno nuevo."
        footer={
          <Button onClick={close}>Cerrar</Button>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-4 text-center">
            <p className="font-mono text-3xl font-bold tracking-widest">
              {code}
            </p>
            <button
              type="button"
              onClick={copyCode}
              className="mt-2 inline-flex items-center gap-1 text-xs text-amber-800 dark:text-amber-300 hover:underline"
            >
              <Copy className="h-3 w-3" />
              Copiar
            </button>
          </div>
          {expiresAt && (
            <p className="text-xs text-text-muted">
              Válido hasta {new Date(expiresAt).toLocaleString('es-PY')}.
            </p>
          )}
          <p className="text-xs text-text-muted">
            URL del portal:{' '}
            <code className="font-mono">{typeof window !== 'undefined' ? `${window.location.origin}/portal/login` : '/portal/login'}</code>
          </p>
        </div>
      </Modal>
    </>
  );
}
