'use client';

/**
 * Card de equipamentos em comodato no contrato.
 *
 * Mostra os SerialItems atualmente ALOCADOS nesse contrato + ações pra alocar
 * novo equipamento ou devolver um existente.
 *
 * Visibilidade: respeita `stock.read`. Botões de alocar/devolver respeitam
 * `stock.write` (e a ACL de local é checada no backend).
 */
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label, Textarea } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  stockApi,
  type ComodatoAvailableSerial,
  type ComodatoSerial,
  type StockLocation,
} from '@/lib/stock-api';

export function ContractComodatoCard({ contractId }: { contractId: string }) {
  const { data, isLoading, error, mutate } = useSWR<ComodatoSerial[]>(
    stockApi.comodatoByContractPath(contractId),
    () => stockApi.listComodatoByContract(contractId),
  );

  const canWrite = hasPermission('stock.write');

  const [allocating, setAllocating] = useState(false);
  const [returning, setReturning] = useState<ComodatoSerial | null>(null);

  if (!hasPermission('stock.read')) return null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-text-muted">
          Equipamentos patrimoniais vinculados a este contrato (status =
          ALLOCATED).
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setAllocating(true)}>
            Adicionar equipamento
          </Button>
        )}
      </div>

      {isLoading && <Spinner />}
      {error && (
        <div className="text-sm text-red-600">Falha ao carregar comodatos.</div>
      )}

      {data && data.length === 0 && (
        <p className="text-sm text-text-muted italic">
          Nenhum equipamento em comodato.
        </p>
      )}

      {data && data.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-soft">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th className="px-3 py-2">Produto</th>
                <th className="px-3 py-2">Serial</th>
                <th className="px-3 py-2">Alocado em</th>
                {canWrite && <th className="px-3 py-2 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((s) => (
                <tr key={s.id} className="hover:bg-bg-soft">
                  <td className="px-3 py-2">
                    <strong>{s.product.name}</strong>
                    {(s.product.brand || s.product.model) && (
                      <p className="text-xs text-text-muted">
                        {[s.product.brand, s.product.model]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    <p className="text-xs text-text-muted font-mono">
                      SKU: {s.product.sku}
                    </p>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{s.serial}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">
                    {s.allocatedAt
                      ? new Date(s.allocatedAt).toLocaleString()
                      : '—'}
                  </td>
                  {canWrite && (
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setReturning(s)}
                      >
                        Devolver
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {allocating && (
        <AllocateModal
          contractId={contractId}
          onClose={() => setAllocating(false)}
          onSaved={async () => {
            setAllocating(false);
            await mutate();
          }}
        />
      )}

      {returning && (
        <ReturnModal
          serial={returning}
          onClose={() => setReturning(null)}
          onSaved={async () => {
            setReturning(null);
            await mutate();
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// ALLOCATE — escolhe serial disponível
// =============================================================================
function AllocateModal({
  contractId,
  onClose,
  onSaved,
}: {
  contractId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: available, isLoading } = useSWR<ComodatoAvailableSerial[]>(
    '/v1/stock/comodato/available',
    () => stockApi.listComodatoAvailable(),
  );

  const [serialItemId, setSerialItemId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!serialItemId) return setError('Selecione um equipamento');
    setSubmitting(true);
    try {
      await stockApi.allocateComodato({
        contractId,
        serialItemId,
        notes: notes || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro ao alocar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Alocar equipamento em comodato">
      <form onSubmit={handleSubmit} className="space-y-3">
        {isLoading && <Spinner />}

        {available && available.length === 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Nenhum equipamento patrimonial disponível em estoque. Cadastre uma
            compra ou veja se há seriais em outros locais que você não tem
            acesso.
          </div>
        )}

        {available && available.length > 0 && (
          <div>
            <Label>Equipamento *</Label>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={serialItemId}
              onChange={(e) => setSerialItemId(e.target.value)}
              required
            >
              <option value="">—</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.product.sku} · {s.product.name} — SN: {s.serial} ({s.location.code})
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <Label>Observações</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex: entregue na instalação OS-1234"
          />
        </div>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            loading={submitting}
            disabled={!serialItemId}
          >
            Alocar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// =============================================================================
// RETURN — escolhe local destino
// =============================================================================
function ReturnModal({
  serial,
  onClose,
  onSaved,
}: {
  serial: ComodatoSerial;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: locations } = useSWR<StockLocation[]>(
    stockApi.locationsPath({ isActive: true }),
    () => stockApi.listLocations({ isActive: true }),
  );

  const [toLocationId, setToLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!toLocationId) return setError('Escolha o local de destino');
    setSubmitting(true);
    try {
      await stockApi.returnComodato({
        serialItemId: serial.id,
        toLocationId,
        notes: notes || null,
      });
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.friendlyMessage : 'Erro ao devolver',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Devolver equipamento ao estoque">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="rounded-md bg-bg-soft p-3 text-sm">
          <div>
            <strong>{serial.product.name}</strong>
          </div>
          <div className="text-xs text-text-muted">
            SKU: {serial.product.sku} · Serial:{' '}
            <span className="font-mono">{serial.serial}</span>
          </div>
        </div>

        <div>
          <Label>Local destino *</Label>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            value={toLocationId}
            onChange={(e) => setToLocationId(e.target.value)}
            required
          >
            <option value="">—</option>
            {locations?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} — {l.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label>Observações</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex: cliente cancelou contrato; equipamento sem avarias"
          />
        </div>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button type="submit" loading={submitting} disabled={!toLocationId}>
            Devolver
          </Button>
        </div>
      </form>
    </Modal>
  );
}
