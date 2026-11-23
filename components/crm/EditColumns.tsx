'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import CrmIcon from './CrmIcon';
import type { CustomColumn } from './customFieldViews';
import { CHECK_COLUMN_WIDTH, DEFAULT_COLUMN_WIDTH, INDEX_TABLES, type IndexEntity } from './tableColumns';
import {
  MODIFIED_PARAM,
  SAVED_VIEW_PARAM,
  orderedColumns,
  parseColumns,
  AUTO_WIDTHS,
  parseWidths,
  serializeColumns,
  serializeWidths,
  type ViewEntity,
} from '@/lib/crm-views-shared';

export interface ColumnDef {
  id: string;
  label: string;
  defaultVisible?: boolean;
}

// Columnas que la tabla muestra ahora, para "Guardar vista" (ViewTabs las guarda con la vista).
const current = new Map<ViewEntity, { cols: string; freeze: boolean; widths?: string }>();

export function currentColumns(entity: ViewEntity): { cols: string; freeze: boolean; widths?: string } | undefined {
  return current.get(entity);
}

/** Cuánto espera un cambio de ancho (flechas del teclado) antes de pasar a la URL. */
const WIDTHS_COMMIT_MS = 400;

function readStorage(key: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin almacenamiento: queda en la URL */
  }
}

/**
 * Columnas de la tabla, en orden, y si la primera queda fija. Manda la URL (o
 * la vista activa, que el server ya mezcló en `viewCols`/`viewFreeze`); sin
 * eso, lo último que la persona eligió en este navegador; si no, las de
 * siempre. `first` (el nombre) va siempre y va primera.
 */
