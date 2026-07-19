'use client';

import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Download,
  Network,
  Plus,
  Scissors,
  Search,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useState } from 'react';
import useSWR, { mutate } from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  ipamApi,
  type CgnatPreview,
  type CreateCgnatInput,
  type CreatePrefixInput,
  type IpamAddress,
  type IpamCgnatPlan,
  type IpamLookupResult,
  type IpamNextSubnet,
  type IpamPrefix,
  type IpamPrefixNode,
  type IpamPrefixRole,
} from '@/lib/ipam-api';
import { hasPermission } from '@/lib/session';

type TabKey = 'prefixes' | 'cgnat' | 'lookup';

const ROLE_LABELS: Record<string, string> = {
  SUPERNET: 'Supernet',
  CUSTOMER: 'Cliente (bloco)',
  CGNAT_POOL: 'Bloco CGNAT (privado)',
  PUBLIC_POOL: 'Bloco público',
  MANAGEMENT: 'Gerência',
  LOOPBACK: 'Loopback',
  P2P: 'Ponto-a-ponto',
  DHCP: 'DHCP',
  OTHER: 'Outro',
};
const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  FREE: 'neutral',
  USED: 'success',
  RESERVED: 'warning',
  DHCP: 'info',
  DEPRECATED: 'danger',
};

export default function IpamPage() {
  const [tab, setTab] = useState<TabKey>('prefixes');
  const canWrite = hasPermission('ipam.write');
  const canDelete = hasPermission('ipam.delete');

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-100">
          <Network className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">IPAM — Documentação de IPs</h1>
          <p className="text-sm text-muted-foreground">
            Prefixos, endereços, pools e CGNAT determinístico, integrados ao cadastro de clientes.
          </p>
        </div>
      </header>

      <Tabs<TabKey>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'prefixes', label: 'Prefixos & IPs' },
          { value: 'cgnat', label: 'CGNAT' },
          { value: 'lookup', label: 'Busca reversa' },
        ]}
      />

      {tab === 'prefixes' && <PrefixesTab canWrite={canWrite} canDelete={canDelete} />}
      {tab === 'cgnat' && <CgnatTab canWrite={canWrite} canDelete={canDelete} />}
      {tab === 'lookup' && <LookupTab />}
    </div>
  );
}

// =============================================================================
// PREFIXOS & ENDEREÇOS
// =============================================================================
/**
 * Formata contagens de endereços. Faixas IPv6 são potências de 2 grandes demais
 * pra ler em decimal ("18446744073709551616"), então viram "2^64".
 */
function fmtSize(s: string): string {
  const n = BigInt(s);
  if (n < 1_000_000_000_000n) return n.toLocaleString('pt-BR');
  const bits = n.toString(2).length - 1;
  return (1n << BigInt(bits)) === n ? `2^${bits}` : `~2^${bits}`;
}

