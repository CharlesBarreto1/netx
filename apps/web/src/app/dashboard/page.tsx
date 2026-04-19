'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface StoredUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
}

interface StoredTenant {
  id: string;
  slug: string;
  name: string;
  locale: string;
  timezone: string;
  currency: string;
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [tenant, setTenant] = useState<StoredTenant | null>(null);

  useEffect(() => {
    const u = sessionStorage.getItem('netx.user');
    const t = sessionStorage.getItem('netx.tenant');
    if (!u || !t) {
      router.replace('/login');
      return;
    }
    setUser(JSON.parse(u));
    setTenant(JSON.parse(t));
  }, [router]);

  function logout() {
    sessionStorage.clear();
    router.push('/login');
  }

  if (!user || !tenant) return null;

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">NetX</h1>
          <p className="text-xs text-slate-500">{tenant.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm">{user.firstName} {user.lastName}</span>
          <button onClick={logout} className="text-sm text-brand-600 hover:underline">
            Sair
          </button>
        </div>
      </header>

      <section className="p-8 max-w-5xl mx-auto space-y-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Bem-vindo, {user.firstName}!</h2>
          <p className="text-slate-600 dark:text-slate-300">
            O Módulo Core está ativo. Os módulos seguintes (CRM, Financeiro, RADIUS, OLT, etc.) serão
            habilitados conforme o roadmap.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card title="Seu acesso">
            <p className="text-sm"><strong>Email:</strong> {user.email}</p>
            <p className="text-sm"><strong>Papéis:</strong> {user.roles.join(', ') || '—'}</p>
            <p className="text-sm"><strong>Permissões:</strong> {user.permissions.length}</p>
          </Card>

          <Card title="Tenant">
            <p className="text-sm"><strong>Slug:</strong> {tenant.slug}</p>
            <p className="text-sm"><strong>Idioma:</strong> {tenant.locale}</p>
            <p className="text-sm"><strong>Fuso:</strong> {tenant.timezone}</p>
            <p className="text-sm"><strong>Moeda:</strong> {tenant.currency}</p>
          </Card>
        </div>
      </section>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-6 space-y-2">
      <h3 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {children}
    </div>
  );
}