export function useTableColumns(opts: {
  entity: ViewEntity;
  columns: ColumnDef[];
  storageKey: string;
  first: string;
  viewCols?: string;
  viewFreeze?: boolean;
  /** Anchos de la URL o de la vista activa (`widths`, lib/crm-views-shared.ts). */
  viewWidths?: string;
  /** Primera columna fija si nadie eligió (contactos y empresas, como HubSpot). */
  defaultFreeze?: boolean;
}) {
  const { entity, columns, storageKey, first, viewCols, viewFreeze, viewWidths, defaultFreeze = false } = opts;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ids = useMemo(() => columns.map((c) => c.id), [columns]);
  const defaults = useMemo(
    () => orderedColumns(columns.filter((c) => c.defaultVisible !== false).map((c) => c.id), ids, first),
    [columns, ids, first],
  );
  const [stored, setStored] = useState<{ order: string[] | null; freeze: boolean | null; widths: string | null }>({
    order: null,
    freeze: null,
    widths: null,
  });

  useEffect(() => {
    const order = readStorage(storageKey);
    const freeze = readStorage(`${storageKey}:freeze`);
    const widths = readStorage(`${storageKey}:widths`);
    setStored({ order, freeze: freeze ? freeze[0] === '1' : null, widths: widths?.[0] ?? null });
  }, [storageKey]);

  const order = viewCols
    ? orderedColumns(parseColumns(viewCols), ids, first)
    : stored.order?.length
      ? orderedColumns(stored.order, ids, first)
      : defaults;
  const freeze = viewFreeze ?? stored.freeze ?? defaultFreeze;
  const cols = serializeColumns(order);

  // Anchos: mientras se arrastra (o se usan las flechas) mandan los de la mano; al soltar pasan a la URL
  // (y a la vista) y vuelven a venir del server. Sin anchos, la tabla se acomoda sola como siempre.
  const savedWidths = viewWidths ?? stored.widths ?? '';
  const [liveWidths, setLiveWidths] = useState<Record<string, number> | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Los anchos que van a subir cuando venza el temporizador (el último cambio manda). */
  const pending = useRef<Record<string, number> | null>(null);
  // Llegaron los de la URL: mandan ellos, salvo que haya un cambio más nuevo esperando para subir.
  useEffect(() => {
    if (!commitTimer.current) setLiveWidths(null);
  }, [savedWidths]);
  // Solo columnas que existen para quien mira: un ancho guardado en este navegador desde otro
  // workspace (con sus propiedades propias) no se muestra ni viaja a una vista de este.
  const widths = useMemo(() => {
    const all = liveWidths ?? parseWidths(savedWidths);
    return Object.fromEntries(Object.entries(all).filter(([id]) => ids.includes(id)));
  }, [liveWidths, savedWidths, ids]);
  const widthsText = serializeWidths(widths);

  useEffect(() => {
    current.set(entity, { cols, freeze, widths: widthsText || undefined });
  }, [entity, cols, freeze, widthsText]);

  useEffect(() => () => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = null;
  }, []);

  const noSavedView = () => !new URLSearchParams(window.location.search).get(SAVED_VIEW_PARAM);

  /**
   * Anchos nuevos. `commit`: pasan a la URL (la vista queda modificada y "Guardar" los guarda) un
   * momento después del último cambio, sin volver arriba de la página; sin vista guardada, también
   * quedan en este navegador en el acto. Un cambio sin `commit` (empezar a arrastrar) no cancela uno
   * que está por subir: lo reemplaza.
   */
  const setWidths = useCallback(
    (next: Record<string, number>, commit: boolean) => {
      setLiveWidths(next);
      if (!commit && !commitTimer.current) return;
      pending.current = next;
      if (commit && noSavedView()) writeStorage(`${storageKey}:widths`, [serializeWidths(next)]);
      if (commitTimer.current) clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(() => {
        commitTimer.current = null;
        const latest = pending.current ?? next;
        pending.current = null;
        const q = new URLSearchParams(window.location.search);
        const text = serializeWidths(latest);
        if (text) q.set('widths', text);
        else q.delete('widths');
        if (q.get(MODIFIED_PARAM) !== '1') q.delete(MODIFIED_PARAM);
        if (!q.get(SAVED_VIEW_PARAM)) {
          writeStorage(`${storageKey}:widths`, [text]);
          setStored((prev) => ({ ...prev, widths: text }));
        }
        const qs = q.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }, WIDTHS_COMMIT_MS);
    },
    [pathname, router, storageKey],
  );

  function apply(next: string[], nextFreeze: boolean, opts: { autoWidths?: boolean } = {}) {
    const clean = orderedColumns(next, ids, first);
    const q = new URLSearchParams(params.toString());
    q.set('cols', serializeColumns(clean));
    q.set('freeze', nextFreeze ? '1' : '0');
    q.delete('page');
    // `widths=auto`: la tabla vuelve a acomodarse sola (también sobre los anchos de una vista guardada).
    if (opts.autoWidths) {
      if (commitTimer.current) clearTimeout(commitTimer.current);
      commitTimer.current = null;
      pending.current = null;
      setLiveWidths(null);
      q.set('widths', AUTO_WIDTHS);
    }
    // Sin vista guardada activa, también queda como la elección de este navegador.
    if (!q.get(SAVED_VIEW_PARAM)) {
      writeStorage(storageKey, clean);
      writeStorage(`${storageKey}:freeze`, [nextFreeze ? '1' : '0']);
      if (opts.autoWidths) writeStorage(`${storageKey}:widths`, ['']);
      setStored((prev) => ({ ...prev, order: clean, freeze: nextFreeze, ...(opts.autoWidths ? { widths: '' } : {}) }));
    }
    if (q.get(MODIFIED_PARAM) !== '1') q.delete(MODIFIED_PARAM);
    router.push(`${pathname}?${q.toString()}`);
  }

  /** "Restablecer": las columnas de siempre y los anchos automáticos. */
  function reset() {
    apply(defaults, defaultFreeze, { autoWidths: true });
  }

  return { order, freeze, apply, reset, widths, setWidths, visible: new Set(order) };
}

export type TableColumnsState = ReturnType<typeof useTableColumns> & { columns: ColumnDef[]; first: string };

const TableColumnsContext = createContext<TableColumnsState | null>(null);

/** Las columnas del índice que envuelve el proveedor (tabla, menú de columna y "Editar columnas"). */
export function useIndexColumns(): TableColumnsState | null {
  return useContext(TableColumnsContext);
}

/**
 * Columnas de un índice (contactos, empresas, deals) para la barra de filtros
 * y la tabla a la vez: va por encima de las dos en la página, así "Editar
 * columnas" se dibuja con el resto de la barra (antes esperaba a que la
 * tabla montara para aparecer) y los dos ven el mismo orden y los mismos anchos.
 */
const NO_CUSTOM: CustomColumn[] = [];

