import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  clearToken,
  getToken,
  onUnauthorized,
  type AuthUser,
  type ConfigChange,
  type ConfigSnapshot,
  type Device,
  type DeviceEvent,
  type DeviceInterface,
  type InterfaceRate,
  type OpticalReading,
  type Playbook,
  type SnapshotDetail,
  type SystemReading,
} from './api.js';
import { bps, opticalColor, severityColor, speed, statusColor, tempColor } from './format.js';
import { Terminal } from './Terminal.js';
import { Login } from './Login.js';
import { Users } from './Users.js';
import { DeviceManager } from './DeviceManager.js';

const REFRESH_MS = 30_000;

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  // Restaura a sessão a partir do token salvo (valida com /auth/me).
  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setReady(true));
  }, []);

  // Qualquer 401 derruba a sessão e volta ao login.
  useEffect(() => {
    const onUnauth = () => setUser(null);
    onUnauthorized.addEventListener('unauthorized', onUnauth);
    return () => onUnauthorized.removeEventListener('unauthorized', onUnauth);
  }, []);

  const logout = useCallback(() => {
    api.logout();
    setUser(null);
  }, []);

  if (!ready) return null;
  if (!user) return <Login onLogin={setUser} />;
  return <Console user={user} onLogout={logout} />;
}

