'use client';

/** Renderiza um diff de config com linhas coloridas (add/rem/hunk). */
export function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="mt-3 max-h-96 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200 dark:border-slate-700">
      {diff.split('\n').map((line, i) => {
        let cls = 'text-slate-300';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-emerald-400';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-red-400';
        else if (line.startsWith('@@')) cls = 'text-sky-400';
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}
