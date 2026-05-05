'use client';

import { Check, X } from 'lucide-react';

import { checkPassword } from '@/lib/password';

/**
 * Checklist visual da política de senha. Exibe abaixo de qualquer input
 * de senha pra indicar quais regras já passaram.
 */
export function PasswordChecklist({ value }: { value: string }) {
  const { checks } = checkPassword(value);
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {checks.map((c) => (
        <li
          key={c.label}
          className={
            'flex items-center gap-1.5 ' +
            (c.ok
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-text-muted')
          }
        >
          {c.ok ? (
            <Check className="h-3 w-3" />
          ) : (
            <X className="h-3 w-3 opacity-60" />
          )}
          {c.label}
        </li>
      ))}
    </ul>
  );
}