function Console({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [terminal, setTerminal] = useState(false);
  const [usersPanel, setUsersPanel] = useState(false);
  const [manage, setManage] = useState(false);
  const canWrite = user.role === 'admin' || user.role === 'operator';
  const isAdmin = user.role === 'admin';

  const loadDevices = useCallback(() => {
    api
      .devices()
      .then((d) => {
        setDevices(d);
        setSelected((s) => s || (d.length ? d[0]!.id : ''));
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  const device = devices.find((d) => d.id === selected);

  return (
    <div className="wrap">
      <div className="topbar">
        <h1>NetX NMS</h1>
        <div className="session">
          <span className="label">
            {user.username} · <strong>{user.role}</strong>
          </span>
          {isAdmin && <button onClick={() => setManage(true)}>Equipamentos</button>}
          {isAdmin && <button onClick={() => setUsersPanel(true)}>Usuários</button>}
          <button onClick={onLogout}>sair</button>
        </div>
      </div>
      <p className="sub">
        Gestão técnica de rede multi-vendor (Juniper + Mikrotik + Cisco IOS-XE) — observar, documentar,
        diagnosticar e aplicar.
      </p>
      {error && <p className="err">{error}</p>}
      {devices.length > 0 ? (
        <div className="toolbar">
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.hostname} — {d.mgmtIp} ({d.vendor})
              </option>
            ))}
          </select>
          {device && canWrite && <button onClick={() => setTerminal(true)}>⌨ Terminal SSH</button>}
        </div>
      ) : (
        <p className="empty">
          Nenhum equipamento cadastrado.{' '}
          {isAdmin ? 'Use “Equipamentos” para adicionar.' : 'Peça a um admin para cadastrar.'}
        </p>
      )}
      {device && <Dashboard device={device} canWrite={canWrite} />}
      {device && terminal && <Terminal deviceId={device.id} onClose={() => setTerminal(false)} />}
      {usersPanel && <Users me={user.username} onClose={() => setUsersPanel(false)} />}
      {manage && (
        <DeviceManager onClose={() => setManage(false)} onChanged={loadDevices} />
      )}
    </div>
  );
}

function Dashboard({ device, canWrite }: { device: Device; canWrite: boolean }) {
  const [ifaces, setIfaces] = useState<DeviceInterface[]>([]);
  const [rates, setRates] = useState<InterfaceRate[]>([]);
  const [optical, setOptical] = useState<OpticalReading[]>([]);
  const [system, setSystem] = useState<SystemReading[]>([]);
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [updated, setUpdated] = useState<string>('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [i, r, o, s, e] = await Promise.all([
        api.interfaces(device.id).catch(() => []),
        api.rates(device.id).catch(() => []),
        api.optical(device.id).catch(() => []),
        api.system(device.id).catch(() => []),
        api.events(device.id).catch(() => []),
      ]);
      if (!alive) return;
      setIfaces(i);
      setRates(r);
      setOptical(o);
      setSystem(s);
      setEvents(e);
      setUpdated(new Date().toLocaleTimeString());
    };
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [device.id]);

  const rateByName = useMemo(() => new Map(rates.map((r) => [r.ifName, r])), [rates]);
  const rows = useMemo(
    () =>
      ifaces
        .map((i) => ({ ...i, rate: rateByName.get(i.name) }))
        .filter((i) => i.operStatus === 'up' || i.rate?.inBps || i.rate?.outBps)
        .sort(
          (a, b) =>
            Number(b.rate?.inBps ?? 0) +
            Number(b.rate?.outBps ?? 0) -
            Number(a.rate?.inBps ?? 0) -
            Number(a.rate?.outBps ?? 0),
        )
        .slice(0, 15),
    [ifaces, rateByName],
  );

  return (
    <>
      <p className="sub">
        {device.model ?? device.vendor} · {device.site ?? '—'} · {ifaces.length} interfaces ·
        atualizado {updated || '…'}
      </p>
      <div className="grid">
        <div className="panel">
          <h2>Saúde do sistema</h2>
          {system.filter((s) => (s.tempC ?? 0) > 0).length === 0 ? (
            <p className="empty">Sem leituras recentes (device coletando?)</p>
          ) : (
            <div className="cards">
              {system
                .filter((s) => (s.tempC ?? 0) > 0)
                .map((s) => (
                  <div className="card" key={s.component}>
                    <div className="label">{s.component}</div>
                    <div className="val" style={{ color: tempColor(s.tempC) }}>
                      {s.tempC ?? '—'}°C
                    </div>
                    <div className="label">CPU {s.cpuPct ?? '—'}%</div>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="panel">
          <h2>Óptica (luz RX / TX)</h2>
          {optical.length === 0 ? (
            <p className="empty">Sem leituras ópticas recentes</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Interface</th>
                  <th className="num">RX dBm</th>
                  <th className="num">TX dBm</th>
                  <th className="num">Temp</th>
                </tr>
              </thead>
              <tbody>
                {optical.map((o) => (
                  <tr key={o.ifName}>
                    <td>{o.ifName}</td>
                    <td className="num" style={{ color: opticalColor(o.rxDbm) }}>
                      {o.rxDbm ?? '—'}
                    </td>
                    <td className="num" style={{ color: opticalColor(o.txDbm) }}>
                      {o.txDbm ?? '—'}
                    </td>
                    <td className="num">{o.moduleTempC ?? '—'}°C</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel full">
          <h2>Eventos recentes (traps SNMP)</h2>
          {events.length === 0 ? (
            <p className="empty">
              Nenhum trap recebido (configure o device p/ enviar a este coletor:162)
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Severidade</th>
                  <th>Tipo</th>
                  <th>Detalhe</th>
                  <th>Origem</th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 12).map((e, idx) => (
                  <tr key={idx}>
                    <td>{new Date(e.ts).toLocaleString()}</td>
                    <td>
                      <span className="dot" style={{ background: severityColor(e.severity) }} />
                      {e.severity}
                    </td>
                    <td>{e.type}</td>
                    <td>{e.message ?? '—'}</td>
                    <td>{e.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel full">
          <h2>Interfaces (ativas / com tráfego)</h2>
          {rows.length === 0 ? (
            <p className="empty">
              Nenhuma interface ativa com dados — rode discovery e aguarde coleta
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Interface</th>
                  <th>Descrição</th>
                  <th>Status</th>
                  <th className="num">Speed</th>
                  <th className="num">↓ In</th>
                  <th className="num">↑ Out</th>
                  <th className="num">Erros</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.name}>
                    <td>{i.name}</td>
                    <td>{i.description ?? '—'}</td>
                    <td>
                      <span className="dot" style={{ background: statusColor(i.operStatus) }} />
                      {i.operStatus}
                    </td>
                    <td className="num">{speed(i.speedBps)}</td>
                    <td className="num">{bps(i.rate?.inBps ?? null)}</td>
                    <td className="num">{bps(i.rate?.outBps ?? null)}</td>
                    <td
                      className="num"
                      style={{ color: (i.rate?.inErrors ?? 0) > 0 ? 'var(--warn)' : undefined }}
                    >
                      {(i.rate?.inErrors ?? 0) + (i.rate?.outErrors ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <PlaybooksPanel deviceId={device.id} vendor={device.vendor} canWrite={canWrite} />
        <BackupPanel deviceId={device.id} canWrite={canWrite} />
        {canWrite && <ConfigApplyPanel deviceId={device.id} vendor={device.vendor} />}
        <CopilotPanel deviceId={device.id} />
      </div>
    </>
  );
}

function CopilotPanel({ deviceId }: { deviceId: string }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .aiStatus()
      .then((s) => setAvailable(s.available))
      .catch(() => setAvailable(false));
  }, []);

  const ask = async () => {
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    setAnswer('');
    try {
      const r = await api.copilot(deviceId, q);
      setAnswer(r.answer);
    } catch (e) {
      setAnswer(`erro: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel full">
      <h2>Copiloto de diagnóstico (IA)</h2>
      {available === false ? (
        <p className="empty">
          IA indisponível — configure <code>ANTHROPIC_API_KEY</code> no apps/api/.env.
        </p>
      ) : (
        <>
          <div className="btns">
            <input
              style={{ flex: 1, minWidth: 280 }}
              placeholder="Ex.: por que a xe-0/0/0 está com erro? a óptica está saudável?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void ask()}
            />
            <button disabled={busy} onClick={() => void ask()}>
              {busy ? 'pensando…' : 'Perguntar'}
            </button>
          </div>
          {answer && <pre className="term">{answer}</pre>}
          <p className="label">
            Read-only: o copiloto explica e sugere com base nos dados coletados; nunca age no
            equipamento.
          </p>
        </>
      )}
    </div>
  );
}

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="term">
      {diff.split('\n').map((line, i) => {
        let color: string | undefined;
        if (line.startsWith('+') && !line.startsWith('+++')) color = 'var(--ok)';
        else if (line.startsWith('-') && !line.startsWith('---')) color = 'var(--danger)';
        else if (line.startsWith('@@')) color = 'var(--accent)';
        return (
          <div key={i} style={{ color }}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

function BackupPanel({ deviceId, canWrite }: { deviceId: string; canWrite: boolean }) {
  const [snaps, setSnaps] = useState<ConfigSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<SnapshotDetail | null>(null);
  const [msg, setMsg] = useState<string>('');

  const load = () =>
    api
      .snapshots(deviceId)
      .then(setSnaps)
      .catch(() => setSnaps([]));
  useEffect(() => {
    void load();
  }, [deviceId]);

  const runBackup = async () => {
    setBusy(true);
    setMsg('coletando config…');
    try {
      const r = await api.backup(deviceId);
      setMsg(
        r.changed
          ? `nova versão: ${r.diffSummary ?? r.gitHash.slice(0, 8)}`
          : 'sem mudança na config',
      );
      await load();
    } catch (e) {
      setMsg(`erro: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const openSnap = async (id: string) => {
    setDetail(null);
    setMsg('carregando diff…');
    try {
      setDetail(await api.snapshot(deviceId, id));
      setMsg('');
    } catch (e) {
      setMsg(`erro: ${String(e)}`);
    }
  };

  return (
    <div className="panel full">
      <h2>Backup de configuração (git)</h2>
      <div className="btns">
        {canWrite && (
          <button disabled={busy} onClick={() => void runBackup()}>
            {busy ? '…' : '⤓ Fazer backup agora'}
          </button>
        )}
        {msg && <span className="label">{msg}</span>}
      </div>
      {snaps.length === 0 ? (
        <p className="empty">Nenhum snapshot ainda — rode um backup.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Commit</th>
              <th>Mudança</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {snaps.map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.capturedAt).toLocaleString()}</td>
                <td>{s.gitHash.slice(0, 8)}</td>
                <td>{s.diffSummary ?? '—'}</td>
                <td className="num">
                  <button onClick={() => void openSnap(s.id)}>ver diff</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {detail && (
        <>
          <div className="label" style={{ marginTop: 12 }}>
            {new Date(detail.capturedAt).toLocaleString()} · {detail.gitHash.slice(0, 8)} ·{' '}
            {detail.diffSummary ?? '—'}
          </div>
          {detail.diff.trim() ? (
            <DiffView diff={detail.diff} />
          ) : (
            <pre className="term">{detail.config.slice(0, 4000)}</pre>
          )}
        </>
      )}
    </div>
  );
}

function ConfigApplyPanel({ deviceId, vendor }: { deviceId: string; vendor: string }) {
  const [config, setConfig] = useState('');
  const [confirmMinutes, setConfirmMinutes] = useState(5);
  const [diff, setDiff] = useState('');
  const [planned, setPlanned] = useState(false);
  const [pending, setPending] = useState<ConfigChange | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; detail: string } | null>(null);
  const [history, setHistory] = useState<ConfigChange[]>([]);
  const [busy, setBusy] = useState<'plan' | 'apply' | 'confirm' | null>(null);
  const [msg, setMsg] = useState('');

  const placeholder =
    vendor === 'mikrotik'
      ? '/ip address add address=10.0.0.2/24 interface=ether1'
      : vendor === 'cisco_iosxe'
        ? 'interface TenGigabitEthernet0/0/1\n description uplink-core'
        : 'set interfaces ge-0/0/0 description "uplink-core"';

  // Estado persistido: mudança pendente (rollback armado) + histórico — sobrevive a reload.
  const loadState = useCallback(() => {
    void api.config
      .pending(deviceId)
      .then(setPending)
      .catch(() => setPending(null));
    void api.config
      .changes(deviceId)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [deviceId]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  // Editar a config invalida o plan anterior (precisa re-planejar antes de aplicar).
  const onEdit = (v: string) => {
    setConfig(v);
    setPlanned(false);
    setDiff('');
  };

  const plan = async () => {
    setBusy('plan');
    setMsg('calculando diff (dry-run)…');
    try {
      const r = await api.config.plan(deviceId, config);
      setDiff(r.diff);
      setPlanned(true);
      setMsg(r.diff.trim() ? r.detail : 'sem mudança (config idêntica)');
    } catch (e) {
      setPlanned(false);
      setMsg(`erro: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!window.confirm(`Aplicar config no equipamento? Rollback automático em ${confirmMinutes}min se não confirmar.`))
      return;
    setBusy('apply');
    setMsg('aplicando…');
    setVerify(null);
    try {
      const r = await api.config.apply(deviceId, config, confirmMinutes);
      setDiff(r.diff || diff);
      setVerify(r.verify);
      setMsg(r.detail);
      loadState();
    } catch (e) {
      setMsg(`erro: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const confirm = async () => {
    setBusy('confirm');
    setMsg('confirmando…');
    try {
      const r = await api.config.confirm(deviceId);
      setVerify(null);
      setPlanned(false);
      setMsg(r.detail);
      loadState();
    } catch (e) {
      setMsg(`erro: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const isPending = pending !== null;

  return (
    <div className="panel full">
      <h2>Aplicar configuração ({vendor}) — escrita</h2>
      <p className="label">
        Padrão seguro: planejar → revisar o diff → aplicar (rollback automático armado) →
        verificar acesso → confirmar. Sem confirmar, o equipamento reverte sozinho.
      </p>
      <textarea
        className="config-editor"
        style={{ width: '100%', minHeight: 120, fontFamily: 'monospace', boxSizing: 'border-box' }}
        placeholder={placeholder}
        value={config}
        onChange={(e) => onEdit(e.target.value)}
        disabled={isPending}
      />
      <div className="btns" style={{ marginTop: 8 }}>
        <button disabled={busy !== null || !config.trim() || isPending} onClick={() => void plan()}>
          {busy === 'plan' ? '…' : '1· Planejar (diff)'}
        </button>
        <button
          disabled={busy !== null || !planned || !diff.trim() || isPending}
          onClick={() => void apply()}
        >
          {busy === 'apply' ? '…' : '2· Aplicar'}
        </button>
        <label className="label">
          rollback em{' '}
          <input
            type="number"
            min={1}
            max={60}
            value={confirmMinutes}
            onChange={(e) => setConfirmMinutes(Number(e.target.value) || 5)}
            style={{ width: 56 }}
            disabled={isPending}
          />{' '}
          min
        </label>
        {isPending && (
          <button disabled={busy !== null} onClick={() => void confirm()}>
            {busy === 'confirm' ? '…' : '3· Confirmar (travar)'}
          </button>
        )}
        {msg && <span className="label">{msg}</span>}
      </div>
      {verify && (
        <p className="label" style={{ color: verify.ok ? 'var(--ok)' : 'var(--warn)' }}>
          verify: {verify.detail}
        </p>
      )}
      {isPending && (
        <p className="err">
          ⚠ Mudança aplicada mas NÃO confirmada
          {pending.confirmDeadline
            ? ` (rollback ~${new Date(pending.confirmDeadline).toLocaleTimeString()})`
            : ''}{' '}
          — verifique o acesso ao equipamento e clique “Confirmar” antes do rollback automático.
        </p>
      )}
      {diff.trim() && <DiffView diff={diff} />}
      {history.length > 0 && (
        <>
          <div className="label" style={{ marginTop: 12 }}>
            Histórico de mudanças
          </div>
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>Status</th>
                <th>Verify</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 8).map((h) => (
                <tr key={h.id}>
                  <td>{new Date(h.createdAt).toLocaleString()}</td>
                  <td>{h.actor}</td>
                  <td>{h.status}</td>
                  <td>{h.verifyOk === null ? '—' : h.verifyOk ? 'ok' : 'falhou'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function PlaybooksPanel({
  deviceId,
  vendor,
  canWrite,
}: {
  deviceId: string;
  vendor: string;
  canWrite: boolean;
}) {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [title, setTitle] = useState<string>('');
  const [output, setOutput] = useState<string>('');

  useEffect(() => {
    api
      .playbooks(vendor)
      .then(setPlaybooks)
      .catch(() => setPlaybooks([]));
  }, [vendor]);

  const run = async (pb: Playbook) => {
    setRunning(pb.id);
    setTitle(`${pb.name} — ${pb.command}`);
    setOutput('executando…');
    try {
      const r = await api.runPlaybook(deviceId, pb.id);
      setOutput(r.output || '(sem saída)');
    } catch (e) {
      setOutput(`erro: ${String(e)}`);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="panel full">
      <h2>Diagnóstico — playbooks (read-only)</h2>
      {canWrite ? (
        <div className="btns">
          {playbooks.map((pb) => (
            <button key={pb.id} disabled={running !== null} onClick={() => void run(pb)}>
              {running === pb.id ? '…' : pb.name}
            </button>
          ))}
        </div>
      ) : (
        <p className="empty">Seu papel (viewer) não executa playbooks.</p>
      )}
      {output && (
        <>
          <div className="label" style={{ marginTop: 12 }}>
            {title}
          </div>
          <pre className="term">{output}</pre>
        </>
      )}
    </div>
  );
}
