import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-200 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center px-4">
      <div className="max-w-2xl text-center space-y-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand-600">NetX</p>
        <h1 className="text-5xl font-bold text-slate-900 dark:text-slate-100">
          Plataforma multinacional para provedores de internet
        </h1>
        <p className="text-lg text-slate-600 dark:text-slate-300">
          CRM, Financeiro, RADIUS, OLT, GIS, Atendimento omnichannel e IA em um único ecossistema
          modular — multi-tenant, multi-idioma e multi-moeda desde o dia um.
        </p>
        <div className="flex gap-4 justify-center pt-4">
          <Link
            href="/login"
            className="px-6 py-3 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 transition"
          >
            Entrar
          </Link>
          <a
            href="http://localhost:3000/api/docs"
            target="_blank"
            rel="noreferrer"
            className="px-6 py-3 rounded-lg border border-slate-300 dark:border-slate-600 font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            API Docs
          </a>
        </div>
        <p className="text-xs text-slate-400 pt-8">
          MVP — Módulo Core (Auth, Multi-tenancy, RBAC, Audit)
        </p>
      </div>
    </main>
  );
}
