import { useEffect, useState } from 'react';
import { api, type Role, type UserView } from './api.js';

const ROLES: Role[] = ['admin', 'operator', 'viewer'];

/** Painel de gestão de usuários (só admin). Criar, mudar papel, ativar/desativar, redefinir senha. */
export function Users({ me, onClose }: { me: string; onClose: () => void }) {
  const [users, setUsers] = useState<UserView[]>([]);
  const [msg, setMsg] = useState<string>('');
  const [nu, setNu] = useState({ username: '', password: '', name: '', role: 'viewer' as Role });

  const load = () =>
    api.users
      .list()
      .then(setUsers)
      .catch((e: unknown) => setMsg(String(e)));
  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    setMsg('criando…');
    try {
      await api.users.create({
        username: nu.username.trim(),
        password: nu.password,
        name: nu.name.trim() || undefined,
        role: nu.role,
      });
      setNu({ username: '', password: '', name: '', role: 'viewer' });
      setMsg('');
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const update = async (id: string, patch: Parameters<typeof api.users.update>[1]) => {
    try {
      await api.users.update(id, patch);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const resetPwd = async (u: UserView) => {
    const pwd = prompt(`Nova senha para "${u.username}" (mín. 8 caracteres):`);
    if (!pwd) return;
    await update(u.id, { password: pwd });
    setMsg(`senha de ${u.username} redefinida`);
  };

  const remove = async (u: UserView) => {
    if (!confirm(`Remover o usuário "${u.username}"?`)) return;
    try {
      await api.users.remove(u.id);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="term-modal">
      <div className="term-head">
        <span>Usuários de acesso</span>
        <button onClick={onClose}>fechar ✕</button>
      </div>
      <div className="term-body" style={{ overflow: 'auto', padding: 16 }}>
        {msg && <p className="err">{msg}</p>}

        <div className="panel">
          <h2>Novo usuário</h2>
          <div className="btns" style={{ flexWrap: 'wrap' }}>
            <input
              placeholder="usuário"
              value={nu.username}
              onChange={(e) => setNu({ ...nu, username: e.target.value })}
            />
            <input
              placeholder="nome (opcional)"
              value={nu.name}
              onChange={(e) => setNu({ ...nu, name: e.target.value })}
            />
            <input
              type="password"
              placeholder="senha (mín. 8)"
              value={nu.password}
              onChange={(e) => setNu({ ...nu, password: e.target.value })}
            />
            <select
              value={nu.role}
              onChange={(e) => setNu({ ...nu, role: e.target.value as Role })}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button disabled={!nu.username || nu.password.length < 8} onClick={() => void create()}>
              + Criar
            </button>
          </div>
        </div>

        <div className="panel full">
          <h2>Usuários ({users.length})</h2>
          <table>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Nome</th>
                <th>Papel</th>
                <th>Ativo</th>
                <th>Último login</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.username}
                    {u.username === me && <span className="label"> (você)</span>}
                  </td>
                  <td>{u.name ?? '—'}</td>
                  <td>
                    <select
                      value={u.role}
                      onChange={(e) => void update(u.id, { role: e.target.value as Role })}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.active}
                      onChange={(e) => void update(u.id, { active: e.target.checked })}
                    />
                  </td>
                  <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}</td>
                  <td className="num">
                    <button onClick={() => void resetPwd(u)}>senha</button>{' '}
                    <button onClick={() => void remove(u)}>remover</button>
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
