'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useDismiss } from '@/components/groups/wa/useDismiss';
import SortTh from './SortTh';
import CrmIcon from './CrmIcon';
import { useIndexColumns, type TableColumnsState } from './EditColumns';
import ColumnFilter from './ColumnFilter';
import { columnFilterAliases, columnFilterKey } from './tableColumns';
import { fieldRuleState, type FilterModel } from '@/lib/crm-filter-model';
import { OPEN_FILTERS_EVENT } from './advancedFilterText';

/** ¿Algo filtra lo que muestra la columna? Una regla sobre su propiedad (o una equivalente) o un filtro rápido. */
function columnFiltered(model: FilterModel, keys: readonly string[], quick: readonly string[] = []): boolean {
  return keys.some((k) => quick.includes(k) || model.groups.some((g) => g.rules.some((r) => r.f === k)));
}
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, clampColumnWidth } from '@/lib/crm-views-shared';

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
  const api = useIndexColumns();
  const t = useTranslations('crm.columnMenu');
  const filterKey = api?.entity ? columnFilterKey(api.entity, id) : null;
  const filtered = !!(
    filterKey &&
    api?.entity &&
    api.filters &&
    columnFiltered(api.filters.model, [filterKey, ...columnFilterAliases(api.entity, id)], api.filters.quick)
  );
  return (
    <th className={className} data-card={card} data-col={id} data-filtered={filtered ? 'true' : undefined}>
      <span className="th-wrap">
        {asc && desc ? <SortTh label={label} asc={asc} desc={desc} current={sort} reset={reset} /> : <span className="th-label">{label}</span>}
        {filtered && (
          <span className="th-filtered" role="img" aria-label={t('filtered')} title={t('filtered')} data-testid={`col-filtered-${id}`}>
            <CrmIcon name="filter" size={12} />
          </span>
        )}
        {children}
        <ColumnMenu id={id} label={label} asc={asc} desc={desc} sort={sort} reset={reset} />
      </span>
      {api && <ResizeHandle api={api} id={id} label={label} />}
    </th>
  );
}

/** Flechas: 10 px (con Mayúsculas, 50). */
const KEY_STEP = 10;
const KEY_STEP_BIG = 50;

/** Ancho que la columna ocupa ahora en pantalla. */
function measured(th: HTMLElement | null): number {
  return th ? Math.round(th.getBoundingClientRect().width) : 0;
}

/**
 * Los anchos de todas las columnas a la vista, con los que ya tenían ancho
 * guardado. La primera vez que se cambia uno, la tabla pasa de acomodarse
 * sola a anchos fijos: se toman los que se ven, así nada salta.
 */
function snapshot(api: TableColumnsState, th: HTMLElement | null): Record<string, number> {
  const out: Record<string, number> = {};
  const row = th?.parentElement;
  for (const id of api.order) {
    if (api.widths[id]) {
      out[id] = api.widths[id];
      continue;
    }
    const cell = row?.querySelector<HTMLElement>(`:scope > th[data-col="${CSS.escape(id)}"]`) ?? null;
    const w = measured(cell);
    if (w > 0) out[id] = clampColumnWidth(w);
  }
  return out;
}

/** ¿La tabla ya tiene un ancho para cada columna a la vista? */
function allSized(api: TableColumnsState, widths: Record<string, number>): boolean {
  return api.order.every((id) => (api.widths[id] ?? 0) === (widths[id] ?? 0));
}

/**
 * Ancho que pide lo que la columna muestra (doble clic en el borde, como en
 * HubSpot): una copia oculta de la tabla, sin anchos fijos ni topes, dice
 * cuánto ocupan el encabezado y la celda más ancha.
 */
function fitWidth(th: HTMLTableCellElement): number {
  const table = th.closest('table');
  if (!table?.parentElement) return measured(th);
  const clone = table.cloneNode(true) as HTMLTableElement;
  clone.querySelector('colgroup')?.remove();
  clone.classList.add('is-sized', 'is-fitting');
  clone.setAttribute('aria-hidden', 'true');
  clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  clone.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;table-layout:auto;width:max-content;min-width:0;';
  table.parentElement.appendChild(clone);
  const cell = clone.tHead?.rows[0]?.cells[th.cellIndex];
  const w = measured(cell ?? null);
  clone.remove();
  return clampColumnWidth(w || measured(th));
}

/**
 * Borde del encabezado para cambiar el ancho de la columna, como en HubSpot:
 * arrastrar, doble clic para ajustarla a lo que muestra, y con el teclado
 * (foco en el borde, flechas izquierda y derecha, Enter ajusta). El ancho
 * queda en la URL y se guarda con la vista (`widths`).
 */
