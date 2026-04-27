'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  FieldError,
  FieldHelp,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  dealsApi,
  type UpdateDealInput,
} from '@/lib/crm-sales-api';
import {
  DEAL_LOST_REASON_LABEL,
  DEAL_LOST_REASONS,
  type Deal,
  type DealHistoryEntry,
  type DealLostReason,
  type DealStatus,
  type Pipeline,
} from '@/lib/crm-sales-types';
import type { Customer, Paginated } from '@/lib/crm-types';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { hasPermission } from '@/lib/session';

import { ConvertDealDialog } from './ConvertDealDialog';

type TabKey = 'detalhes' | 'historico';

const STATUS_TONE: Record<DealStatus, 'info' | 'success' | 'danger'> = {
  OPEN: 'info',
  WON: 'success',
  LOST: 'danger',
};
const STATUS_LABEL: Record<DealStatus, string> = {
  OPEN: 'Em aberto',
  WON: 'Ganho',
  LOST: 'Perdido',
};

/**
 * DealDetailDialog — visualização e edição de um deal.
 *
 * Decisões:
 *   - Tabs `Detalhes` (form de edição) e `Histórico` (eventos do deal).
 *   - Edição inline; o submit chama PATCH /v1/crm/deals/:id.
 *   - Ações de ciclo: Ganhar (abre fluxo de conversão se ainda não tiver
 *     contrato), Perder (com motivo), Reabrir (quando WON/LOST), Excluir.
 *   - "Converter em cliente" é o caminho feliz quando o deal está OPEN: leva
 *     pro `ConvertDealDialog` que cria cliente (se preciso) + contrato e
 *     marca o deal como WON.
 */