export function TableColumnsProvider({
  entity,
  customColumns = NO_CUSTOM,
  viewCols,
  viewFreeze,
  viewWidths,
  children,
}: {
  entity: IndexEntity;
  /** Columnas de propiedades propias que la persona ve (ocultas por defecto). */
  customColumns?: CustomColumn[];
  viewCols?: string;
  viewFreeze?: boolean;
  viewWidths?: string;
  children: ReactNode;
}) {
  const t = useTranslations('crm');
  const spec = INDEX_TABLES[entity];
  const columns = useMemo(
    () => [
      ...spec.columns.map((c) => ({ id: c.id, label: t(c.labelKey), defaultVisible: c.defaultVisible })),
      ...customColumns.map((c) => ({ id: c.id, label: c.label, defaultVisible: false })),
    ],
    [spec, customColumns, t],
  );
  const state = useTableColumns({
    entity,
    columns,
    storageKey: spec.storageKey,
    first: 'name',
    viewCols,
    viewFreeze,
    viewWidths,
    defaultFreeze: spec.defaultFreeze,
  });
  return <TableColumnsContext.Provider value={{ ...state, columns, first: 'name' }}>{children}</TableColumnsContext.Provider>;
}

/**
 * Anchos de la tabla del índice: con alguno guardado, la tabla deja de
 * acomodarse sola y usa los de cada columna (`<colgroup>`; la columna sin
 * ancho toma uno por defecto). En el teléfono la tabla es de tarjetas y esto
 * no se aplica (styles/crm-list-hs.css).
 */
export function IndexColGroup({ cols }: { cols: Pick<TableColumnsState, 'order' | 'widths'> }) {
  if (!cols.order.some((id) => cols.widths[id])) return null;
  return (
    <colgroup>
      <col style={{ width: CHECK_COLUMN_WIDTH }} />
      {cols.order.map((id) => (
        <col key={id} data-col={id} style={{ width: cols.widths[id] ?? DEFAULT_COLUMN_WIDTH }} />
      ))}
    </colgroup>
  );
}

/** Clase y ancho total de la tabla cuando tiene anchos (ver IndexColGroup). */
export function sizedTable(cols: Pick<TableColumnsState, 'order' | 'widths'>): { className: string; style?: CSSProperties } {
  if (!cols.order.some((id) => cols.widths[id])) return { className: '' };
  const total = cols.order.reduce((sum, id) => sum + (cols.widths[id] ?? DEFAULT_COLUMN_WIDTH), CHECK_COLUMN_WIDTH);
  return { className: ' is-sized', style: { '--crm-table-w': `${total}px` } as CSSProperties };
}

/** "Editar columnas" del índice, en la barra de filtros (ColumnsSlot). */
export function IndexEditColumns() {
  const cols = useIndexColumns();
  if (!cols) return null;
  return <EditColumns columns={cols.columns} first={cols.first} order={cols.order} freeze={cols.freeze} onApply={cols.apply} onReset={cols.reset} />;
}

interface EditColumnsProps {
  columns: ColumnDef[];
  first: string;
  order: string[];
  freeze: boolean;
  onApply: (order: string[], freeze: boolean) => void;
  onReset: () => void;
}

/**
 * "Editar columnas" como en HubSpot: a la izquierda las propiedades (con
 * búsqueda) para marcar, a la derecha las elegidas en orden (arrastrar o
 * subir y bajar), y "Fijar la primera columna". Solo lista las columnas que
 * la tabla recibió, que ya vienen sin los campos ocultos para la persona.
 */
