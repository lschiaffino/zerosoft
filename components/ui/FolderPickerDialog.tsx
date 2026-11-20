'use client';

import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { flattenTree, type TreeFolder } from '@/lib/inbox/folder-tree';
import { TOUCH_QUERY, useBackLayer, useMediaQuery } from '@/components/groups/wa/backLayer';
import { CheckIcon } from '@/components/groups/wa/icons';

export interface PickerFolder extends TreeFolder {
  name: string;
  /** Color de la carpeta (Inbox); sin color va el de la app. */
  color?: string | null;
}

/** Un grupo de carpetas (en Lines: las del equipo y las propias). Con más de uno, cada uno lleva su título. */
export interface PickerSection {
  key: string;
  title?: string;
  icon?: ReactNode;
  folders: PickerFolder[];
  /** Donde está ahora el chat (o los chats). */
  current?: string[];
  /** Fila "Sin carpeta", primera de la sección. */
  none?: { label: string; testId?: string } | null;
  testId?: string;
}

export interface FolderPickerLabels {
  /** Etiqueta y texto de ejemplo del campo de búsqueda. */
  filter: string;
  /** Todavía no hay ninguna carpeta. */
  empty: string;
  /** La búsqueda no encontró ninguna. */
  noMatch: string;
  /** Al lado de la carpeta donde está ahora. */
  current: string;
  /** Con `toggle`: al lado de la carpeta donde está ahora (elegirla lo saca). */
  remove?: string;
  newFolder: string;
  folderName: string;
  /** Botón del nombre nuevo: "Crear y mover". */
  create: string;
  close: string;
}

type Item =
  | { kind: 'none'; section: PickerSection }
  | { kind: 'folder'; section: PickerSection; folder: PickerFolder; depth: number; inIt: boolean }
  | { kind: 'new' };

/**
 * Mover a carpeta: el mismo diálogo en Inbox y en Lines. Arriba se escribe para filtrar; flechas eligen, Enter
 * mueve a la marcada y Esc o el telón cierran. Cada fila lleva el color de la carpeta y la sangría del árbol, y la
 * carpeta donde está el chat va marcada. "Sin carpeta" es la primera fila y "+ Carpeta nueva" la última: se escribe
 * el nombre ahí mismo y el chat va a la nueva (`onCreate`). En el teléfono es una hoja de abajo (styles/ui.css).
 *
 * `toggle` (Inbox, donde un chat puede estar en varias): elegir la carpeta donde ya está lo saca de ella.
 */
