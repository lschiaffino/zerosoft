'use client';

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useDismiss } from '@/components/groups/wa/useDismiss';
import SortTh from './SortTh';
import CrmIcon from './CrmIcon';

/** Lo que el menú de cada columna necesita de la tabla (useTableColumns). */
export interface ColumnMenuApi {
  order: string[];
  /** La primera columna (el nombre): no se mueve ni se quita. */
  first: string;
  freeze: boolean;
  apply: (order: string[], freeze: boolean) => void;
}

export const ColumnMenuContext = createContext<ColumnMenuApi | null>(null);

interface HeaderCellProps {
  id: string;
  label: string;
  /** Valores de `sort` de la columna (si se puede ordenar). */
  asc?: string;
  desc?: string;
  sort: string;
  className?: string;
  /** `data-card` de la celda (las tablas pasan a tarjetas en el teléfono). */
  card?: string;
  /** Sort por defecto del listado: elegirlo quita el param. */
  reset?: string;
  children?: ReactNode;
}

/**
 * Encabezado de columna como en HubSpot: el nombre (clic alterna el orden)
 * y un menú con Ordenar A→Z / Z→A, Mover a la izquierda / derecha y Quitar
 * la columna. El menú cierra con Esc (vuelve el foco al botón) y con un clic
 * afuera. Mover y quitar cambian las columnas de la vista (`cols`).
 */
export default function HeaderCell({ id, label, asc, desc, sort, className, card, reset = 'newest', children }: HeaderCellProps) {
  return (
    <th className={className} data-card={card} data-col={id}>
      <span className="th-wrap">
        {asc && desc ? <SortTh label={label} asc={asc} desc={desc} current={sort} reset={reset} /> : <span className="th-label">{label}</span>}
        {children}
        <ColumnMenu id={id} label={label} asc={asc} desc={desc} sort={sort} reset={reset} />
      </span>
    </th>
  );
}

function ColumnMenu({ id, label, asc, desc, sort, reset }: { id: string; label: string; asc?: string; desc?: string; sort: string; reset: string }) {
  const t = useTranslations('crm.columnMenu');
  const api = useContext(ColumnMenuContext);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useDismiss(open, (reason) => {
    setOpen(false);
    if (reason === 'escape') btn.current?.focus();
  }, [btn, menu]);

  // Fijo en la pantalla (la tabla se desplaza de costado y recortaría un menú adentro).
  useLayoutEffect(() => {
    if (!open || !btn.current) {
      setPos(null);
      return;
    }
    const r = btn.current.getBoundingClientRect();
    const w = menu.current?.offsetWidth ?? 220;
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - w, window.innerWidth - 8 - w)) });
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  // Ya ubicado (antes está oculto y no toma foco): el foco va al primer ítem.
  useEffect(() => {
    if (open && pos) menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true });
  }, [open, pos]);

  if (!api) return null;
  const idx = api.order.indexOf(id);
  const isFirst = id === api.first;
  // El nombre va siempre primero: lo demás se mueve entre la segunda y la última.
  const canLeft = !isFirst && idx > 1;
  const canRight = !isFirst && idx >= 0 && idx < api.order.length - 1;

  function sortBy(value: string) {
    const q = new URLSearchParams(params.toString());
    q.delete('page');
    if (value === reset) q.delete('sort');
    else q.set('sort', value);
    const qs = q.toString();
    setOpen(false);
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function move(dir: -1 | 1) {
    if (!api) return;
    const next = [...api.order];
    next.splice(idx, 1);
    next.splice(idx + dir, 0, id);
    setOpen(false);
    api.apply(next, api.freeze);
  }

  function remove() {
    if (!api) return;
    setOpen(false);
    api.apply(api.order.filter((x) => x !== id), api.freeze);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="th-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t('label', { name: label })}
        title={t('label', { name: label })}
        data-testid={`col-menu-${id}`}
        onClick={() => setOpen((v) => !v)}
      >
        <CrmIcon name="chevronDown" size={12} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label={t('label', { name: label })}
            className="record-more-menu th-menu"
            style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
            onKeyDown={onKeyDown}
            data-testid={`col-menu-${id}-list`}
          >
            {asc && desc && (
              <>
                <button type="button" role="menuitem" className="th-menu-item" onClick={() => sortBy(asc)}>
                  {t('sortAsc')}
                </button>
                <button type="button" role="menuitem" className="th-menu-item" onClick={() => sortBy(desc)}>
                  {t('sortDesc')}
                </button>
                <span className="th-menu-sep" role="separator" />
              </>
            )}
            <button type="button" role="menuitem" className="th-menu-item" disabled={!canLeft} onClick={() => move(-1)}>
              {t('moveLeft')}
            </button>
            <button type="button" role="menuitem" className="th-menu-item" disabled={!canRight} onClick={() => move(1)}>
              {t('moveRight')}
            </button>
            {!isFirst && (
              <>
                <span className="th-menu-sep" role="separator" />
                <button type="button" role="menuitem" className="th-menu-item danger" onClick={remove} data-testid={`col-menu-${id}-remove`}>
                  {t('remove')}
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