export default function EditColumns({ columns, first, order, freeze, onApply, onReset }: EditColumnsProps) {
  const t = useTranslations('crm');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(order);
  const [draftFreeze, setDraftFreeze] = useState(freeze);
  const [search, setSearch] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const labels = useMemo(() => new Map(columns.map((c) => [c.id, c.label])), [columns]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  function show() {
    setDraft(order);
    setDraftFreeze(freeze);
    setSearch('');
    setOpen(true);
  }

  function toggle(id: string) {
    if (id === first) return;
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function move(id: string, delta: number) {
    setDraft((prev) => {
      const i = prev.indexOf(id);
      const j = i + delta;
      // La primera (el nombre) no se mueve ni se pasa por delante.
      if (i <= 0 || j <= 0 || j >= prev.length) return prev;
      const next = [...prev];
      next.splice(i, 1);
      next.splice(j, 0, id);
      return next;
    });
  }

  function dropOn(target: string) {
    if (!dragId || dragId === target || target === first) return;
    setDraft((prev) => {
      const next = prev.filter((x) => x !== dragId);
      next.splice(next.indexOf(target), 0, dragId);
      return next;
    });
    setDragId(null);
  }

  const needle = search.trim().toLowerCase();
  const available = columns.filter((c) => !needle || c.label.toLowerCase().includes(needle));

  return (
    <>
      <button type="button" className="column-toggle-btn" onClick={show} aria-haspopup="dialog" data-testid="edit-columns-btn">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
          <line x1="6" y1="2.5" x2="6" y2="13.5" />
          <line x1="10.5" y1="2.5" x2="10.5" y2="13.5" />
        </svg>
        {t('views.columns.button')}
      </button>
      <dialog
        ref={ref}
        className="ui-modal ui-modal-wide edit-columns"
        aria-labelledby={titleId}
        data-testid="edit-columns-dialog"
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
        onClose={() => setOpen(false)}
      >
        {open && (
          <form
            className="edit-columns-form"
            onSubmit={(e) => {
              e.preventDefault();
              onApply(draft, draftFreeze);
              setOpen(false);
            }}
          >
            <div className="ui-modal-head">
              <h2 className="ui-modal-title" id={titleId}>
                {t('views.columns.title')}
              </h2>
            </div>
            <div className="ui-modal-body edit-columns-body">
              <section className="edit-columns-pane" aria-label={t('views.columns.available')}>
                <input
                  className="input"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('views.columns.search')}
                  aria-label={t('views.columns.search')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.preventDefault();
                  }}
                />
                <div className="edit-columns-list" data-testid="edit-columns-available">
                  {available.map((c) => (
                    <label key={c.id} className="column-toggle-row">
                      <input
                        type="checkbox"
                        checked={draft.includes(c.id)}
                        disabled={c.id === first}
                        onChange={() => toggle(c.id)}
                      />
                      <span>{c.label}</span>
                    </label>
                  ))}
                  {available.length === 0 && <p className="muted edit-columns-empty">{t('views.columns.noMatch')}</p>}
                </div>
              </section>
              <section className="edit-columns-pane" aria-label={t('views.columns.selected')}>
                <p className="label">{t('views.columns.selectedCount', { count: draft.length })}</p>
                <ol className="edit-columns-order" data-testid="edit-columns-selected">
                  {draft.map((id, i) => (
                    <li
                      key={id}
                      className={`edit-columns-item${id === first ? ' is-locked' : ''}${dragId === id ? ' is-dragging' : ''}`}
                      draggable={id !== first}
                      onDragStart={() => setDragId(id)}
                      onDragEnd={() => setDragId(null)}
                      onDragOver={(e) => {
                        if (dragId && id !== first) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        dropOn(id);
                      }}
                      data-column={id}
                    >
                      <span className="edit-columns-name">{labels.get(id) ?? id}</span>
                      {id === first ? (
                        <span className="muted edit-columns-lock">{t('views.columns.locked')}</span>
                      ) : (
                        <span className="edit-columns-actions">
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => move(id, -1)}
                            disabled={i <= 1}
                            aria-label={t('views.columns.moveUp', { name: labels.get(id) ?? id })}
                          >
                            <CrmIcon name="chevronUp" size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => move(id, 1)}
                            disabled={i >= draft.length - 1}
                            aria-label={t('views.columns.moveDown', { name: labels.get(id) ?? id })}
                          >
                            <CrmIcon name="chevronDown" size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => toggle(id)}
                            aria-label={t('views.columns.remove', { name: labels.get(id) ?? id })}
                          >
                            <CrmIcon name="x" size={14} />
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
                <label className="column-toggle-row edit-columns-freeze">
                  <input
                    type="checkbox"
                    checked={draftFreeze}
                    onChange={(e) => setDraftFreeze(e.target.checked)}
                    data-testid="edit-columns-freeze"
                  />
                  <span>{t('views.columns.freeze')}</span>
                </label>
              </section>
            </div>
            <div className="ui-modal-foot">
              <button
                type="button"
                className="btn btn-sm btn-ghost edit-columns-reset"
                data-testid="edit-columns-reset"
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
              >
                {t('views.columns.reset')}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-sm btn-primary" data-testid="edit-columns-apply">
                {t('views.columns.apply')}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