function ResizeHandle({ api, id, label }: { api: TableColumnsState; id: string; label: string }) {
  const t = useTranslations('crm.columnMenu');
  const ref = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ x: number; start: number; base: Record<string, number>; prev: Record<string, number>; last: number } | null>(null);
  const th = () => (ref.current?.parentElement ?? null) as HTMLTableCellElement | null;
  // Sin ancho guardado, el que se ve (se mide al tomar el foco: un separador con foco dice su valor).
  const [seen, setSeen] = useState(0);
  const current = api.widths[id] ?? 0;
  const shown = current || seen;

  /** Mientras se arrastra cambia solo la columna en pantalla (sin volver a dibujar la tabla en cada paso). */
  function paint(w: number): boolean {
    const table = th()?.closest('table');
    const col = table?.querySelector<HTMLElement>(`col[data-col="${CSS.escape(id)}"]`);
    if (!table || !col) return false;
    col.style.width = `${w}px`;
    let total = 0;
    table.querySelectorAll<HTMLElement>('col').forEach((c) => {
      total += parseFloat(c.style.width) || 0;
    });
    table.style.setProperty('--crm-table-w', `${total}px`);
    ref.current?.setAttribute('aria-valuenow', String(w));
    return true;
  }

  function onPointerDown(e: ReactPointerEvent<HTMLSpanElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const base = snapshot(api, th());
    const start = base[id] ?? measured(th());
    drag.current = { x: e.clientX, start, base, prev: api.widths, last: start };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // La primera vez la tabla pasa a anchos fijos con los que se ven: nada salta.
    if (!allSized(api, base)) api.setWidths(base, false);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLSpanElement>) {
    const d = drag.current;
    if (!d) return;
    // Se soltó el botón sin que llegara el pointerup (otra ventana, un diálogo): termina el arrastre.
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) {
      onPointerUp(e);
      return;
    }
    const w = clampColumnWidth(d.start + e.clientX - d.x);
    if (w === d.last) return;
    d.last = w;
    if (!paint(w)) api.setWidths({ ...d.base, [id]: w }, false);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLSpanElement>) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // Un clic sin mover no cambia nada (y no deja la vista modificada).
    if (d.last !== d.start) api.setWidths({ ...d.base, [id]: d.last }, true);
    else api.setWidths(d.prev, false);
  }

  function fit() {
    const cell = th();
    if (!cell) return;
    api.setWidths({ ...snapshot(api, cell), [id]: fitWidth(cell) }, true);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLSpanElement>) {
    const step = e.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const now = current || measured(th());
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = now - step;
    else if (e.key === 'ArrowRight') next = now + step;
    else if (e.key === 'Home') next = MIN_COLUMN_WIDTH;
    else if (e.key === 'End') next = MAX_COLUMN_WIDTH;
    else if (e.key === 'Enter') {
      e.preventDefault();
      fit();
      return;
    }
    if (next === null) return;
    e.preventDefault();
    api.setWidths({ ...snapshot(api, th()), [id]: clampColumnWidth(next) }, true);
  }

  return (
    <span
      ref={ref}
      className="th-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('resize', { name: label })}
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuemax={MAX_COLUMN_WIDTH}
      aria-valuenow={shown || undefined}
      aria-valuetext={shown ? t('widthValue', { px: shown }) : undefined}
      title={t('resizeHint')}
      tabIndex={0}
      data-testid={`col-resize-${id}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onFocus={() => setSeen(measured(th()))}
      onDoubleClick={(e) => {
        e.preventDefault();
        fit();
      }}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function ColumnMenu({ id, label, asc, desc, sort, reset }: { id: string; label: string; asc?: string; desc?: string; sort: string; reset: string }) {
  const t = useTranslations('crm.columnMenu');
  const api = useIndexColumns();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  // La propiedad que filtra esta columna, si la persona la puede filtrar (las ocultas no vienen en `fields`).
  const filterKey = api?.entity ? columnFilterKey(api.entity, id) : null;
  const filterField = filterKey ? api?.filters?.fields.find((f) => f.key === filterKey) : undefined;
  // Una regla que la columna no puede mostrar tal cual (en algunos grupos, o un mínimo y un máximo) se edita en el panel.
  const filterState = filterField && api?.filters ? fieldRuleState(api.filters.model, filterField.key) : { kind: 'none' as const };

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
            {filterField && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="th-menu-item"
                  aria-haspopup="dialog"
                  onClick={() => {
                    setOpen(false);
                    if (filterState.kind === 'complex') window.dispatchEvent(new CustomEvent(OPEN_FILTERS_EVENT));
                    else setFiltering(true);
                  }}
                  data-active={filterState.kind}
                  data-testid={`col-menu-${id}-filter`}
                >
                  {filterState.kind === 'complex' ? t('editInPanel') : filterState.kind === 'simple' ? t('editFilter') : t('filter')}
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
      {filtering &&
        filterField &&
        api?.filters &&
        createPortal(
          <ColumnFilter
            field={filterField}
            label={label}
            filters={api.filters}
            anchor={btn}
            onClose={(refocus) => {
              setFiltering(false);
              if (refocus) btn.current?.focus();
            }}
          />,
          document.body,
        )}
    </>
  );
}