export default function FolderPickerDialog({
  open,
  title,
  sections,
  labels,
  toggle = false,
  testIdPrefix = 'folder-pick',
  onPick,
  onCreate,
  onClose,
}: {
  open: boolean;
  title: string;
  sections: PickerSection[];
  labels: FolderPickerLabels;
  toggle?: boolean;
  testIdPrefix?: string;
  /** folderId null = "Sin carpeta" de esa sección. */
  onPick: (section: string, folderId: string | null) => void;
  /** Crea la carpeta y mueve el chat; devuelve el error para mostrar, o nada si salió bien. */
  onCreate?: (name: string) => Promise<string | void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(-1);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useBackLayer(open, () => !busy && onClose(), { enabled: useMediaQuery(TOUCH_QUERY) });
  // Cada vez que abre arranca de cero (en el mismo render, no en un efecto).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQ('');
      setActive(-1);
      setName(null);
      setError('');
      setBusy(false);
    }
  }

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal enfoca lo primero que encuentra (la X): el foco va a la búsqueda.
      inputRef.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const needle = q.trim().toLowerCase();
  const total = sections.reduce((n, s) => n + s.folders.length, 0);
  const groups = useMemo(
    () =>
      sections.map((section) => {
        const rows: Item[] = [];
        if (section.none && (!needle || section.none.label.toLowerCase().includes(needle))) rows.push({ kind: 'none', section });
        for (const r of flattenTree(section.folders)) {
          if (needle && !r.folder.name.toLowerCase().includes(needle)) continue;
          rows.push({ kind: 'folder', section, folder: r.folder, depth: needle ? 0 : r.depth, inIt: !!section.current?.includes(r.folder.id) });
        }
        return { section, rows };
      }),
    [sections, needle],
  );
  const items: Item[] = useMemo(() => [...groups.flatMap((g) => g.rows), ...(onCreate ? [{ kind: 'new' } as const] : [])], [groups, onCreate]);
  const matches = items.some((it) => it.kind === 'folder');
  // Sin flechas todavía, la marcada es la primera carpeta (no "Sin carpeta"): escribir y Enter va a la primera que coincide.
  const firstFolder = items.findIndex((it) => it.kind === 'folder');
  const current = active >= 0 && active < items.length ? active : firstFolder >= 0 ? firstFolder : items.length ? 0 : -1;
  const rowId = (i: number) => `${uid}-r${i}`;

  useEffect(() => {
    if (current < 0) return;
    document.getElementById(rowId(current))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const startCreate = () => {
    setName(q.trim());
    setError('');
  };
  const choose = (it: Item | undefined) => {
    if (!it) return;
    if (it.kind === 'new') return startCreate();
    if (it.kind === 'none') return onPick(it.section.key, null);
    onPick(it.section.key, it.folder.id);
  };
  const create = async () => {
    const clean = (name ?? '').trim();
    if (!clean || busy || !onCreate) return;
    setBusy(true);
    setError('');
    const err = await onCreate(clean);
    setBusy(false);
    if (err) setError(err);
  };

  let index = -1;
  const row = (it: Item) => {
    index += 1;
    const i = index;
    const on = i === current;
    const common = {
      id: rowId(i),
      type: 'button' as const,
      tabIndex: -1,
      onMouseMove: () => active !== i && setActive(i),
      onClick: () => choose(it),
    };
    if (it.kind === 'none')
      return (
        <li key={`none-${it.section.key}`}>
          <button {...common} className={`ui-fp-row ui-fp-none${on ? ' is-active' : ''}`} data-testid={it.section.none?.testId}>
            <span className="ui-fp-swatch ui-fp-swatch-none" aria-hidden />
            <span className="ui-fp-name">{it.section.none?.label}</span>
          </button>
        </li>
      );
    if (it.kind === 'folder') {
      const f = it.folder;
      return (
        <li key={`${it.section.key}-${f.id}`}>
          <button
            {...common}
            className={`ui-fp-row${on ? ' is-active' : ''}${it.inIt ? ' is-current' : ''}`}
            style={{ paddingInlineStart: 8 + it.depth * 16 }}
            aria-pressed={it.inIt}
          >
            <span className="ui-fp-swatch" style={f.color ? { background: f.color } : undefined} aria-hidden />
            <span className="ui-fp-name">{f.name}</span>
            {it.inIt && (
              <span className="ui-fp-hint">
                {toggle && labels.remove ? labels.remove : labels.current}
                <CheckIcon size={14} aria-hidden />
              </span>
            )}
          </button>
        </li>
      );
    }
    return (
      <li key="new">
        <button {...common} className={`ui-fp-row ui-fp-new${on ? ' is-active' : ''}`} data-testid={`${testIdPrefix}-new-folder`}>
          <span className="ui-fp-plus" aria-hidden>
            +
          </span>
          <span className="ui-fp-name">{labels.newFolder}</span>
        </button>
      </li>
    );
  };

  const several = sections.length > 1;
  return (
    <dialog
      ref={ref}
      className="ui-modal ui-fp"
      aria-label={open ? title : ''}
      data-testid={`${testIdPrefix}-dialog`}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      {open && (
        <>
          <div className="ui-modal-head ui-fp-head">
            <h2 className="ui-modal-title">{title}</h2>
            <button type="button" className="btn btn-ghost btn-icon btn-sm ui-fp-close" aria-label={labels.close} onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div className="ui-modal-body ui-fp-body">
            <label className="sr-only" htmlFor={`${uid}-q`}>
              {labels.filter}
            </label>
            <input
              ref={inputRef}
              id={`${uid}-q`}
              className="input ui-fp-q"
              autoFocus
              autoComplete="off"
              aria-controls={`${uid}-list`}
              aria-activedescendant={current >= 0 ? rowId(current) : undefined}
              placeholder={labels.filter}
              value={q}
              data-testid={`${testIdPrefix}-q`}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(-1);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (!items.length) return;
                  const step = e.key === 'ArrowDown' ? 1 : -1;
                  setActive((current + step + items.length) % items.length);
                } else if (e.key === 'Home' && !q) {
                  e.preventDefault();
                  setActive(0);
                } else if (e.key === 'End' && !q) {
                  e.preventDefault();
                  setActive(items.length - 1);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  choose(items[current]);
                }
              }}
            />
            {total === 0 && !onCreate && <p className="ui-help ui-fp-empty">{labels.empty}</p>}
            <ul className="ui-fp-list" id={`${uid}-list`} role="list">
              {groups.map(({ section, rows }) => (
                <Fragment key={section.key}>
                  {several && (
                    <li className="ui-fp-sec" id={`${uid}-s-${section.key}`} aria-hidden={rows.length === 0 || undefined}>
                      {section.icon}
                      <span>{section.title}</span>
                    </li>
                  )}
                  <li className="ui-fp-group">
                    <ul aria-labelledby={several ? `${uid}-s-${section.key}` : undefined} data-testid={section.testId}>
                      {rows.map(row)}
                    </ul>
                  </li>
                </Fragment>
              ))}
              {needle && !matches && total > 0 && <li className="ui-help ui-fp-empty">{labels.noMatch}</li>}
              {total === 0 && onCreate && <li className="ui-help ui-fp-empty">{labels.empty}</li>}
              {onCreate && name === null && (
                <li className="ui-fp-group">
                  <ul>{row(items[items.length - 1])}</ul>
                </li>
              )}
            </ul>
            {onCreate && name !== null && (
              <form
                className="ui-fp-create"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <span className="ui-fp-plus" aria-hidden>
                  +
                </span>
                <label className="sr-only" htmlFor={`${uid}-new`}>
                  {labels.folderName}
                </label>
                <input
                  id={`${uid}-new`}
                  className="input ui-fp-new-name"
                  value={name}
                  placeholder={labels.folderName}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    // Esc acá cierra solo el campo nuevo, no el diálogo.
                    if (e.key === 'Escape' && !busy) {
                      e.preventDefault();
                      e.stopPropagation();
                      setName(null);
                      inputRef.current?.focus();
                    }
                  }}
                  maxLength={60}
                  autoFocus
                  required
                  data-testid={`${testIdPrefix}-new-name`}
                />
                <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()} aria-busy={busy || undefined} data-testid={`${testIdPrefix}-new-save`}>
                  {labels.create}
                </button>
                {error && (
                  <p className="ui-error" role="alert">
                    {error}
                  </p>
                )}
              </form>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}
