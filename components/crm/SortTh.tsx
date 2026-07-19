'use client';

import { useSearchParams } from 'next/navigation';
import { Link, usePathname } from '@/i18n/navigation';

interface SortThProps {
  label: string;
  /** Valor de sort ascendente para esta columna. */
  asc: string;
  /** Valor de sort descendente para esta columna. */
  desc: string;
  /** Sort efectivo actual (lo decide el server). */
  current: string;
  /** Sort default: si el próximo valor es este, se omite el param. */
  reset?: string;
}

/**
 * Header de columna ordenable (estilo Twenty): click alterna asc/desc,
 * flecha ▲▼ en la columna activa. Preserva el resto de los query params
 * y resetea la paginación.
 */
export default function SortTh({ label, asc, desc, current, reset = 'newest' }: SortThProps) {
  const pathname = usePathname();
  const params = useSearchParams();

  const next = current === asc ? desc : asc;
  const q = new URLSearchParams(params.toString());
  q.delete('page');
  if (next === reset) q.delete('sort');
  else q.set('sort', next);
  const qs = q.toString();

  const active = current === asc || current === desc;
  const arrow = current === asc ? '▲' : current === desc ? '▼' : '';

  return (
    <Link
      href={qs ? `${pathname}?${qs}` : pathname}
      className={`th-sort${active ? ' active' : ''}`}
    >
      {label}
      <span className="sort-arrow" aria-hidden>
        {arrow}
      </span>
    </Link>
  );
}
