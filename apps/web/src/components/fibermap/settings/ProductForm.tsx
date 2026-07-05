'use client';

/**
 * ProductForm — form genérico das categorias não-cabo do catálogo FiberMap
 * (CEO, CTO, DIO, Armário, Rack Interno, Splitter — spec §3.2/§10).
 *
 * Os campos de `specs` são declarativos (SPEC_FIELDS em catalog-shared.ts):
 * int com faixa, texto, booleano e select — incluindo campo condicional
 * (tap_percent só quando topologia UNBALANCED).
 *
 * Diferente do cabo, specs destas categorias PODEM ser editadas via
 * updateProduct — mas instâncias em campo permanecem como criadas (snapshot,
 * spec §14.8): banner fixo avisa quando instancesCount > 0.
 */
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import {
  FieldError,
  FieldHelp,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fibermapApi, type FibermapProduct } from '@/lib/fibermap-api';

import {
  SPEC_DEFAULTS,
  SPEC_FIELDS,
  specsToFormValues,
  toInt,
  type CatalogFormMode,
  type FibermapNonCableType,
  type SpecFormValues,
} from './catalog-shared';

const FORM_ID = 'fibermap-product-form';

export interface ProductFormProps {
  type: FibermapNonCableType;
  mode: CatalogFormMode;
  /** Produto de origem — obrigatório em edit/duplicate. */
  initial: FibermapProduct | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function ProductForm({ type, mode, initial, onClose, onSaved }: ProductFormProps) {
  const t = useTranslations('fibermap');
  const tCommon = useTranslations('common');

  const instancesCount = initial?.instancesCount ?? 0;
  const fields = SPEC_FIELDS[type];

  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? 'Padrão');
  const [name, setName] = useState(() =>
    mode === 'duplicate' && initial
      ? t('settings.catalog.copyName', { name: initial.name })
      : (initial?.name ?? ''),
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [values, setValues] = useState<SpecFormValues>(() =>
    mode === 'create'
      ? { ...SPEC_DEFAULTS[type] }
      : specsToFormValues(type, initial?.specs ?? {}),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  function setValue(key: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function isVisible(field: (typeof fields)[number]): boolean {
    return field.visibleIf ? field.visibleIf(values) : true;
  }

  /** Monta o objeto `specs` validado, ou null (setando os erros por campo). */
  function buildSpecs(): Record<string, unknown> | null {
    const specs: Record<string, unknown> = {};
    const nextErrors: Record<string, string> = {};
    for (const field of fields) {
      if (!isVisible(field)) continue;
      const raw = values[field.key];
      if (field.kind === 'bool') {
        specs[field.key] = raw === true;
        continue;
      }
      if (field.kind === 'int') {
        const n = typeof raw === 'string' ? toInt(raw) : null;
        if (n === null || n < field.min || n > field.max) {
          nextErrors[field.key] = t('settings.form.intRange', {
            min: field.min,
            max: field.max,
          });
          continue;
        }
        specs[field.key] = n;
        continue;
      }
      // text | select
      const s = typeof raw === 'string' ? raw.trim() : '';
      if (s) specs[field.key] = s;
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length > 0 ? null : specs;
  }

  function errorMessage(err: unknown): string {
    return err instanceof ApiError ? err.friendlyMessage : t('settings.genericError');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t('settings.form.nameRequired'));
      return;
    }
    const specs = buildSpecs();
    if (!specs) {
      toast.error(t('settings.form.invalidNumbers'));
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'edit') {
        if (!initial) return;
        await fibermapApi.updateProduct(initial.id, {
          manufacturer: manufacturer.trim() || 'Padrão',
          name: name.trim(),
          description: description.trim() ? description.trim() : null,
          specs,
        });
        toast.success(t('settings.catalog.saved'));
      } else {
        await fibermapApi.createProduct({
          type,
          manufacturer: manufacturer.trim() || 'Padrão',
          name: name.trim(),
          description: description.trim() ? description.trim() : null,
          specs,
        });
        toast.success(t('settings.catalog.created'));
      }
      await onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const categoryName = t(`settings.catalog.categorySingular.${type}`);
  const title =
    mode === 'edit'
      ? t('settings.product.formTitleEdit', { category: categoryName })
      : mode === 'duplicate'
        ? t('settings.product.formTitleDuplicate', { category: categoryName })
        : t('settings.product.formTitleNew', { category: categoryName });

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={
        mode !== 'create' && initial
          ? `${initial.manufacturer} · ${initial.name}`
          : undefined
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} loading={submitting}>
            {mode === 'edit' ? tCommon('save') : tCommon('create')}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        {mode === 'edit' && instancesCount > 0 && (
          <div className="flex items-start gap-2 rounded-md bg-warning-muted px-3 py-2 text-xs text-warning">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {t('settings.catalog.instancesBanner', { count: instancesCount })}
            </span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="prd-manufacturer">{t('settings.form.manufacturer')}</Label>
            <Input
              id="prd-manufacturer"
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="prd-name" required>
              {t('settings.form.name')}
            </Label>
            <Input
              id="prd-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus={mode !== 'edit'}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="prd-description">{t('settings.form.description')}</Label>
          <Textarea
            id="prd-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((field) => {
            if (!isVisible(field)) return null;
            const fieldId = `prd-spec-${field.key}`;
            const raw = values[field.key];
            const error = errors[field.key];

            if (field.kind === 'bool') {
              return (
                <label
                  key={field.key}
                  className="flex items-center gap-2 self-end pb-2 text-sm text-text"
                >
                  <input
                    type="checkbox"
                    checked={raw === true}
                    onChange={(e) => setValue(field.key, e.target.checked)}
                    className="h-4 w-4 rounded border-border-strong accent-accent"
                  />
                  <span>{t(field.labelKey)}</span>
                </label>
              );
            }

            if (field.kind === 'select') {
              return (
                <div key={field.key}>
                  <Label htmlFor={fieldId}>{t(field.labelKey)}</Label>
                  <Select
                    id={fieldId}
                    value={typeof raw === 'string' ? raw : ''}
                    onChange={(e) => setValue(field.key, e.target.value)}
                  >
                    {field.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.labelKey ? t(opt.labelKey) : (opt.label ?? opt.value)}
                      </option>
                    ))}
                  </Select>
                  {field.helpKey && <FieldHelp>{t(field.helpKey)}</FieldHelp>}
                </div>
              );
            }

            if (field.kind === 'int') {
              return (
                <div key={field.key}>
                  <Label htmlFor={fieldId} required>
                    {t(field.labelKey)}
                  </Label>
                  <Input
                    id={fieldId}
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={1}
                    value={typeof raw === 'string' ? raw : ''}
                    onChange={(e) => setValue(field.key, e.target.value)}
                    className={cn(error && 'border-danger')}
                  />
                  {error ? (
                    <FieldError>{error}</FieldError>
                  ) : (
                    field.helpKey && <FieldHelp>{t(field.helpKey)}</FieldHelp>
                  )}
                </div>
              );
            }

            // text
            return (
              <div key={field.key}>
                <Label htmlFor={fieldId}>{t(field.labelKey)}</Label>
                <Input
                  id={fieldId}
                  value={typeof raw === 'string' ? raw : ''}
                  onChange={(e) => setValue(field.key, e.target.value)}
                  placeholder={field.placeholder}
                />
                {field.helpKey && <FieldHelp>{t(field.helpKey)}</FieldHelp>}
              </div>
            );
          })}
        </div>
      </form>
    </Modal>
  );
}