/** Percentual pequeno mas não-nulo não pode virar "0%" — isso esconde uso real. */
function fmtPct(p: number): string {
  if (p > 0 && p < 0.01) return '<0,01%';
  return `${p.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

function UtilBar({ p }: { p: IpamPrefix }) {
  const bySubnets = p.utilizationBasis === 'SUBNETS';
  const detail = bySubnets
    ? `${p.childCount} ${p.childCount === 1 ? 'subrede' : 'subredes'} · ${fmtSize(p.freeSize)} livres`
    : `${p.usedCount} de ${fmtSize(p.usableHosts)} IPs`;

  if (p.utilization == null) {
    return <span className="text-xs text-muted-foreground">{detail}</span>;
  }
  const pct = Math.min(100, p.utilization);
  const tone =
    pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : bySubnets ? 'bg-sky-500' : 'bg-brand-500';

  return (
    <div className="flex items-center gap-2" title={detail}>
      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded bg-surface-muted">
        <div className={`h-full ${tone}`} style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }} />
      </div>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {fmtPct(p.utilization)}
        <span className="ml-1 opacity-60">{bySubnets ? 'alocado' : 'usado'}</span>
      </span>
    </div>
  );
}

/**
 * Uma linha da árvore. Renderiza recursivamente os filhos e, ao final, as
 * aberturas de espaço livre — que é o que responde "onde ainda cabe subrede?"
 * sem obrigar o operador a fazer a conta de cabeça.
 */
function PrefixTreeRow({
  node,
  depth,
  collapsed,
  toggle,
  selectedId,
  onSelect,
  onUseFree,
  canWrite,
}: {
  node: IpamPrefixNode;
  depth: number;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  selectedId: string | null;
  onSelect: (n: IpamPrefixNode) => void;
  onUseFree: (parent: IpamPrefixNode, cidr: string) => void;
  canWrite: boolean;
}) {
  const isOpen = !collapsed.has(node.id);
  const hasKids = node.children.length > 0;
  const showFree = isOpen && node.freeBlocks.length > 0;
  const pad = 8 + depth * 18;

  return (
    <>
      <tr
        onClick={() => onSelect(node)}
        className={`cursor-pointer border-t border-border hover:bg-surface-muted ${
          selectedId === node.id ? 'bg-brand-50 dark:bg-brand-500/10' : ''
        }`}
      >
        <td className="py-2 pr-3" style={{ paddingLeft: pad }}>
          <div className="flex items-center gap-1.5">
            {hasKids ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(node.id);
                }}
                className="rounded p-0.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                aria-label={isOpen ? 'Recolher' : 'Expandir'}
              >
                {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            ) : (
              <span className="inline-block w-[18px]" />
            )}
            <span className="font-mono text-sm">{node.cidr}</span>
            {node.version === 'V6' && <Badge tone="purple">v6</Badge>}
            {node.status !== 'ACTIVE' && (
              <Badge tone={node.status === 'RESERVED' ? 'warning' : 'danger'}>
                {node.status === 'RESERVED' ? 'Reservado' : 'Obsoleto'}
              </Badge>
            )}
          </div>
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground">{ROLE_LABELS[node.role] ?? node.role}</td>
        <td className="px-3 py-2 text-xs text-muted-foreground">{node.vlanId ?? '—'}</td>
        <td className="px-3 py-2">
          <UtilBar p={node} />
        </td>
      </tr>

      {isOpen &&
        node.children.map((c) => (
          <PrefixTreeRow
            key={c.id}
            node={c}
            depth={depth + 1}
            collapsed={collapsed}
            toggle={toggle}
            selectedId={selectedId}
            onSelect={onSelect}
            onUseFree={onUseFree}
            canWrite={canWrite}
          />
        ))}

      {showFree &&
        node.freeBlocks.map((b) => (
          <tr key={`${node.id}-free-${b.cidr}`} className="border-t border-dashed border-border/70">
            <td className="py-1.5 pr-3" style={{ paddingLeft: pad + 18 }}>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-sm border border-dashed border-current opacity-60" />
                <span className="font-mono text-xs opacity-75">{b.cidr}</span>
              </div>
            </td>
            <td className="px-3 py-1.5 text-xs italic text-muted-foreground opacity-75">livre</td>
            <td className="px-3 py-1.5" />
            <td className="px-3 py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground opacity-75">
                  {fmtSize(b.size)} endereços
                </span>
                {canWrite && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUseFree(node, b.cidr);
                    }}
                    className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
                  >
                    usar
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}

      {showFree && node.freeTruncated && (
        <tr className="border-t border-dashed border-border/70">
          <td colSpan={4} className="py-1 text-xs italic text-muted-foreground" style={{ paddingLeft: pad + 18 }}>
            … mais aberturas livres (veja a aba Livre no painel)
          </td>
        </tr>
      )}
    </>
  );
}

function PrefixesTab({ canWrite, canDelete }: { canWrite: boolean; canDelete: boolean }) {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [selected, setSelected] = useState<IpamPrefixNode | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [newPrefix, setNewPrefix] = useState<{ cidr: string } | null>(null);

  const key = ['ipam-tree', q, role];
  const { data: tree, isLoading } = useSWR(key, () =>
    ipamApi.treePrefixes({ q: q || undefined, role: role || undefined }),
  );

  const refresh = () => {
    mutate(key);
    mutate('ipam-prefixes-all');
  };

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Reflete no painel a versão recém-carregada do prefixo seleccionado, senão os
  // números do cabeçalho congelam depois de alocar/dividir.
  const findNode = (nodes: IpamPrefixNode[], id: string): IpamPrefixNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
    return null;
  };
  const current = selected && tree ? findNode(tree, selected.id) ?? selected : selected;

  if (isLoading) return <PageLoader />;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar CIDR ou descrição…"
              className="pl-8"
            />
          </div>
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-44">
            <option value="">Todos os papéis</option>
            {Object.entries(ROLE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          {canWrite && (
            <Button onClick={() => setNewPrefix({ cidr: '' })}>
              <Plus className="mr-1 h-4 w-4" /> Prefixo
            </Button>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Prefixo</th>
                <th className="px-3 py-2">Papel</th>
                <th className="px-3 py-2">VLAN</th>
                <th className="px-3 py-2">Ocupação</th>
              </tr>
            </thead>
            <tbody>
              {(tree ?? []).map((n) => (
                <PrefixTreeRow
                  key={n.id}
                  node={n}
                  depth={0}
                  collapsed={collapsed}
                  toggle={toggle}
                  selectedId={current?.id ?? null}
                  onSelect={setSelected}
                  onUseFree={(_parent, cidr) => setNewPrefix({ cidr })}
                  canWrite={canWrite}
                />
              ))}
              {!tree?.length && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                    {q || role ? 'Nenhum prefixo encontrado.' : 'Nenhum prefixo cadastrado.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        {current ? (
          <PrefixDetailPanel
            prefix={current}
            canWrite={canWrite}
            canDelete={canDelete}
            onChanged={refresh}
            onPrefill={(cidr) => setNewPrefix({ cidr })}
          />
        ) : (
          <div className="grid h-full min-h-40 place-items-center rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Selecione um prefixo para ver IPs, mapa e espaço livre.
          </div>
        )}
      </section>

      {newPrefix && (
        <NewPrefixModal
          initialCidr={newPrefix.cidr}
          onClose={() => setNewPrefix(null)}
          onCreated={() => {
            setNewPrefix(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// PAINEL DE DETALHE
// -----------------------------------------------------------------------------
type DetailTab = 'addresses' | 'map' | 'free';

function PrefixDetailPanel({
  prefix,
  canWrite,
  canDelete,
  onChanged,
  onPrefill,
}: {
  prefix: IpamPrefixNode;
  canWrite: boolean;
  canDelete: boolean;
  onChanged: () => void;
  onPrefill: (cidr: string) => void;
}) {
  const [tab, setTab] = useState<DetailTab>('addresses');
  const [splitting, setSplitting] = useState(false);

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-start justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="font-mono text-sm font-medium">{prefix.cidr}</div>
          <div className="truncate text-xs text-muted-foreground">
            {ROLE_LABELS[prefix.role] ?? prefix.role}
            {prefix.description ? ` · ${prefix.description}` : ''}
          </div>
        </div>
        {canWrite && (
          <Button variant="secondary" size="sm" onClick={() => setSplitting(true)}>
            <Scissors className="mr-1 h-3.5 w-3.5" /> Dividir
          </Button>
        )}
      </div>

      <NextSubnetBar prefix={prefix} canWrite={canWrite} onPrefill={onPrefill} />

      <div className="border-b border-border px-3 pt-2">
        <div className="flex gap-4 text-xs">
          {(
            [
              ['addresses', 'Endereços'],
              ['map', 'Mapa'],
              ['free', 'Livre'],
            ] as [DetailTab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`border-b-2 pb-1.5 transition-colors ${
                tab === k
                  ? 'border-brand-500 font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'addresses' && (
        <AddressesPanel prefix={prefix} canWrite={canWrite} canDelete={canDelete} onChanged={onChanged} />
      )}
      {tab === 'map' && <SubnetMap prefix={prefix} />}
      {tab === 'free' && <FreePanel prefix={prefix} canWrite={canWrite} onPrefill={onPrefill} />}

      {splitting && (
        <SplitModal
          prefix={prefix}
          onClose={() => setSplitting(false)}
          onDone={() => {
            setSplitting(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/** "Qual a próxima /N livre aqui dentro?" — a pergunta que o IPAM não respondia. */
function NextSubnetBar({
  prefix,
  canWrite,
  onPrefill,
}: {
  prefix: IpamPrefixNode;
  canWrite: boolean;
  onPrefill: (cidr: string) => void;
}) {
  const maxLen = prefix.version === 'V4' ? 32 : 128;
  const [len, setLen] = useState(() => String(Math.min(prefix.prefixLen + 1, maxLen)));
  const [result, setResult] = useState<IpamNextSubnet | null>(null);
  const [busy, setBusy] = useState(false);

  // Sugestões plausíveis: nada menor que o próprio prefixo.
  const options = (prefix.version === 'V4' ? [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32] : [48, 52, 56, 60, 64, 112, 126, 128]).filter(
    (l) => l > prefix.prefixLen,
  );

  const find = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await ipamApi.nextSubnet(prefix.id, Number(len)));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Falha ao buscar');
    } finally {
      setBusy(false);
    }
  };

  if (!options.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-muted/40 px-3 py-2">
      <span className="text-xs text-muted-foreground">Próxima subrede livre:</span>
      <Select
        value={len}
        onChange={(e) => {
          setLen(e.target.value);
          setResult(null);
        }}
        className="h-8 w-24 text-xs"
      >
        {options.map((l) => (
          <option key={l} value={l}>
            /{l}
          </option>
        ))}
      </Select>
      <Button variant="secondary" size="sm" onClick={find} disabled={busy}>
        <Wand2 className="mr-1 h-3.5 w-3.5" /> Buscar
      </Button>

      {result &&
        (result.available && result.cidr ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-medium text-foreground">{result.cidr}</span>
            {canWrite && (
              <Button size="sm" onClick={() => onPrefill(result.cidr!)}>
                <ArrowRight className="mr-1 h-3.5 w-3.5" /> Criar
              </Button>
            )}
          </div>
        ) : (
          <span className="text-xs text-danger">
            Sem /{result.prefixLen} livre — o espaço restante não tem bloco alinhado desse tamanho.
          </span>
        ))}
    </div>
  );
}

/**
 * Mapa visual da subrede, à la phpIPAM: cada célula é um endereço, colorida pelo
 * estado. Só faz sentido em faixas pequenas — um /16 são 65 mil células.
 */
const MAP_MAX_CELLS = 4096;

function SubnetMap({ prefix }: { prefix: IpamPrefixNode }) {
  const size = BigInt(prefix.size);
  const tooBig = size > BigInt(MAP_MAX_CELLS);

  const { data: addresses, isLoading } = useSWR(
    tooBig ? null : ['ipam-map', prefix.id],
    () => ipamApi.listAddresses({ prefixId: prefix.id }),
  );

  if (tooBig) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        {prefix.cidr} tem {fmtSize(prefix.size)} endereços — grande demais para o mapa.
        <div className="mt-1 text-xs">Selecione uma subrede menor na árvore.</div>
      </div>
    );
  }
  if (isLoading) return <div className="p-4"><PageLoader /></div>;

  const first = BigInt(prefix.firstAddr);
  const count = Number(size);
  const v4 = prefix.version === 'V4';
  // Em IPv4 até /30, o primeiro e o último endereço são rede e broadcast.
  const hasEdges = v4 && prefix.prefixLen <= 30;

  const byOffset = new Map<number, IpamAddress>();
  for (const a of addresses ?? []) byOffset.set(Number(BigInt(a.addrNum) - first), a);

  const cellFor = (i: number) => {
    if (hasEdges && i === 0) return { cls: 'bg-slate-300 dark:bg-slate-600', label: 'rede' };
    if (hasEdges && i === count - 1)
      return { cls: 'bg-slate-300 dark:bg-slate-600', label: 'broadcast' };
    const a = byOffset.get(i);
    if (!a) return { cls: 'bg-surface-muted', label: 'livre' };
    if (a.isGateway) return { cls: 'bg-brand-500', label: 'gateway' };
    switch (a.status) {
      case 'USED':
        return { cls: 'bg-emerald-500', label: 'usado' };
      case 'RESERVED':
        return { cls: 'bg-amber-500', label: 'reservado' };
      case 'DHCP':
        return { cls: 'bg-sky-500', label: 'DHCP' };
      case 'DEPRECATED':
        return { cls: 'bg-red-500', label: 'obsoleto' };
      default:
        return { cls: 'bg-surface-muted', label: 'livre' };
    }
  };

  const ipAt = (i: number) => {
    const a = byOffset.get(i);
    if (a) return a.address;
    // Só IPv4 tem forma curta o bastante pra caber no tooltip sem consulta.
    if (!v4) return `offset +${i}`;
    const n = first + BigInt(i);
    return [(n >> 24n) & 255n, (n >> 16n) & 255n, (n >> 8n) & 255n, n & 255n].join('.');
  };

  const legend: [string, string][] = [
    ['bg-surface-muted', 'livre'],
    ['bg-emerald-500', 'usado'],
    ['bg-brand-500', 'gateway'],
    ['bg-amber-500', 'reservado'],
    ['bg-sky-500', 'DHCP'],
    ['bg-slate-300 dark:bg-slate-600', 'rede/broadcast'],
  ];

  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {legend.map(([cls, label]) => (
          <span key={label} className="flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${cls}`} />
            {label}
          </span>
        ))}
      </div>
      <div className="flex max-h-[420px] flex-wrap gap-[3px] overflow-auto">
        {Array.from({ length: count }, (_, i) => {
          const c = cellFor(i);
          const a = byOffset.get(i);
          const detail = a?.contract?.code
            ? ` — contrato ${a.contract.code}`
            : a?.customer?.displayName
              ? ` — ${a.customer.displayName}`
              : a?.hostname
                ? ` — ${a.hostname}`
                : '';
          return (
            <span
              key={i}
              title={`${ipAt(i)} · ${c.label}${detail}`}
              className={`h-3.5 w-3.5 shrink-0 rounded-[2px] ${c.cls}`}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Lista completa das aberturas livres, com atalho pra criar já preenchido. */
function FreePanel({
  prefix,
  canWrite,
  onPrefill,
}: {
  prefix: IpamPrefixNode;
  canWrite: boolean;
  onPrefill: (cidr: string) => void;
}) {
  const { data, isLoading } = useSWR(['ipam-free', prefix.id], () => ipamApi.freeSpace(prefix.id));

  if (isLoading) return <div className="p-4"><PageLoader /></div>;
  if (!data) return null;

  return (
    <div>
      <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
        {fmtSize(data.totalFree)} endereços livres em {data.blocks.length}{' '}
        {data.blocks.length === 1 ? 'abertura' : 'aberturas'}
        {data.truncated && ' (lista truncada)'}
      </div>
      {data.blocks.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          Prefixo totalmente alocado.
        </div>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <tbody>
              {data.blocks.map((b) => (
                <tr key={b.cidr} className="border-t border-border">
                  <td className="px-3 py-1.5 font-mono text-xs">{b.cidr}</td>
                  <td className="px-3 py-1.5 text-right text-xs text-muted-foreground">
                    {fmtSize(b.size)} endereços
                  </td>
                  <td className="w-16 px-3 py-1.5 text-right">
                    {canWrite && (
                      <button
                        onClick={() => onPrefill(b.cidr)}
                        className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
                      >
                        usar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SplitModal({
  prefix,
  onClose,
  onDone,
}: {
  prefix: IpamPrefixNode;
  onClose: () => void;
  onDone: () => void;
}) {
  const maxLen = prefix.version === 'V4' ? 32 : 128;
  const options = (
    prefix.version === 'V4' ? [24, 25, 26, 27, 28, 29, 30, 31, 32] : [56, 60, 64, 112, 126, 128]
  ).filter((l) => l > prefix.prefixLen && l <= maxLen);

  const [len, setLen] = useState(String(options[0] ?? prefix.prefixLen + 1));
  const [role, setRole] = useState<IpamPrefixRole>('OTHER');
  const [maxCount, setMaxCount] = useState('256');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await ipamApi.splitPrefix(prefix.id, {
        prefixLen: Number(len),
        role,
        maxCount: Number(maxCount),
      });
      toast.success(
        `${r.created} subrede(s) criada(s)${r.truncated ? ' — limite atingido, rode de novo para continuar' : ''}`,
      );
      onDone();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Falha ao dividir');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Dividir ${prefix.cidr}`}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Cria as subredes do tamanho escolhido dentro de {prefix.cidr}, pulando o que já estiver
          alocado. Rodar de novo só preenche o que faltar.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Tamanho</Label>
            <Select value={len} onChange={(e) => setLen(e.target.value)}>
              {options.map((l) => (
                <option key={l} value={l}>
                  /{l}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Máximo a criar</Label>
            <Input
              type="number"
              min={1}
              max={1024}
              value={maxCount}
              onChange={(e) => setMaxCount(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label>Papel das subredes</Label>
          <Select value={role} onChange={(e) => setRole(e.target.value as IpamPrefixRole)}>
            {Object.entries(ROLE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy || !options.length}>
            Dividir
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AddressesPanel({
  prefix,
  canWrite,
  canDelete,
  onChanged,
}: {
  prefix: IpamPrefix;
  canWrite: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const key = ['ipam-addresses', prefix.id];
  const { data: addresses, isLoading } = useSWR(key, () =>
    ipamApi.listAddresses({ prefixId: prefix.id }),
  );
  const [busy, setBusy] = useState(false);
  const [releasing, setReleasing] = useState<IpamAddress | null>(null);

  const allocate = async () => {
    setBusy(true);
    try {
      const a = await ipamApi.allocate({ prefixId: prefix.id, description: 'Alocado via IPAM' });
      toast.success(`IP alocado: ${a.address}`);
      mutate(key);
      mutate(['ipam-map', prefix.id]);
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Falha ao alocar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-xs text-muted-foreground">
          {prefix.usedCount} usados de {fmtSize(prefix.usableHosts)} úteis
        </div>
        {canWrite && (
          <Button variant="secondary" size="sm" onClick={allocate} disabled={busy}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Próximo IP livre
          </Button>
        )}
      </div>
      {isLoading ? (
        <div className="p-4">
          <PageLoader />
        </div>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <tbody>
              {(addresses ?? []).map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{a.address}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {a.contract?.code
                      ? `Contrato ${a.contract.code}`
                      : a.customer?.displayName
                        ? a.customer.displayName
                        : a.equipment?.name
                          ? a.equipment.name
                          : a.description ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canDelete && a.status !== 'FREE' && (
                      <button
                        onClick={() => setReleasing(a)}
                        className="text-muted-foreground hover:text-danger"
                        title="Liberar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!addresses?.length && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    Nenhum IP documentado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {releasing && (
        <ConfirmDialog
          open
          title="Liberar IP"
          message={`Liberar ${releasing.address}? Ele volta a ficar disponível.`}
          onClose={() => setReleasing(null)}
          onConfirm={async () => {
            await ipamApi.releaseAddress(releasing.id);
            setReleasing(null);
            mutate(key);
            mutate(['ipam-map', prefix.id]);
            onChanged();
            toast.success('IP liberado');
          }}
        />
      )}
    </div>
  );
}


function NewPrefixModal({
  initialCidr,
  onClose,
  onCreated,
}: {
  initialCidr?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreatePrefixInput>({
    cidr: initialCidr ?? '',
    role: 'OTHER',
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await ipamApi.createPrefix({
        ...form,
        vlanId: form.vlanId ? Number(form.vlanId) : null,
      });
      toast.success('Prefixo criado');
      onCreated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Falha ao criar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Novo prefixo">
      <div className="space-y-3">
        <div>
          <Label>CIDR (IPv4 ou IPv6)</Label>
          <Input
            value={form.cidr}
            onChange={(e) => setForm({ ...form, cidr: e.target.value })}
            placeholder="10.0.0.0/24 ou 2001:db8::/48"
            className="font-mono"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Papel</Label>
            <Select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as CreatePrefixInput['role'] })}
            >
              {Object.entries(ROLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>VLAN (opcional)</Label>
            <Input
              type="number"
              value={form.vlanId ?? ''}
              onChange={(e) => setForm({ ...form, vlanId: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
        </div>
        <div>
          <Label>Descrição</Label>
          <Textarea
            value={form.description ?? ''}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy || !form.cidr}>
            Criar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// CGNAT
// =============================================================================
function CgnatTab({ canWrite, canDelete }: { canWrite: boolean; canDelete: boolean }) {
  const { data: plans, isLoading } = useSWR('ipam-cgnat', ipamApi.listCgnat);
  const [selected, setSelected] = useState<IpamCgnatPlan | null>(null);
  const [showNew, setShowNew] = useState(false);

  if (isLoading) return <PageLoader />;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <section className="space-y-3">
        <div className="flex justify-end">
          {canWrite && (
            <Button onClick={() => setShowNew(true)}>
              <Plus className="mr-1 h-4 w-4" /> Plano CGNAT
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {(plans ?? []).map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p)}
              className={`w-full rounded-lg border border-border p-3 text-left hover:bg-surface-muted ${
                selected?.id === p.id ? 'ring-2 ring-brand-500' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.portsPerClient} portas/cliente</span>
              </div>
              <div className="mt-1 flex items-center gap-1 font-mono text-xs text-muted-foreground">
                {p.cgnatPrefix?.cidr} <ArrowRight className="h-3 w-3" /> {p.publicPrefix?.cidr}
              </div>
            </button>
          ))}
          {!plans?.length && (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nenhum plano CGNAT.
            </div>
          )}
        </div>
      </section>

      <section>
        {selected ? (
          <CgnatDetail plan={selected} canWrite={canWrite} canDelete={canDelete} onDeleted={() => setSelected(null)} />
        ) : (
          <div className="grid h-full min-h-40 place-items-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            Selecione um plano para ver o mapeamento.
          </div>
        )}
      </section>

      {showNew && (
        <NewCgnatModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            mutate('ipam-cgnat');
          }}
        />
      )}
    </div>
  );
}

function CgnatDetail({
  plan,
  canWrite,
  canDelete,
  onDeleted,
}: {
  plan: IpamCgnatPlan;
  canWrite: boolean;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const { data: preview } = useSWR<CgnatPreview>([`ipam-cgnat-preview`, plan.id, offset], () =>
    ipamApi.previewCgnat(plan.id, offset, 50),
  );
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const cap = preview?.capacity;

  const materialize = async () => {
    setBusy(true);
    try {
      const r = await ipamApi.materializeCgnat(plan.id);
      toast.success(`${r.entryCount} entradas materializadas`);
      mutate('ipam-cgnat');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Falha');
    } finally {
      setBusy(false);
    }
  };

  const doExport = async (format: 'csv' | 'mikrotik') => {
    try {
      const text = await ipamApi.exportCgnat(plan.id, format);
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cgnat-${plan.name}.${format === 'csv' ? 'csv' : 'rsc'}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Falha ao exportar');
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{plan.name}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {plan.cgnatPrefix?.cidr} → {plan.publicPrefix?.cidr} · portas {plan.portBase}–{plan.maxPort}
          </div>
        </div>
        <div className="flex gap-2">
          {canWrite && (
            <Button size="sm" onClick={materialize} disabled={busy}>
              <Wand2 className="mr-1 h-3.5 w-3.5" /> Materializar
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => doExport('csv')}>
            <Download className="mr-1 h-3.5 w-3.5" /> CSV
          </Button>
          <Button size="sm" variant="secondary" onClick={() => doExport('mikrotik')}>
            <Download className="mr-1 h-3.5 w-3.5" /> Mikrotik
          </Button>
        </div>
      </div>

      {cap && (
        <div className="flex flex-wrap gap-3 rounded-md bg-surface-muted p-2 text-xs">
          <span>Blocos/IP público: <b>{cap.blocksPerPublicIp}</b></span>
          <span>Capacidade: <b>{cap.capacity}</b></span>
          <span>Clientes CGNAT: <b>{cap.cgnatCount}</b></span>
          <Badge tone={cap.sufficient ? 'success' : 'danger'}>
            {cap.sufficient ? `Sobra ${cap.spare}` : `Falta ${cap.spare}`}
          </Badge>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">IP privado</th>
              <th className="px-3 py-2">IP público</th>
              <th className="px-3 py-2">Portas</th>
            </tr>
          </thead>
          <tbody>
            {(preview?.rows ?? []).map((r) => (
              <tr key={r.privateIp} className="border-t border-border font-mono">
                <td className="px-3 py-1.5">{r.privateIp}</td>
                <td className="px-3 py-1.5">{r.publicIp}</td>
                <td className="px-3 py-1.5">
                  {r.portStart}–{r.portEnd}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {preview ? `${offset + 1}–${offset + preview.rows.length} de ${preview.total}` : ''}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Anterior
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!!preview && offset + preview.rows.length >= Number(preview.total)}
            onClick={() => setOffset(offset + 50)}
          >
            Próxima
          </Button>
          {canDelete && (
            <Button size="sm" variant="danger" onClick={() => setConfirmDel(true)}>
              Excluir plano
            </Button>
          )}
        </div>
      </div>

      {confirmDel && (
        <ConfirmDialog
          open
          title="Excluir plano CGNAT"
          message={`Excluir "${plan.name}" e todas as entradas materializadas?`}
          onClose={() => setConfirmDel(false)}
          variant="danger"
          onConfirm={async () => {
            await ipamApi.deleteCgnat(plan.id);
            setConfirmDel(false);
            onDeleted();
            mutate('ipam-cgnat');
            toast.success('Plano excluído');
          }}
        />
      )}
    </div>
  );
}

function NewCgnatModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: prefixes } = useSWR('ipam-prefixes-all', () => ipamApi.listPrefixes());
  const v4 = (prefixes ?? []).filter((p) => p.version === 'V4');
  const publicPrefixes = v4.filter((p) => p.role === 'PUBLIC_POOL' || p.role === 'SUPERNET');
  const cgnatPrefixes = v4.filter((p) => p.role === 'CGNAT_POOL');
  const [form, setForm] = useState<CreateCgnatInput>({
    name: '',
    publicPrefixId: '',
    cgnatPrefixId: '',
    portsPerClient: 1000,
    portBase: 1024,
    maxPort: 65535,
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await ipamApi.createCgnat(form);
      toast.success('Plano CGNAT criado');
      onCreated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Falha ao criar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Novo plano CGNAT">
      <div className="space-y-3">
        <div>
          <Label>Nome</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Bloco público (saída)</Label>
            <Select
              value={form.publicPrefixId}
              onChange={(e) => setForm({ ...form, publicPrefixId: e.target.value })}
            >
              <option value="">Selecione…</option>
              {publicPrefixes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.cidr}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Bloco CGNAT (privado)</Label>
            <Select
              value={form.cgnatPrefixId}
              onChange={(e) => setForm({ ...form, cgnatPrefixId: e.target.value })}
            >
              <option value="">Selecione…</option>
              {cgnatPrefixes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.cidr}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Portas/cliente</Label>
            <Input
              type="number"
              value={form.portsPerClient}
              onChange={(e) => setForm({ ...form, portsPerClient: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Porta inicial</Label>
            <Input
              type="number"
              value={form.portBase}
              onChange={(e) => setForm({ ...form, portBase: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Porta final</Label>
            <Input
              type="number"
              value={form.maxPort}
              onChange={(e) => setForm({ ...form, maxPort: Number(e.target.value) })}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Dica: cadastre os prefixos com papel <b>Bloco público</b> e <b>Bloco CGNAT (privado)</b> antes.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy || !form.name || !form.publicPrefixId || !form.cgnatPrefixId}>
            Criar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// BUSCA REVERSA (Marco Civil)
// =============================================================================
function LookupTab() {
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('');
  const [at, setAt] = useState('');
  const [result, setResult] = useState<IpamLookupResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!ip) return;
    setBusy(true);
    try {
      const r = await ipamApi.lookup(ip, port || undefined, at ? new Date(at).toISOString() : undefined);
      setResult(r);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Falha na busca');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-lg border border-border p-4">
        <p className="mb-3 text-sm text-muted-foreground">
          Descubra qual cliente estava usando um IP (público + porta) num instante — cruza IPAM,
          CGNAT e sessões RADIUS. Útil para responder ofícios (Marco Civil).
        </p>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1.5fr_auto] sm:items-end">
          <div>
            <Label>IP</Label>
            <Input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="203.0.113.10" className="font-mono" />
          </div>
          <div>
            <Label>Porta</Label>
            <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="34567" type="number" />
          </div>
          <div>
            <Label>Data/hora</Label>
            <Input value={at} onChange={(e) => setAt(e.target.value)} type="datetime-local" />
          </div>
          <Button onClick={run} disabled={busy || !ip}>
            <Search className="mr-1 h-4 w-4" /> Buscar
          </Button>
        </div>
      </div>

      {result && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Resultado para</span>
            <span className="font-mono text-sm">
              {result.query.ip}
              {result.query.port != null ? `:${result.query.port}` : ''}
            </span>
          </div>

          {result.resolved.contract || result.resolved.customer ? (
            <div className="rounded-md bg-emerald-50 p-3 text-sm dark:bg-emerald-900/20">
              <div className="font-medium text-emerald-800 dark:text-emerald-300">
                Cliente identificado ({result.resolved.via})
              </div>
              <div className="mt-1">
                {result.resolved.customer?.displayName ?? '—'}
                {result.resolved.contract?.code ? ` · Contrato ${result.resolved.contract.code}` : ''}
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              Nenhum cliente resolvido diretamente. Veja as sessões RADIUS abaixo.
            </div>
          )}

          {result.cgnatMatch && (
            <div className="text-sm">
              <span className="text-muted-foreground">CGNAT ({result.cgnatMatch.source}): </span>
              <span className="font-mono">
                público → privado {result.cgnatMatch.privateIp}
                {result.cgnatMatch.portStart != null
                  ? ` (portas ${result.cgnatMatch.portStart}–${result.cgnatMatch.portEnd})`
                  : ''}
              </span>
            </div>
          )}

          <div>
            <div className="mb-1 text-xs uppercase text-muted-foreground">
              Sessões RADIUS (IP {result.radiusIp})
            </div>
            {result.radiusSessions.length ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1">Usuário</th>
                    <th className="py-1">Início</th>
                    <th className="py-1">Fim</th>
                    <th className="py-1">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {result.radiusSessions.map((s, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1 font-mono">{s.username ?? '—'}</td>
                      <td className="py-1">{s.sessionStart ? new Date(s.sessionStart).toLocaleString() : '—'}</td>
                      <td className="py-1">{s.sessionStop ? new Date(s.sessionStop).toLocaleString() : '—'}</td>
                      <td className="py-1">
                        <Badge tone={s.online ? 'success' : 'neutral'}>{s.online ? 'online' : 'encerrada'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-sm text-muted-foreground">Sem sessão RADIUS para esse IP/horário.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