export function DealDetailDialog({
  open,
  dealId,
  pipeline,
  onOpenChange,
  onMutated,
}: {
  open: boolean;
  dealId: string | null;
  pipeline: Pipeline | null;
  onOpenChange: (v: boolean) => void;
  /** Chamado após qualquer mutação para o board revalidar. */
  onMutated: () => void;
}) {
  const canWrite = hasPermission('deals.write');
  const canDelete = hasPermission('deals.delete');

  const dealKey = open && dealId ? dealsApi.getPath(dealId) : null;
  const { data: deal, isLoading, mutate: mutateDeal } = useSWR<Deal>(dealKey);

  const [tab, setTab] = useState<TabKey>('detalhes');
  const [convertOpen, setConvertOpen] = useState(false);
  const [loseOpen, setLoseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Reset tab quando o dialog fecha.
  useEffect(() => {
    if (!open) {
      setTab('detalhes');
      setConvertOpen(false);
      setLoseOpen(false);
      setReopenOpen(false);
      setDeleteOpen(false);
    }
  }, [open]);

  const items: TabItem<TabKey>[] = [
    { value: 'detalhes', label: 'Detalhes' },
    { value: 'historico', label: 'Histórico' },
  ];

  function handleSavedOrAction() {
    mutateDeal();
    onMutated();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle className="truncate">
                {deal?.title ?? (isLoading ? 'Carregando…' : 'Deal')}
              </DialogTitle>
              {deal && (
                <Badge tone={STATUS_TONE[deal.status]}>
                  {STATUS_LABEL[deal.status]}
                </Badge>
              )}
              {deal?.stage?.name && (
                <Badge tone="neutral">{deal.stage.name}</Badge>
              )}
            </div>
            <DialogDescription>
              {deal && deal.customer ? (
                <>
                  Cliente:{' '}
                  <Link
                    href={`/customers/${deal.customer.id}`}
                    className="font-medium text-text underline-offset-2 hover:underline"
                  >
                    {deal.customer.displayName}
                  </Link>
                </>
              ) : (
                <span className="text-text-muted">Sem cliente vinculado</span>
              )}
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <Tabs value={tab} onChange={setTab} items={items} />

            <div className="pt-4">
              {isLoading || !deal ? (
                <div className="flex items-center justify-center py-10">
                  <Spinner />
                </div>
              ) : tab === 'detalhes' ? (
                <DealEditForm
                  deal={deal}
                  pipeline={pipeline}
                  canWrite={canWrite}
                  onSaved={handleSavedOrAction}
                />
              ) : (
                <DealHistoryList dealId={deal.id} />
              )}
            </div>
          </DialogBody>

          {deal && (
            <DialogFooter className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                {canDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteOpen(true)}
                  >
                    Excluir
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {deal.status === 'OPEN' && canWrite && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setLoseOpen(true)}
                    >
                      Marcar como perdido
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => setConvertOpen(true)}
                    >
                      {deal.customerId
                        ? 'Gerar contrato e marcar como ganho'
                        : 'Converter em cliente'}
                    </Button>
                  </>
                )}
                {deal.status !== 'OPEN' && canWrite && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setReopenOpen(true)}
                  >
                    Reabrir
                  </Button>
                )}
              </div>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Conversão (cliente + contrato + win) */}
      {deal && (
        <ConvertDealDialog
          open={convertOpen}
          onOpenChange={setConvertOpen}
          deal={deal}
          onConverted={() => {
            setConvertOpen(false);
            handleSavedOrAction();
          }}
        />
      )}

      {/* Perder deal */}
      {deal && (
        <LoseDealDialog
          open={loseOpen}
          onOpenChange={setLoseOpen}
          dealId={deal.id}
          onDone={() => {
            setLoseOpen(false);
            handleSavedOrAction();
          }}
        />
      )}

      {/* Reabrir */}
      {deal && pipeline && (
        <ReopenDealDialog
          open={reopenOpen}
          onOpenChange={setReopenOpen}
          deal={deal}
          pipeline={pipeline}
          onDone={() => {
            setReopenOpen(false);
            handleSavedOrAction();
          }}
        />
      )}

      {/* Excluir */}
      {deal && (
        <ConfirmDialog
          open={deleteOpen}
          title="Excluir deal?"
          message="Esta ação remove o deal do pipeline. Histórico fica preservado para auditoria."
          confirmLabel="Excluir"
          variant="danger"
          onClose={() => setDeleteOpen(false)}
          onConfirm={async () => {
            try {
              await dealsApi.remove(deal.id);
              toast.success('Deal excluído');
              setDeleteOpen(false);
              onOpenChange(false);
              onMutated();
            } catch (err) {
              const msg =
                err instanceof ApiError ? err.friendlyMessage : 'Falha ao excluir';
              toast.error(msg);
            }
          }}
        />
      )}
    </>
  );
}

