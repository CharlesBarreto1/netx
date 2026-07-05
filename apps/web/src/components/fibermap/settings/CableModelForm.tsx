'use client';

/**
 * CableModelForm — form de modelo de cabo do catálogo FiberMap (spec §10).
 *
 * O mais rico da Tela 3: estrutura (fibras/tubos/fibras-por-tubo com validação
 * ao vivo `fibras = tubos × fibras/tubo`), padrão de cores, esquema de tubos
 * (ciclo padrão | piloto/direcional | custom) e preview SVG VIVO do corte
 * transversal.
 *
 * Regra de imutabilidade (spec §14.8): a estrutura de um modelo de cabo é
 * IMUTÁVEL depois de criado — o backend só aceita estrutura via
 * POST /catalog/cable-models. No modo `edit` os campos estruturais ficam
 * disabled (hint "duplique para mudar a estrutura") e o submit usa
 * `updateProduct` só com metadados (fabricante/nome/descrição).
 */
import { Info, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

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
import {
  FIBERMAP_COLOR_HEX,
  FIBERMAP_COLOR_LABELS_PT,
  fibermapApi,
  fibermapColorCycle,
  previewTubeColors,
  type FibermapColorCode,
  type FibermapColorStandard,
  type FibermapProduct,
  type FibermapTubeScheme,
} from '@/lib/fibermap-api';

import { CablePreview } from './CablePreview';
import {
  asColorCode,
  CABLE_LIMITS,
  toDecimal,
  toInt,
  type CatalogFormMode,
} from './catalog-shared';

const FORM_ID = 'fibermap-cable-model-form';

const TUBE_SCHEMES: FibermapTubeScheme[] = [
  'STANDARD_CYCLE',
  'PILOT_DIRECTIONAL',
  'CUSTOM',
];

export interface CableModelFormProps {
  mode: CatalogFormMode;
  /** Produto completo (com cableModel) — obrigatório em edit/duplicate. */
  initial: FibermapProduct | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function CableModelForm({ mode, initial, onClose, onSaved }: CableModelFormProps) {
  const t = useTranslations('fibermap');
  const tCommon = useTranslations('common');

  const model = initial?.cableModel ?? null;
  /** Campos estruturais só são editáveis em create/duplicate. */
  const structural = mode !== 'edit';
  const instancesCount = initial?.instancesCount ?? 0;

  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? 'Padrão');
  const [name, setName] = useState(() =>
    mode === 'duplicate' && initial
      ? t('settings.catalog.copyName', { name: initial.name })
      : (initial?.name ?? ''),
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [cableClass, setCableClass] = useState(model?.cableClass ?? '');
  const [fiberCount, setFiberCount] = useState(model ? String(model.fiberCount) : '12');
  const [tubeCount, setTubeCount] = useState(model ? String(model.tubeCount) : '1');
  const [fibersPerTube, setFibersPerTube] = useState(
    model ? String(model.fibersPerTube) : '12',
  );
  const [colorStandard, setColorStandard] = useState<FibermapColorStandard>(
    model?.colorStandard ?? 'ABNT',
  );
  const [tubeScheme, setTubeScheme] = useState<FibermapTubeScheme>(
    model?.tubeScheme ?? 'STANDARD_CYCLE',
  );
  const [customColors, setCustomColors] = useState<FibermapColorCode[]>(() =>
    model
      ? [...model.tubes]
          .sort((a, b) => a.tubeNumber - b.tubeNumber)
          .map((tube) => asColorCode(tube.color) ?? 'BRANCA')
      : [],
  );
  const [excessFactor, setExcessFactor] = useState(
    model ? String(model.excessFactor) : '1.02',
  );
  const [submitting, setSubmitting] = useState(false);

  // ── Validação ao vivo (spec §10: fibras = tubos × fibras/tubo) ────────────
  const tubesN = toInt(tubeCount);
  const fptN = toInt(fibersPerTube);
  const fibersN = toInt(fiberCount);
  const excessN = toDecimal(excessFactor);

  const tubesValid = tubesN !== null && tubesN >= 1 && tubesN <= CABLE_LIMITS.maxTubes;
  const fptValid =
    fptN !== null && fptN >= 1 && fptN <= CABLE_LIMITS.maxFibersPerTube;
  const structureMismatch =
    tubesValid && fptValid && fibersN !== null && fibersN !== tubesN * fptN;
  const structureOk =
    tubesValid && fptValid && fibersN !== null && fibersN === tubesN * fptN;
  const excessValid = excessN !== null && excessN >= 1 && excessN < 2;

  /** Cores custom sempre com o tamanho do nº de tubos (pad com Branca). */
  const effectiveCustom = useMemo<FibermapColorCode[]>(() => {
    if (!tubesValid || tubesN === null) return [];
    return Array.from({ length: tubesN }, (_, i) => customColors[i] ?? 'BRANCA');
  }, [customColors, tubesN, tubesValid]);

  const previewReady = tubesValid && fptValid && tubesN !== null && fptN !== null;
  const previewColors = previewReady
    ? previewTubeColors(tubeScheme, colorStandard, tubesN, effectiveCustom)
    : [];

  /** 12 cores do padrão + Branca/Natural (ambos os ciclos já contêm Branca). */
  const allowedColors = useMemo<FibermapColorCode[]>(() => {
    const cycle = fibermapColorCycle(colorStandard);
    return cycle.includes('BRANCA') ? [...cycle] : [...cycle, 'BRANCA'];
  }, [colorStandard]);

  function setCustomColorAt(index: number, code: FibermapColorCode) {
    const next = [...effectiveCustom];
    next[index] = code;
    setCustomColors(next);
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

    // Edit: só metadados — estrutura é snapshot imutável (spec §14.8).
    if (mode === 'edit') {
      if (!initial) return;
      setSubmitting(true);
      try {
        await fibermapApi.updateProduct(initial.id, {
          manufacturer: manufacturer.trim() || 'Padrão',
          name: name.trim(),
          description: description.trim() ? description.trim() : null,
        });
        toast.success(t('settings.catalog.saved'));
        await onSaved();
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Create / duplicate: estrutura completa via createCableModel.
    if (
      tubesN === null ||
      fptN === null ||
      fibersN === null ||
      excessN === null ||
      !tubesValid ||
      !fptValid ||
      !excessValid ||
      fibersN !== tubesN * fptN
    ) {
      toast.error(t('settings.form.invalidNumbers'));
      return;
    }
    setSubmitting(true);
    try {
      await fibermapApi.createCableModel({
        manufacturer: manufacturer.trim() || 'Padrão',
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        fiberCount: fibersN,
        tubeCount: tubesN,
        fibersPerTube: fptN,
        colorStandard,
        tubeScheme,
        customTubeColors:
          tubeScheme === 'CUSTOM'
            ? Array.from({ length: tubesN }, (_, i) => customColors[i] ?? 'BRANCA')
            : undefined,
        excessFactor: excessN,
        cableClass: cableClass.trim() ? cableClass.trim() : null,
      });
      toast.success(t('settings.catalog.created'));
      await onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const title =
    mode === 'edit'
      ? t('settings.cable.formTitleEdit')
      : mode === 'duplicate'
        ? t('settings.cable.formTitleDuplicate')
        : t('settings.cable.formTitleNew');

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
      size="xl"
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
      <form
        id={FORM_ID}
        onSubmit={handleSubmit}
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]"
      >
        <div className="space-y-4">
          {mode === 'edit' && instancesCount > 0 && (
            <div className="flex items-start gap-2 rounded-md bg-warning-muted px-3 py-2 text-xs text-warning">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {t('settings.catalog.instancesBanner', { count: instancesCount })}
              </span>
            </div>
          )}
          {mode === 'edit' && (
            <div className="flex items-start gap-2 rounded-md bg-info-muted px-3 py-2 text-xs text-info">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t('settings.cable.structureLocked')}</span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cbl-manufacturer">{t('settings.form.manufacturer')}</Label>
              <Input
                id="cbl-manufacturer"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cbl-name" required>
                {t('settings.form.name')}
              </Label>
              <Input
                id="cbl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus={mode !== 'edit'}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="cbl-description">{t('settings.form.description')}</Label>
            <Textarea
              id="cbl-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cbl-class">{t('settings.cable.cableClass')}</Label>
              <Input
                id="cbl-class"
                value={cableClass}
                onChange={(e) => setCableClass(e.target.value)}
                placeholder="ASU80"
                disabled={!structural}
              />
              <FieldHelp>{t('settings.cable.cableClassHelp')}</FieldHelp>
            </div>
            <div>
              <Label htmlFor="cbl-excess">{t('settings.cable.excessFactor')}</Label>
              <Input
                id="cbl-excess"
                type="number"
                step="0.001"
                min={1}
                max={1.999}
                value={excessFactor}
                onChange={(e) => setExcessFactor(e.target.value)}
                disabled={!structural}
                className={cn(!excessValid && 'border-danger')}
              />
              {excessValid ? (
                <FieldHelp>{t('settings.cable.excessFactorHelp')}</FieldHelp>
              ) : (
                <FieldError>{t('settings.cable.excessFactorError')}</FieldError>
              )}
            </div>
          </div>

          <fieldset className="rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-text-subtle">
              {t('settings.cable.structureLegend')}
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="cbl-fibers" required>
                  {t('settings.cable.fiberCount')}
                </Label>
                <Input
                  id="cbl-fibers"
                  type="number"
                  min={1}
                  step={1}
                  value={fiberCount}
                  onChange={(e) => setFiberCount(e.target.value)}
                  disabled={!structural}
                  className={cn(structureMismatch && 'border-danger')}
                />
              </div>
              <div>
                <Label htmlFor="cbl-tubes" required>
                  {t('settings.cable.tubeCount')}
                </Label>
                <Input
                  id="cbl-tubes"
                  type="number"
                  min={1}
                  max={CABLE_LIMITS.maxTubes}
                  step={1}
                  value={tubeCount}
                  onChange={(e) => setTubeCount(e.target.value)}
                  disabled={!structural}
                  className={cn(!tubesValid && 'border-danger')}
                />
              </div>
              <div>
                <Label htmlFor="cbl-fpt" required>
                  {t('settings.cable.fibersPerTube')}
                </Label>
                <Input
                  id="cbl-fpt"
                  type="number"
                  min={1}
                  max={CABLE_LIMITS.maxFibersPerTube}
                  step={1}
                  value={fibersPerTube}
                  onChange={(e) => setFibersPerTube(e.target.value)}
                  disabled={!structural}
                  className={cn(!fptValid && 'border-danger')}
                />
              </div>
            </div>
            {structureMismatch && tubesN !== null && fptN !== null && (
              <FieldError>
                {t('settings.cable.structureError', {
                  expected: tubesN * fptN,
                  tubes: tubesN,
                  fibersPerTube: fptN,
                })}
              </FieldError>
            )}
            {structureOk && tubesN !== null && fptN !== null && (
              <FieldHelp>
                {t('settings.cable.structureOk', {
                  tubes: tubesN,
                  fibersPerTube: fptN,
                  fibers: tubesN * fptN,
                })}
              </FieldHelp>
            )}

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="cbl-standard">{t('settings.cable.colorStandard')}</Label>
                <Select
                  id="cbl-standard"
                  value={colorStandard}
                  onChange={(e) =>
                    setColorStandard(e.target.value === 'EIA598' ? 'EIA598' : 'ABNT')
                  }
                  disabled={!structural}
                >
                  <option value="ABNT">{t('settings.cable.standard.ABNT')}</option>
                  <option value="EIA598">{t('settings.cable.standard.EIA598')}</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="cbl-scheme">{t('settings.cable.tubeScheme')}</Label>
                <Select
                  id="cbl-scheme"
                  value={tubeScheme}
                  onChange={(e) => {
                    const v = e.target.value as FibermapTubeScheme;
                    if (TUBE_SCHEMES.includes(v)) setTubeScheme(v);
                  }}
                  disabled={!structural}
                >
                  {TUBE_SCHEMES.map((scheme) => (
                    <option key={scheme} value={scheme}>
                      {t(`settings.cable.scheme.${scheme}`)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {tubeScheme === 'CUSTOM' && previewReady && (
              <div className="mt-3">
                <Label>{t('settings.cable.customColors')}</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {effectiveCustom.map((color, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-xs font-medium text-text-muted">
                        {t('settings.cable.tubeN', { n: i + 1 })}
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          'h-5 w-5 shrink-0 rounded-full border',
                          color === 'BRANCA' ? 'border-border-strong' : 'border-black/20',
                        )}
                        style={{ backgroundColor: FIBERMAP_COLOR_HEX[color] }}
                      />
                      <Select
                        aria-label={t('settings.cable.tubeN', { n: i + 1 })}
                        value={color}
                        disabled={!structural}
                        onChange={(e) => {
                          const code = asColorCode(e.target.value);
                          if (code) setCustomColorAt(i, code);
                        }}
                        className="py-1 text-xs"
                      >
                        {allowedColors.map((c) => (
                          <option key={c} value={c}>
                            {FIBERMAP_COLOR_LABELS_PT[c]}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>
                <FieldHelp>{t('settings.cable.customColorsHelp')}</FieldHelp>
              </div>
            )}
          </fieldset>
        </div>

        {/* Preview vivo — reage a QUALQUER mudança do form */}
        <div className="space-y-2 self-start lg:sticky lg:top-0">
          <h3 className="text-sm font-semibold text-text">{t('settings.cable.preview')}</h3>
          <div className="rounded-lg border border-border bg-surface p-3">
            {previewReady && tubesN !== null && fptN !== null ? (
              <>
                <CablePreview
                  tubeCount={tubesN}
                  fibersPerTube={fptN}
                  tubeColors={previewColors}
                  colorStandard={colorStandard}
                />
                <p className="mt-2 text-center text-xs font-medium text-text-muted">
                  {t('settings.cable.previewCaption', {
                    tubes: tubesN,
                    fibersPerTube: fptN,
                    fibers: tubesN * fptN,
                  })}
                </p>
              </>
            ) : (
              <p className="px-2 py-10 text-center text-xs text-text-muted">
                {t('settings.cable.previewInvalid')}
              </p>
            )}
          </div>
          <p className="text-xs text-text-subtle">{t('settings.cable.previewHint')}</p>
        </div>
      </form>
    </Modal>
  );
}
