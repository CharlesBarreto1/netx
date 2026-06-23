export const inputCls = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Badge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-700',
    PAID: 'bg-emerald-100 text-emerald-700',
    BLOCKED: 'bg-red-100 text-red-700',
    OVERDUE: 'bg-red-100 text-red-700',
    SUSPENDED: 'bg-amber-100 text-amber-700',
    OPEN: 'bg-amber-100 text-amber-700',
    CANCELLED: 'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}
