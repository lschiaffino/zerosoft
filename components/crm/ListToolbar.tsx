'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';

export interface ToolbarSelect {
  /** Query param que controla. */
  param: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  /** Valor actual ('' = todos). */
  value: string;
}

interface ListToolbarProps {
  searchLabel: string;
  q: string;
  selects: ToolbarSelect[];
  /** Query vigente a conservar (view, filters…); page se resetea. */
  query: Record<string, string>;
}

/**
 * Búsqueda y filtros rápidos de una lista (leads, registros de objetos):
 * cada cambio navega con los parámetros nuevos y vuelve a la página 1. La
 * búsqueda espera a que se deje de escribir.
 */
export default function ListToolbar({ searchLabel, q, selects, query }: ListToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [text, setText] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setText(q), [q]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function go(patch: Record<string, string>) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...query, ...patch })) if (v && k !== 'page') params.set(k, v);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="filter-toolbar crm-list-toolbar" role="search">
      <input
        type="search"
        className="input filter-search"
        value={text}
        placeholder={searchLabel}
        aria-label={searchLabel}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => go({ q: v.trim() }), 300);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (timer.current) clearTimeout(timer.current);
            go({ q: text.trim() });
          }
        }}
      />
      {selects.map((s) => (
        <select
          key={s.param}
          className="filter-select"
          aria-label={s.label}
          value={s.value}
          onChange={(e) => go({ [s.param]: e.target.value })}
        >
          {s.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}