// =============================================================================
// Form de edição
// =============================================================================
function DealEditForm({
  deal,
  pipeline,
  canWrite,
  onSaved,
}: {
  deal: Deal;
  pipeline: Pipeline | null;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(deal.title);
  const [description, setDescription] = useState(deal.description ?? '');
  const [value, setValue] = useState(String(deal.value ?? ''));
  const [currency, setCurrency] = useState(deal.currency);
  const [probability, setProbability] = useState<string>(
    deal.probability !== null && deal.probability !== undefined
      ? String(deal.probability)
      : '',
  );
  const [expectedCloseAt, setExpectedCloseAt] = useState(
    deal.expectedCloseAt ? deal.expectedCloseAt.slice(0, 10) : '',
  );
  const [customerId, setCustomerId] = useState<string | null>(deal.customerId);
  const [customerSearch, setCustomerSearch] = useState(
    deal.customer?.displayName ?? '',
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset quando o deal muda (revalidação).
  useEffect(() => {
    setTitle(deal.title);
    setDescription(deal.description ?? '');
    setValue(String(deal.value ?? ''));
    setCurrency(deal.currency);
    setProbability(
      deal.probability !== null && deal.probability !== undefined
        ? String(deal.probability)
        : '',
    );
    setExpectedCloseAt(deal.expectedCloseAt ? deal.expectedCloseAt.slice(0, 10) : '');
    setCustomerId(deal.customerId);
    setCustomerSearch(deal.customer?.displayName ?? '');
  }, [deal]);

  // Busca incremental de clientes (só dispara se não bate com o já selecionado).
  const customerKey =
    customerSearch.trim().length >= 2 &&
    customerSearch !== (deal.customer?.displayName ?? '')
      ? `/v1/customers?search=${encodeURIComponent(customerSearch.trim())}&pageSize=8`
      : null;
  const { data: customerHits } = useSWR<Paginated<Customer>>(customerKey);
  const customerOptions = customerHits?.data ?? [];

  const stages = useMemo(() => pipeline?.stages ?? [], [pipeline]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    if (!title.trim()) {
      setError('Informe um título');
      return;
    }

    const patch: UpdateDealInput = {
      title: title.trim(),
      description: description.trim() ? description.trim() : null,
      currency,
    };
    const num = Number(String(value).replace(',', '.'));
    if (Number.isFinite(num) && num >= 0) patch.value = num;
    const prob = probability.trim() ? Number(probability) : null;
    patch.probability = prob;
    patch.expectedCloseAt = expectedCloseAt ? expectedCloseAt : null;
    // Só mexe em customerId se o usuário realmente trocou o cliente — evita
    // desvincular um cliente vinculado quando o texto da busca está dessincado.
    if (customerId !== deal.customerId) {
      patch.customerId = customerId;
    }

    setSubmitting(true);
    setError(null);
    try {
      await dealsApi.update(deal.id, patch);
      toast.success('Deal atualizado');
      onSaved();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.friendlyMessage : 'Falha ao salvar';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const stageInfo = stages.find((s) => s.id === deal.stageId);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <Label htmlFor="d-title" required>
          Título
        </Label>
        <Input
          id="d-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          disabled={!canWrite}
        />
      </div>

      <div className="grid grid-cols-[1fr,80px,120px] gap-2">
        <div>
          <Label htmlFor="d-value">Valor</Label>
          <Input
            id="d-value"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label htmlFor="d-currency">Moeda</Label>
          <Select
            id="d-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            disabled={!canWrite}
          >
            <option value="BRL">BRL</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="ARS">ARS</option>
            <option value="PYG">PYG</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="d-prob">Probabilidade</Label>
          <Input
            id="d-prob"
            inputMode="numeric"
            placeholder="0–100"
            value={probability}
            onChange={(e) => setProbability(e.target.value)}
            disabled={!canWrite}
          />
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div>
          <Label htmlFor="d-expected">Fechamento previsto</Label>
          <Input
            id="d-expected"
            type="date"
            value={expectedCloseAt}
            onChange={(e) => setExpectedCloseAt(e.target.value)}
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label>Estágio atual</Label>
          <div className="flex h-9 items-center rounded-md border border-border bg-surface-muted px-3 text-sm text-text">
            {stageInfo?.name ?? deal.stage?.name ?? '—'}
          </div>
          <FieldHelp>Use o board para mover entre estágios.</FieldHelp>
        </div>
      </div>

      <div>
        <Label htmlFor="d-customer">Cliente</Label>
        <Input
          id="d-customer"
          placeholder="Buscar por nome…"
          value={customerSearch}
          onChange={(e) => {
            setCustomerSearch(e.target.value);
            // Limpa o ID se o usuário trocou o texto.
            if (
              deal.customer?.displayName !== e.target.value ||
              !deal.customer
            ) {
              setCustomerId(null);
            }
          }}
          disabled={!canWrite}
        />
        {customerOptions.length > 0 && (
          <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-surface">
            {customerOptions.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => {
                  setCustomerId(c.id);
                  setCustomerSearch(c.displayName);
                }}
                className={
                  'flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-hover ' +
                  (customerId === c.id ? 'bg-accent-muted text-accent' : 'text-text')
                }
              >
                <span className="truncate">{c.displayName}</span>
                <span className="shrink-0 text-2xs text-text-subtle">
                  {c.primaryEmail ?? c.primaryPhone ?? ''}
                </span>
              </button>
            ))}
          </div>
        )}
        <FieldHelp>
          Para criar um cliente novo, use “Converter em cliente” no rodapé.
        </FieldHelp>
      </div>

      <div>
        <Label htmlFor="d-desc">Descrição</Label>
        <Textarea
          id="d-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          disabled={!canWrite}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
        <span>
          Valor atual: <strong>{formatMoney(deal.value, deal.currency)}</strong>
        </span>
        {deal.expectedCloseAt && (
          <span>
            Previsto: <strong>{formatDate(deal.expectedCloseAt)}</strong>
          </span>
        )}
        {deal.owner?.name && (
          <span>
            Owner: <strong>{deal.owner.name}</strong>
          </span>
        )}
      </div>

      {error && <FieldError>{error}</FieldError>}

      <div className="flex justify-end pt-1">
        <Button type="submit" loading={submitting} disabled={!canWrite}>
          Salvar alterações
        </Button>
      </div>
    </form>
  );
}

