'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { adminToken } from '@/lib/api';

/** Barra de navegação do painel admin (equipe NetX). */
export function AdminNav() {
  const router = useRouter();
  const pathname = usePathname();
  const link = (href: string, label: string) => {
    const active = pathname === href || (href !== '/admin' && pathname.startsWith(href));
    return (
      <Link
        href={href}
        className={`rounded-md px-3 py-1.5 text-sm ${active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
      >
        {label}
      </Link>
    );
  };
  return (
    <nav className="mb-6 flex items-center gap-2 border-b border-slate-200 pb-3">
      <span className="mr-2 font-bold tracking-tight">NetX Hub</span>
      {link('/admin', 'Clientes')}
      {link('/admin/wiki', 'Wiki')}
      <button
        onClick={() => {
          adminToken.clear();
          router.replace('/admin/login');
        }}
        className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm"
      >
        Sair
      </button>
    </nav>
  );
}
