import Link from 'next/link';

/**
 * Hotsite — landing de marketing do NetX (home pública do domínio do Hub).
 * Apresenta o produto pra ISPs e direciona pra central do cliente / contato.
 * Edite os dados de contato abaixo.
 */
const CONTACT = {
  whatsapp: 'https://wa.me/5500000000000', // ← troque pelo WhatsApp de vendas
  email: 'comercial@netx.com.br',
};

const FEATURES = [
  { t: 'Gestão completa de ISP', d: 'Clientes, contratos, faturamento, ordens de serviço e estoque num só lugar.' },
  { t: 'RADIUS + provisionamento', d: 'Autenticação PPPoE, OLT/ONT e TR-069 integrados — ative o cliente em campo.' },
  { t: 'Financeiro de verdade', d: 'Faturas automáticas, Pix/boleto, contas a pagar e fluxo de caixa.' },
  { t: 'Multi-país (BR + PY)', d: 'Locale, moeda e fiscal por operação. Pronto pra Brasil e Paraguai.' },
  { t: 'Rede neutra', d: 'Integração com orquestradores (Ufinet) pra alta/baja automática.' },
  { t: 'Na sua infraestrutura', d: 'Cada provedor roda a própria instância — seus dados, sua soberania.' },
];

export default function Hotsite() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-bold tracking-tight">NetX</span>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/portal" className="text-slate-600 hover:text-slate-900">Central do cliente</Link>
          <a href={CONTACT.whatsapp} className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700">
            Falar com vendas
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
          Plataforma de gestão para provedores de internet
        </span>
        <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          Tudo que o seu provedor precisa, num sistema só.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
          NetX une CRM, contratos, RADIUS, provisionamento de rede, financeiro e estoque —
          do cadastro do cliente à fatura paga, sem amarrar várias ferramentas.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <a href={CONTACT.whatsapp} className="rounded-lg bg-slate-900 px-6 py-3 text-sm font-medium text-white hover:bg-slate-700">
            Quero conhecer
          </a>
          <a href={`mailto:${CONTACT.email}`} className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-medium hover:bg-slate-50">
            Falar por e-mail
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-2xl font-bold">Feito para a operação do provedor</h2>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.t} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="font-semibold">{f.t}</h3>
                <p className="mt-2 text-sm text-slate-600">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <h2 className="text-2xl font-bold">Pronto para profissionalizar seu provedor?</h2>
        <p className="mx-auto mt-3 max-w-xl text-slate-600">
          Fale com a NetX e veja a plataforma rodando com os dados da sua operação.
        </p>
        <a href={CONTACT.whatsapp} className="mt-6 inline-block rounded-lg bg-emerald-600 px-6 py-3 text-sm font-medium text-white hover:bg-emerald-500">
          Falar com vendas
        </a>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 text-sm text-slate-500 sm:flex-row">
          <span>© NetX — Plataforma para ISPs</span>
          <div className="flex gap-4">
            <Link href="/portal" className="hover:text-slate-900">Central do cliente</Link>
            <Link href="/admin" className="hover:text-slate-900">Equipe NetX</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
