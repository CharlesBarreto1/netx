import { useEffect, useState } from 'react';
import { api, type ConnectivityResult, type Device, type DeviceInput, type Vendor } from './api.js';

const VENDORS: Vendor[] = ['juniper', 'mikrotik', 'cisco_iosxe'];

/** O valor do enum é chave técnica (`cisco_iosxe`) — na tela mostra o nome do vendor. */
const VENDOR_LABEL: Record<Vendor, string> = {
  juniper: 'Juniper (Junos)',
  mikrotik: 'Mikrotik (RouterOS)',
  cisco_iosxe: 'Cisco IOS-XE (ASR)',
};

const EMPTY: DeviceInput = { hostname: '', mgmtIp: '', vendor: 'juniper' };

/** Estado de um canal de conectividade (ssh/netconf/snmp). */
function ChannelBadge({
  label,
  check,
}: {
  label: string;
  check?: { reachable: boolean; detail?: string; applicable?: boolean };
}) {
  if (!check) return null;
  const naColor = 'var(--muted)';
  const color =
    check.applicable === false ? naColor : check.reachable ? 'var(--ok)' : 'var(--danger)';
  const state = check.applicable === false ? 'N/A' : check.reachable ? 'ok' : 'falhou';
  return (
    <span title={check.detail ?? ''} style={{ marginRight: 12 }}>
      <span className="dot" style={{ background: color }} /> {label}: {state}
    </span>
  );
}

