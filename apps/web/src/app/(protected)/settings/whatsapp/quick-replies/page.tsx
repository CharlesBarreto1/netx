'use client';

import { Plus, Pencil, Trash2, Users, User as UserIcon, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  createQuickReply,
  deleteQuickReply,
  listQuickReplies,
  updateQuickReply,
  QUICK_REPLY_CATEGORIES,
  type QuickReplyInput,
  type WaQuickReply,
} from '@/lib/whatsapp-api';

/**
 * /settings/whatsapp/quick-replies — cadastro e edição de mensagens predefinidas
 * (respostas rápidas) do atendimento: saudações, encerramentos, negativa de
 * viabilidade, planos, prazos.
 *
 * Dois escopos: COMPARTILHADA (equipe — exige chat.admin) e PESSOAL (do operador,
 * exige chat.send). No chat, o atendente insere com 1 clique no compositor.
 */
export default function QuickRepliesPage() {
  const t = useTranslations('chat.quickRepliesAdmin');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const canUse = hasPermission('chat.send');
  const canManageShared = hasPermission('chat.admin');

  const [editing, setEditing] = useState<WaQuickReply | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<WaQuickReply | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const query = useSWR<WaQuickReply[]>('/whatsapp/quick-replies', () => listQuickReplies());

  if (!canUse) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
        {t('noPermission')}
      </div>
    );
  }

  if (query.isLoading) return <PageLoader />;

  const items = query.data ?? [];
  const shared = items.filter((q) => q.ownerUserId === null);
  const personal = items.filter((q) => q.ownerUserId !== null);

  // Rótulo traduzido da categoria (chaves literais p/ type-safety; cru se desconhecida).
  const catLabel = (cat: string): string => {
    switch (cat) {
      case 'saudacao': return t('cat.saudacao');
      case 'encerramento': return t('cat.encerramento');
      case 'viabilidade': return t('cat.viabilidade');
      case 'planos': return t('cat.planos');
      case 'prazos': return t('cat.prazos');
      case 'geral': return t('cat.geral');
      default: return cat;
    }
  };

  async function addSuggestions() {
    if (seeding) return;
    setSeeding(true);
    try {
      const suggestions = suggestionsFor(locale);
      let n = 0;
      for (const s of suggestions) {
        await createQuickReply(s);
        n++;
      }
      toast.success(t('seeded', { n }));
      await query.mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        <div className="flex gap-2">
          {canManageShared && shared.length === 0 && (
            <Button variant="outline" onClick={() => void addSuggestions()} loading={seeding}>
              <Sparkles className="mr-1 h-4 w-4" />
              {t('addSuggestions')}
            </Button>
          )}
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('new')}
          </Button>
        </div>
      </header>

      <Section
        icon={<Users className="h-4 w-4" />}
        title={t('sharedTitle')}
        hint={t('sharedHint')}
        items={shared}
        emptyText={t('sharedEmpty')}
        canEdit={canManageShared}
        onEdit={setEditing}
        onDelete={setToDelete}
        catLabel={catLabel}
      />

      <Section
        icon={<UserIcon className="h-4 w-4" />}
        title={t('personalTitle')}
        hint={t('personalHint')}
        items={personal}
        emptyText={t('personalEmpty')}
        canEdit
        onEdit={setEditing}
        onDelete={setToDelete}
        catLabel={catLabel}
      />

      {(creating || editing) && (
        <QuickReplyForm
          initial={editing}
          canManageShared={canManageShared}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void query.mutate();
          }}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        loading={deleting}
        variant="danger"
        title={t('deleteTitle')}
        message={t('deleteMsg', { title: toDelete?.title ?? '' })}
        confirmLabel={tCommon('delete')}
        onConfirm={async () => {
          if (!toDelete) return;
          setDeleting(true);
          try {
            await deleteQuickReply(toDelete.id);
            toast.success(t('deleted'));
            setToDelete(null);
            await query.mutate();
          } catch (err) {
            toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
          } finally {
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}

function Section({
  icon,
  title,
  hint,
  items,
  emptyText,
  canEdit,
  onEdit,
  onDelete,
  catLabel,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  items: WaQuickReply[];
  emptyText: string;
  canEdit: boolean;
  onEdit: (q: WaQuickReply) => void;
  onDelete: (q: WaQuickReply) => void;
  catLabel: (c: string) => string;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-text-muted">{icon}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <p className="mb-3 text-xs text-text-muted">{hint}</p>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-text-muted dark:border-slate-700">
          {emptyText}
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((q) => (
            <li
              key={q.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{q.title}</span>
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {catLabel(q.category)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-text-muted">{q.body}</p>
              </div>
              {canEdit && (
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onEdit(q)}
                    className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                    title=""
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(q)}
                    className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-700"
                    title=""
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function QuickReplyForm({
  initial,
  canManageShared,
  onClose,
  onSaved,
}: {
  initial: WaQuickReply | null;
  canManageShared: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('chat.quickRepliesAdmin');
  const tCommon = useTranslations('common');
  const [scope, setScope] = useState<'shared' | 'personal'>(
    initial ? (initial.ownerUserId === null ? 'shared' : 'personal') : canManageShared ? 'shared' : 'personal',
  );
  const [category, setCategory] = useState(initial?.category ?? 'geral');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [busy, setBusy] = useState(false);

  const valid = title.trim().length > 0 && body.trim().length > 0;

  const catLabel = (cat: string): string => {
    switch (cat) {
      case 'saudacao': return t('cat.saudacao');
      case 'encerramento': return t('cat.encerramento');
      case 'viabilidade': return t('cat.viabilidade');
      case 'planos': return t('cat.planos');
      case 'prazos': return t('cat.prazos');
      case 'geral': return t('cat.geral');
      default: return cat;
    }
  };

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const input: QuickReplyInput = { scope, category, title: title.trim(), body: body.trim() };
      if (initial) {
        await updateQuickReply(initial.id, input);
        toast.success(t('saved'));
      } else {
        await createQuickReply(input);
        toast.success(t('created'));
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? t('editTitle') : t('newTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!valid}>
            {tCommon('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="qr-scope">{t('scope')}</Label>
            <Select
              id="qr-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'shared' | 'personal')}
            >
              {canManageShared && <option value="shared">{t('scopeShared')}</option>}
              <option value="personal">{t('scopePersonal')}</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="qr-cat">{t('category')}</Label>
            <Select id="qr-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {QUICK_REPLY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {catLabel(c)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="qr-title" required>
            {t('titleField')}
          </Label>
          <Input
            id="qr-title"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('titlePlaceholder')}
          />
        </div>
        <div>
          <Label htmlFor="qr-body" required>
            {t('bodyField')}
          </Label>
          <Textarea
            id="qr-body"
            value={body}
            rows={6}
            maxLength={4096}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('bodyPlaceholder')}
          />
          <p className="mt-1 text-xs text-text-muted">{t('vars')}</p>
        </div>
      </div>
    </Modal>
  );
}

/** Sugestões iniciais por idioma (texto real enviado ao cliente). */
function suggestionsFor(locale: string): QuickReplyInput[] {
  const es = locale.startsWith('es');
  if (es) {
    return [
      { scope: 'shared', category: 'saudacao', title: 'Saludo inicial', body: '¡Hola! Soy {operador}. ¿En qué puedo ayudarte hoy? 😊' },
      { scope: 'shared', category: 'encerramento', title: 'Cierre de atención', body: '¡Fue un gusto atenderte! Quedamos a tu disposición. ¡Que tengas un excelente día! 🙌' },
      { scope: 'shared', category: 'viabilidade', title: 'Sin cobertura', body: 'Lamentablemente todavía no tenemos cobertura en tu dirección. 😔 Registramos tu interés y te avisaremos en cuanto la red llegue a tu zona.' },
      { scope: 'shared', category: 'planos', title: 'Planes y precios', body: 'Nuestros planes:\n• 300 MB\n• 500 MB\n• 1 GB\nTodos con Wi-Fi incluido y soporte local. ¿Cuál te conviene más?' },
      { scope: 'shared', category: 'prazos', title: 'Plazo de instalación', body: 'El plazo de instalación es de hasta 48h hábiles luego de la confirmación. ¡Te mantendré informado en cada etapa! 🛠️' },
    ];
  }
  return [
    { scope: 'shared', category: 'saudacao', title: 'Saudação inicial', body: 'Olá! Aqui é {operador}. Como posso ajudar você hoje? 😊' },
    { scope: 'shared', category: 'encerramento', title: 'Encerramento', body: 'Foi um prazer atender você! Qualquer coisa, estamos à disposição. Tenha um ótimo dia! 🙌' },
    { scope: 'shared', category: 'viabilidade', title: 'Sem viabilidade', body: 'Infelizmente ainda não temos cobertura no seu endereço. 😔 Já registramos seu interesse e avisaremos assim que a rede chegar à sua região.' },
    { scope: 'shared', category: 'planos', title: 'Planos e valores', body: 'Nossos planos:\n• 300 MB\n• 500 MB\n• 1 GB\nTodos com Wi-Fi grátis e suporte local. Qual te atende melhor?' },
    { scope: 'shared', category: 'prazos', title: 'Prazo de instalação', body: 'O prazo para instalação é de até 48h úteis após a confirmação. Vou te manter informado em cada etapa! 🛠️' },
  ];
}
