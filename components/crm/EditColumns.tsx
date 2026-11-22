'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import CrmIcon from './CrmIcon';
import { COLUMNS_SLOT_ID } from './ColumnToggle';
import {
  MODIFIED_PARAM,
  SAVED_VIEW_PARAM,
  orderedColumns,
  parseColumns,
  serializeColumns,
  type ViewEntity,
} from '@/lib/crm-views-shared';

export interface ColumnDef {
  id: string;
  label: string;
  defaultVisible?: boolean;
}

// Columnas que la tabla muestra ahora, para "Guardar vista" (ViewTabs las guarda con la vista).
const current = new Map<ViewEntity, { cols: string; freeze: boolean }>();

export function currentColumns(entity: ViewEntity): { cols: string; freeze: boolean } | undefined {
  return current.get(entity);
}

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
}) {
  const { entity, columns, storageKey, first, viewCols, viewFreeze } = opts;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ids = useMemo(() => columns.map((c) => c.id), [columns]);
  const defaults = useMemo(
    () => orderedColumns(columns.filter((c) => c.defaultVisible !== false).map((c) => c.id), ids, first),
    [columns, ids, first],
  );
  const [stored, setStored] = useState<{ order: string[] | null; freeze: boolean | null }>({ order: null, freeze: null });

  useEffect(() => {
    const order = readStorage(storageKey);
    const freeze = readStorage(`${storageKey}:freeze`);
    setStored({ order, freeze: freeze ? freeze[0] === '1' : null });
  }, [storageKey]);

  const order = viewCols
    ? orderedColumns(parseColumns(viewCols), ids, first)
    : stored.order?.length
      ? orderedColumns(stored.order, ids, first)
      : defaults;
  const freeze = viewFreeze ?? stored.freeze ?? false;
  const cols = serializeColumns(order);

  useEffect(() => {
    current.set(entity, { cols, freeze });
  }, [entity, cols, freeze]);

  function apply(next: string[], nextFreeze: boolean) {
    const clean = orderedColumns(next, ids, first);
    const q = new URLSearchParams(params.toString());
    q.set('cols', serializeColumns(clean));
    q.set('freeze', nextFreeze ? '1' : '0');
    q.delete('page');
    // Sin vista guardada activa, también queda como la elección de este navegador.
    if (!q.get(SAVED_VIEW_PARAM)) {
      writeStorage(storageKey, clean);
      writeStorage(`${storageKey}:freeze`, [nextFreeze ? '1' : '0']);
      setStored({ order: clean, freeze: nextFreeze });
    }
    if (q.get(MODIFIED_PARAM) !== '1') q.delete(MODIFIED_PARAM);
    router.push(`${pathname}?${q.toString()}`);
  }

  function reset() {
    apply(defaults, false);
  }

  return { order, freeze, apply, reset, visible: new Set(order) };
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

/** "Editar columnas" en la fila de filtros (ColumnsSlot) o, si la página no lo tiene, arriba de la tabla. */
export function EditColumnsInBar(props: EditColumnsProps) {
  const [slot, setSlot] = useState<HTMLElement | null | undefined>(undefined);
  useEffect(() => {
    setSlot(document.getElementById(COLUMNS_SLOT_ID));
  }, []);
  if (slot === undefined) return null;
  if (slot) return createPortal(<EditColumns {...props} />, slot);
  return (
    <div className="table-toolbar">
      <EditColumns {...props} />
    </div>
  );
}
