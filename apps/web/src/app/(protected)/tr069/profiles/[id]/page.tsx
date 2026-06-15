'use client';

/**
 * /tr069/profiles/[id] — editor do profile homologado + regras de conformidade.
 *
 * Salvar substitui o conjunto de regras e faz bump de versão → o reconciliador
 * re-avalia os devices casados no próximo ciclo. Senhas (WiFi/PPPoE) não devem
 * virar regra (o GET Huawei as devolve vazias) — são aplicadas no provisionamento.
 */
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { notify } from '@/lib/notify';
import {
  tr069Api,
  TR069_RULE_SOURCE_LABELS,
  type Tr069ProfileRuleInput,
  type Tr069RuleMode,
  type Tr069RuleSource,
} from '@/lib/provisioning-api';

const SOURCES: Tr069RuleSource[] = [
  'STATIC',
  'CONTRACT_PPPOE_USER',
  'CONTRACT_PPPOE_PASS',
  'CONTRACT_PPPOE_VLAN',
  'CONTRACT_WIFI_SSID',
  'CONTRACT_WIFI_SSID_5G',
  'CONTRACT_WIFI_PASS',
];

export default function Tr069ProfileEditPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { data, isLoading, error, mutate } = useSWR(
    id ? `tr069/profiles/${id}` : null,
    () => tr069Api.getProfile(id),
  );
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [productClass, setProductClass] = useState('');
  const [firmwarePattern, setFirmwarePattern] = useState('');
  const [active, setActive] = useState(true);
  const [rules, setRules] = useState<Tr069ProfileRuleInput[]>([]);

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setManufacturer(data.manufacturer);
    setProductClass(data.productClass ?? '');
    setFirmwarePattern(data.firmwarePattern ?? '');
    setActive(data.active);
    setRules(
      data.rules.map((r) => ({
        param: r.param,
        valueType: r.valueType,
        source: r.source,
        staticValue: r.staticValue,
        mode: r.mode,
        requiresReboot: r.requiresReboot,
        enabled: r.enabled,
        sortOrder: r.sortOrder,
      })),
    );
  }, [data]);

  function updateRule(i: number, patch: Partial<Tr069ProfileRuleInput>) {
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRule() {
    setRules((rs) => [
      ...rs,
      {
        param: '',
        valueType: 'xsd:string',
        source: 'STATIC',
        staticValue: '',
        mode: 'REPORT_ONLY',
        requiresReboot: false,
        enabled: true,
        sortOrder: rs.length + 1,
      },
    ]);
  }
  function removeRule(i: number) {
    setRules((rs) => rs.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    if (!name.trim() || !manufacturer.trim()) {
      notify.error('Nome e fabricante são obrigatórios');
      return;
    }
    if (rules.some((r) => r.param.trim().length < 3)) {
      notify.error('Toda regra precisa de um parâmetro TR-069 válido');
      return;
    }
    setBusy(true);
    try {
      await tr069Api.updateProfile(id, {
        name: name.trim(),
        manufacturer: manufacturer.trim(),
        productClass: productClass.trim() || null,
        firmwarePattern: firmwarePattern.trim() || null,
        active,
        rules,
      });
      notify.success('Profile salvo', {
        description: 'Os devices casados serão re-reconciliados no próximo ciclo.',
      });
      await mutate();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Excluir este profile? Os devices casados ficam sem profile.')) return;
    setBusy(true);
    try {
      await tr069Api.deleteProfile(id);
      notify.success('Profile excluído');
      router.push('/tr069/profiles');
    } catch (e) {
      notify.apiError(e);
      setBusy(false);
    }
  }

  if (isLoading) return <PageLoader />;
  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link
          href="/tr069/profiles"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Profile não encontrado.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Link
            href="/tr069/profiles"
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Link>
          <h1 className="text-xl font-bold tracking-tight">
            {data.name}{' '}
            <span className="text-sm font-normal text-slate-400">
              v{data.version} · {data.deviceCount} device(s)
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" loading={busy} onClick={handleDelete}>
            <Trash2 className="mr-1 h-4 w-4" /> Excluir
          </Button>
          <Button size="sm" loading={busy} onClick={handleSave}>
            Salvar
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identificação / matching</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Fabricante (match case-insensitive “contém”)</Label>
            <Input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
          </div>
          <div>
            <Label>Modelo / productClass (vazio = todos)</Label>
            <Input value={productClass} onChange={(e) => setProductClass(e.target.value)} />
          </div>
          <div>
            <Label>Firmware (regex, opcional)</Label>
            <Input value={firmwarePattern} onChange={(e) => setFirmwarePattern(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Profile ativo
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Regras de conformidade</CardTitle>
          <Button variant="secondary" size="sm" onClick={addRule}>
            <Plus className="mr-1 h-4 w-4" /> Adicionar regra
          </Button>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="text-sm text-slate-500">
              Sem regras. Adicione parâmetros TR-069 a verificar (ex.: IPv6 Origin, SSID, PPPoE).
            </p>
          ) : (
            <div className="space-y-3">
              {rules.map((r, i) => (
                <div
                  key={i}
                  className="grid gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800 lg:grid-cols-12"
                >
                  <div className="lg:col-span-5">
                    <Label>Parâmetro TR-069</Label>
                    <Input
                      value={r.param}
                      onChange={(e) => updateRule(i, { param: e.target.value })}
                      placeholder="InternetGatewayDevice.WANDevice.1...."
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="lg:col-span-3">
                    <Label>Origem do valor</Label>
                    <Select
                      value={r.source}
                      onChange={(e) =>
                        updateRule(i, { source: e.target.value as Tr069RuleSource })
                      }
                    >
                      {SOURCES.map((s) => (
                        <option key={s} value={s}>
                          {TR069_RULE_SOURCE_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="lg:col-span-2">
                    <Label>{r.source === 'STATIC' ? 'Valor fixo' : 'Tipo'}</Label>
                    {r.source === 'STATIC' ? (
                      <Input
                        value={r.staticValue ?? ''}
                        onChange={(e) => updateRule(i, { staticValue: e.target.value })}
                        placeholder="AutoConfigured"
                      />
                    ) : (
                      <Input
                        value={r.valueType}
                        onChange={(e) => updateRule(i, { valueType: e.target.value })}
                        className="font-mono text-xs"
                      />
                    )}
                  </div>
                  <div className="lg:col-span-2">
                    <Label>Modo</Label>
                    <Select
                      value={r.mode}
                      onChange={(e) => updateRule(i, { mode: e.target.value as Tr069RuleMode })}
                    >
                      <option value="REPORT_ONLY">Só reportar</option>
                      <option value="ENFORCE">Forçar (enforce)</option>
                    </Select>
                  </div>
                  <div className="flex items-center gap-4 lg:col-span-12">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={r.requiresReboot}
                        onChange={(e) => updateRule(i, { requiresReboot: e.target.checked })}
                      />
                      Exige reboot
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => updateRule(i, { enabled: e.target.checked })}
                      />
                      Habilitada
                    </label>
                    {r.source === 'STATIC' && (
                      <span className="text-xs text-slate-400">tipo: {r.valueType}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeRule(i)}
                      className="ml-auto inline-flex items-center gap-1 text-xs text-red-600 hover:underline dark:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