// =============================================================================
// Histórico
// =============================================================================
function DealHistoryList({ dealId }: { dealId: string }) {
  const { data, isLoading } = useSWR<DealHistoryEntry[]>(dealsApi.historyPath(dealId));
  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner />
      </div>
    );
  }
  if (data.length === 0) {
    return <p className="text-sm text-text-muted">Nenhum evento registrado.</p>;
  }
  return (
    <ul className="flex flex-col gap-3 text-sm">
      {data.map((h) => (
        <li
          key={h.id}
          className="rounded-md border border-border bg-surface-muted/40 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-text">
              {h.fromStatus ?? 'OPEN'} → {h.toStatus}
            </span>
            <span className="text-xs text-text-muted">
              {formatDateTime(h.createdAt)}
            </span>
          </div>
          {h.changedByName && (
            <p className="mt-1 text-xs text-text-muted">por {h.changedByName}</p>
          )}
          {h.reason && <p className="mt-1 text-xs text-text">{h.reason}</p>}
        </li>
      ))}
    </ul>
  );
}

// =============================================================================
// Lose dialog
// =============================================================================
function LoseDealDialog({
  open,
  onOpenChange,
  dealId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dealId: string;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<DealLostReason>('OTHER');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('OTHER');
      setNote('');
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await dealsApi.lose(dealId, { reason, note: note.trim() || undefined });
      toast.success('Deal marcado como perdido');
      onDone();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : 'Falha ao marcar';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Marcar deal como perdido</DialogTitle>
            <DialogDescription>
              Registre o motivo para alimentar o relatório de perdas.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div>
              <Label htmlFor="lose-reason" required>
                Motivo
              </Label>
              <Select
                id="lose-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as DealLostReason)}
              >
                {DEAL_LOST_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {DEAL_LOST_REASON_LABEL[r]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="lose-note">Observação (opcional)</Label>
              <Textarea
                id="lose-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="danger" loading={submitting}>
              Confirmar perda
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Reopen dialog
// =============================================================================
function ReopenDealDialog({
  open,
  onOpenChange,
  deal,
  pipeline,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  deal: Deal;
  pipeline: Pipeline;
  onDone: () => void;
}) {
  const openStages = useMemo(
    () => pipeline.stages.filter((s) => !s.isWon && !s.isLost),
    [pipeline],
  );
  const [stageId, setStageId] = useState<string>(openStages[0]?.id ?? '');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && openStages[0]) setStageId(openStages[0].id);
  }, [open, openStages]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stageId) return;
    setSubmitting(true);
    try {
      await dealsApi.reopen(deal.id, { stageId });
      toast.success('Deal reaberto');
      onDone();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : 'Falha ao reabrir';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Reabrir deal</DialogTitle>
            <DialogDescription>
              Selecione o estágio para o qual o deal voltará.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div>
              <Label htmlFor="reopen-stage" required>
                Estágio
              </Label>
              <Select
                id="reopen-stage"
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
              >
                {openStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={submitting} disabled={!stageId}>
              Reabrir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