/** Gestão de equipamentos (só admin): CRUD multi-vendor, credenciais, conectividade, SNMP, discovery. */
export function DeviceManager({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState<DeviceInput>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [cred, setCred] = useState({ username: '', password: '', snmpCommunity: '' });
  const [conn, setConn] = useState<Record<string, ConnectivityResult>>({});
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .devices()
      .then(setDevices)
      .catch((e: unknown) => setMsg(String(e)));
  useEffect(() => {
    void load();
  }, []);

  const refresh = async () => {
    await load();
    onChanged();
  };

  const save = async () => {
    setBusy(true);
    setMsg(editing ? 'salvando…' : 'criando…');
    try {
      const payload: DeviceInput = {
        hostname: form.hostname.trim(),
        mgmtIp: form.mgmtIp.trim(),
        vendor: form.vendor,
        model: form.model?.trim() || undefined,
        osVersion: form.osVersion?.trim() || undefined,
        site: form.site?.trim() || undefined,
      };
      if (editing) await api.updateDevice(editing, payload);
      else await api.createDevice(payload);
      setForm(EMPTY);
      setEditing(null);
      setMsg('');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const edit = (d: Device) => {
    setEditing(d.id);
    setForm({
      hostname: d.hostname,
      mgmtIp: d.mgmtIp,
      vendor: (d.vendor as Vendor) ?? 'juniper',
      model: d.model ?? undefined,
      site: d.site ?? undefined,
    });
  };

  const remove = async (d: Device) => {
    if (!confirm(`Remover o device "${d.hostname}" (${d.mgmtIp})?`)) return;
    try {
      await api.removeDevice(d.id);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const saveCred = async (d: Device) => {
    if (!cred.username.trim()) {
      setMsg('informe o usuário das credenciais');
      return;
    }
    try {
      await api.setCredentials(d.id, {
        username: cred.username.trim(),
        password: cred.password || undefined,
        snmpCommunity: cred.snmpCommunity || undefined,
      });
      setCred({ username: '', password: '', snmpCommunity: '' });
      setMsg(`credenciais de ${d.hostname} salvas`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const test = async (d: Device) => {
    setMsg(`testando ${d.hostname}…`);
    try {
      const r = await api.testConnectivity(d.id);
      setConn((c) => ({ ...c, [d.id]: r }));
      setMsg('');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const sync = async (d: Device) => {
    try {
      await api.syncSnmp(d.id);
      await api.discoverInterfaces(d.id).catch(() => undefined);
      setMsg(`SNMP de ${d.hostname} sincronizado + discovery disparado`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="term-modal">
      <div className="term-head">
        <span>Equipamentos (multi-vendor)</span>
        <button onClick={onClose}>fechar ✕</button>
      </div>
      <div className="term-body" style={{ overflow: 'auto', padding: 16 }}>
        {msg && <p className="err">{msg}</p>}

        <div className="panel">
          <h2>{editing ? 'Editar device' : 'Novo device'}</h2>
          <div className="btns" style={{ flexWrap: 'wrap' }}>
            <input
              placeholder="hostname"
              value={form.hostname}
              onChange={(e) => setForm({ ...form, hostname: e.target.value })}
            />
            <input
              placeholder="IP de gerência"
              value={form.mgmtIp}
              onChange={(e) => setForm({ ...form, mgmtIp: e.target.value })}
            />
            <select
              value={form.vendor}
              onChange={(e) => setForm({ ...form, vendor: e.target.value as Vendor })}
            >
              {VENDORS.map((v) => (
                <option key={v} value={v}>
                  {VENDOR_LABEL[v]}
                </option>
              ))}
            </select>
            <input
              placeholder="modelo (opcional)"
              value={form.model ?? ''}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
            <input
              placeholder="site (opcional)"
              value={form.site ?? ''}
              onChange={(e) => setForm({ ...form, site: e.target.value })}
            />
            <button disabled={busy || !form.hostname || !form.mgmtIp} onClick={() => void save()}>
              {editing ? 'Salvar' : '+ Criar'}
            </button>
            {editing && (
              <button
                onClick={() => {
                  setEditing(null);
                  setForm(EMPTY);
                }}
              >
                cancelar
              </button>
            )}
          </div>
        </div>

        <div className="panel">
          <h2>Credenciais (cofre)</h2>
          <p className="label">
            Selecione um device abaixo (“cred”) para gravar. Os segredos vão cifrados ao cofre — a
            API nunca os guarda em claro.
          </p>
          <div className="btns" style={{ flexWrap: 'wrap' }}>
            <input
              placeholder="usuário SSH"
              value={cred.username}
              onChange={(e) => setCred({ ...cred, username: e.target.value })}
            />
            <input
              type="password"
              placeholder="senha"
              value={cred.password}
              onChange={(e) => setCred({ ...cred, password: e.target.value })}
            />
            <input
              placeholder="SNMP community"
              value={cred.snmpCommunity}
              onChange={(e) => setCred({ ...cred, snmpCommunity: e.target.value })}
            />
          </div>
        </div>

        <div className="panel full">
          <h2>Devices ({devices.length})</h2>
          <table>
            <thead>
              <tr>
                <th>Hostname</th>
                <th>IP</th>
                <th>Vendor</th>
                <th>Site</th>
                <th>Conectividade</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>{d.hostname}</td>
                  <td>{d.mgmtIp}</td>
                  <td>
                    <span className="tag">{d.vendor}</span>
                  </td>
                  <td>{d.site ?? '—'}</td>
                  <td>
                    {conn[d.id] ? (
                      <>
                        <ChannelBadge label="SSH" check={conn[d.id]?.checks?.ssh} />
                        <ChannelBadge label="NETCONF" check={conn[d.id]?.checks?.netconf} />
                        <ChannelBadge label="SNMP" check={conn[d.id]?.checks?.snmp} />
                      </>
                    ) : (
                      <span className="label">—</span>
                    )}
                  </td>
                  <td className="num">
                    <button onClick={() => void test(d)}>testar</button>{' '}
                    <button onClick={() => void saveCred(d)}>cred</button>{' '}
                    <button onClick={() => void sync(d)}>snmp+disc</button>{' '}
                    <button onClick={() => edit(d)}>editar</button>{' '}
                    <button onClick={() => void remove(d)}>remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
