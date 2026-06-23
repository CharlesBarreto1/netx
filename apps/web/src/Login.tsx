import { useState } from 'react';
import { api, type AuthUser } from './api.js';

/** Tela de login. Em sucesso, devolve o usuário autenticado para o App montar a sessão. */
export function Login({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.login(username.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={(e) => void submit(e)}>
        <h1>NetX NMS</h1>
        <p className="sub">Acesso restrito — entre com suas credenciais.</p>
        <label>
          Usuário
          <input
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="err">{error}</p>}
        <button disabled={busy || !username || !password} type="submit">
          {busy ? 'entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
