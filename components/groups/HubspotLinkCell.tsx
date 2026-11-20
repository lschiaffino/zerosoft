'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ExternalIcon } from './wa/PersonHubspot';

/** Un registro de HubSpot para elegir en la celda (empresa o contacto). */
export interface HsCellRecord {
  id: string;
  name: string;
  url: string;
  /** Una línea de contexto (dominio, email, empresa). */
  meta?: string;
}

/** Los textos de la celda (cada tabla pasa los suyos: empresa o contacto). */
export interface HsCellText {
  notLinked: string;
  /** aria-label de "Sin vincular" cuando se puede vincular. */
  linkAction: string;
  search: string;
  results: string;
  minChars: string;
  searching: string;
  noResults: string;
  /** aria-label del botón del menú de un registro vinculado. */
  options: string;
  change: string;
  unlink: string;
  /** aria-label del link al registro. */
  open: string;
  /** Tooltip de "Sin vincular" cuando no se puede vincular (vacío: ninguno). */
  readOnly?: string;
}

/** Lo que devuelve una búsqueda: resultados o el texto del error. */
export type HsCellSearch = (q: string, signal: AbortSignal) => Promise<{ results: HsCellRecord[] } | { error: string }>;

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

/**
 * La celda de HubSpot de una tabla de Lines (la empresa de un grupo, el
 * contacto de una persona), editable en el lugar: "Sin vincular" se vuelve un
 * buscador en la celda con la lista anclada debajo (en un portal, así el
 * scroll de la tabla no la corta). Se busca mientras se escribe (con pausa y
 * desde 2 letras), las flechas recorren, Enter vincula, Esc y un clic afuera
 * cancelan. Una celda vinculada muestra el registro con link a HubSpot y un
 * menú chico con "Cambiar" y "Desvincular". Vincular y desvincular son de
 * quien arma la celda (optimista, con vuelta atrás y aviso si falla).
 */
export default function HubspotLinkCell({
  label,
  linked,
  extra,
  canEdit,
  text,
  search,
  onLink,
  onUnlink,
  testId,
  linkedTestId,
}: {
  /** Nombre de la columna (la etiqueta de la tarjeta en el teléfono). */
  label: string;
  linked: { name: string; url: string } | null;
  /** Algo más al lado del registro (un aviso, la empresa del contacto). */
  extra?: ReactNode;
  canEdit: boolean;
  text: HsCellText;
  search: HsCellSearch;
  onLink: (rec: HsCellRecord) => void;
  onUnlink: () => void;
  testId: string;
  /** data-testid del registro vinculado (el nombre y lo que va al lado). */
  linkedTestId?: string;
}) {
  const [mode, setMode] = useState<'idle' | 'search' | 'menu'>('idle');
  const cell = useRef<HTMLTableCellElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);

  /** Vuelve a la celda quieta y deja el foco en su control (no si se cerró con un clic afuera: el foco queda donde se hizo clic). */
  const finish = useCallback((refocus = true) => {
    setMode('idle');
    if (!refocus) return;
    requestAnimationFrame(() => (menuBtn.current ?? trigger.current ?? cell.current?.querySelector<HTMLElement>('a, button'))?.focus());
  }, []);

  const pick = (rec: HsCellRecord) => {
    finish();
    onLink(rec);
  };

  return (
    <td ref={cell} data-label={label} className={`gr-gt-ro gr-hslink${mode === 'search' ? ' is-searching' : ''}`} data-testid={testId}>
      {mode === 'search' ? (
        <SearchBox cell={cell} text={text} search={search} onPick={pick} onCancel={finish} testId={testId} />
      ) : linked ? (
        <span className="gr-gt-company gr-hslink-linked" data-testid={linkedTestId}>
          <a href={linked.url} target="_blank" rel="noopener noreferrer" className="gr-gt-company-link" aria-label={text.open}>
            <span>{linked.name}</span>
            <ExternalIcon />
          </a>
          {extra}
          {canEdit && (
            <button
              ref={menuBtn}
              type="button"
              className="gr-hslink-more"
              aria-label={text.options}
              aria-haspopup="menu"
              aria-expanded={mode === 'menu'}
              data-testid={`${testId}-menu`}
              onClick={() => setMode((m) => (m === 'menu' ? 'idle' : 'menu'))}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <circle cx="3" cy="8" r="1.4" />
                <circle cx="8" cy="8" r="1.4" />
                <circle cx="13" cy="8" r="1.4" />
              </svg>
            </button>
          )}
          {mode === 'menu' && (
            <CellMenu
              anchor={menuBtn}
              label={text.options}
              items={[
                { id: 'change', label: text.change, run: () => setMode('search') },
                {
                  id: 'unlink',
                  label: text.unlink,
                  run: () => {
                    finish();
                    onUnlink();
                  },
                },
              ]}
              onClose={finish}
              testId={testId}
            />
          )}
        </span>
      ) : canEdit ? (
        <button ref={trigger} type="button" className="gr-gt-cellbtn gr-hslink-trigger" aria-label={text.linkAction} data-testid={`${testId}-link`} onClick={() => setMode('search')}>
          <span className="ui-help">{text.notLinked}</span>
        </button>
      ) : (
        <span className="ui-help" title={text.readOnly || undefined}>
          {text.notLinked}
        </span>
      )}
    </td>
  );
}

/** Dónde va lo flotante: debajo del ancla (arriba si abajo no entra), dentro de la ventana. */
function usePopPosition(anchor: RefObject<HTMLElement | null>, pop: RefObject<HTMLElement | null>, minWidth: number) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(Math.max(r.width, minWidth), vw - 16);
      const h = pop.current?.offsetHeight || 200;
      const below = r.bottom + 4;
      const top = below + h > vh - 8 && r.top - 4 - h >= 8 ? r.top - 4 - h : below;
      setPos({ top: Math.round(top), left: Math.round(Math.max(8, Math.min(r.left, vw - width - 8))), width: Math.round(width) });
    };
    place();
    // La lista cambia de alto mientras llegan resultados: se vuelve a ubicar.
    const ro = typeof ResizeObserver === 'undefined' || !pop.current ? null : new ResizeObserver(place);
    if (ro && pop.current) ro.observe(pop.current);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      ro?.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor, pop, minWidth]);
  return pos;
}

/** Cierra con un clic (o toque) fuera de `inside`. */
function useOutside(inside: Array<RefObject<HTMLElement | null>>, onOut: () => void) {
  const cb = useRef(onOut);
  cb.current = onOut;
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (inside.some((r) => r.current?.contains(t))) return;
      cb.current();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
    // Los refs no cambian.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

type SearchState = { kind: 'short' } | { kind: 'loading' } | { kind: 'error'; text: string } | { kind: 'results'; results: HsCellRecord[] };

function SearchBox({
  cell,
  text,
  search,
  onPick,
  onCancel,
  testId,
}: {
  cell: RefObject<HTMLTableCellElement | null>;
  text: HsCellText;
  search: HsCellSearch;
  onPick: (rec: HsCellRecord) => void;
  onCancel: (refocus?: boolean) => void;
  testId: string;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState<SearchState>({ kind: 'short' });
  const [active, setActive] = useState(0);
  // Lo ya buscado no se vuelve a pedir (cuida el límite de pedidos de HubSpot).
  const cache = useRef(new Map<string, HsCellRecord[]>());
  const pos = usePopPosition(cell, pop, 280);
  useOutside([cell, pop], () => onCancel(false));

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < MIN_CHARS) {
      setState({ kind: 'short' });
      return;
    }
    const hit = cache.current.get(term.toLowerCase());
    if (hit) {
      setState({ kind: 'results', results: hit });
      setActive(0);
      return;
    }
    setState({ kind: 'loading' });
    const ctl = new AbortController();
    const id = setTimeout(async () => {
      const res = await search(term, ctl.signal).catch(() => null);
      if (ctl.signal.aborted || !res) return;
      if ('error' in res) {
        setState({ kind: 'error', text: res.error });
        return;
      }
      cache.current.set(term.toLowerCase(), res.results);
      setState({ kind: 'results', results: res.results });
      setActive(0);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [q, search]);

  const results = state.kind === 'results' ? state.results : [];
  const optId = (i: number) => `${listId}-o${i}`;

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % results.length : (a - 1 + results.length) % results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const rec = results[active];
      if (rec) onPick(rec);
    } else if (e.key === 'Tab') {
      onCancel(false);
    }
  };

  useEffect(() => {
    document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
    // optId depende solo de listId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const status = state.kind === 'short' ? text.minChars : state.kind === 'loading' ? text.searching : state.kind === 'error' ? state.text : results.length === 0 ? text.noResults : '';

  return (
    <>
      <input
        ref={input}
        className="input gr-hslink-input"
        type="text"
        role="combobox"
        aria-label={text.search}
        aria-autocomplete="list"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-activedescendant={results.length ? optId(active) : undefined}
        placeholder={text.search}
        autoComplete="off"
        spellCheck={false}
        maxLength={100}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        data-testid={`${testId}-input`}
      />
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={pop}
            className="zs-msel-list gr-hslink-pop"
            style={pos ? { top: pos.top, left: pos.left, width: pos.width, maxWidth: pos.width } : { visibility: 'hidden', top: 0, left: 0 }}
            data-testid={`${testId}-pop`}
          >
            {status && (
              <p className={state.kind === 'error' ? 'ui-error gr-hslink-status' : 'ui-help gr-hslink-status'} role={state.kind === 'error' ? 'alert' : 'status'} aria-busy={state.kind === 'loading' || undefined}>
                {status}
              </p>
            )}
            <ul id={listId} role="listbox" aria-label={text.results} className="gr-hslink-list" hidden={results.length === 0}>
              {results.map((r, i) => (
                <li
                  key={r.id}
                  id={optId(i)}
                  role="option"
                  aria-selected={i === active}
                  className={`zs-msel-opt gr-hslink-opt${i === active ? ' is-active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => setActive(i)}
                  onClick={() => onPick(r)}
                >
                  <span className="gr-hslink-opt-name">{r.name}</span>
                  {r.meta && <span className="zs-msel-hint gr-hslink-opt-meta">{r.meta}</span>}
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}

function CellMenu({
  anchor,
  label,
  items,
  onClose,
  testId,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  label: string;
  items: Array<{ id: string; label: string; run: () => void }>;
  onClose: (refocus?: boolean) => void;
  testId: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const pos = usePopPosition(anchor, box, 180);
  useOutside([anchor, box], () => onClose(false));
  useEffect(() => {
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }, []);
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const all = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const next = e.key === 'ArrowDown' ? (i + 1) % all.length : (i - 1 + all.length) % all.length;
      all[next]?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onClose();
    }
  };
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={box}
      role="menu"
      aria-label={label}
      className="zs-msel-list gr-hslink-menu"
      style={pos ? { top: pos.top, left: pos.left, width: pos.width } : { visibility: 'hidden', top: 0, left: 0 }}
      onKeyDown={onKey}
      data-testid={`${testId}-menu-list`}
    >
      {items.map((it) => (
        <button key={it.id} type="button" role="menuitem" className="zs-msel-opt gr-hslink-item" data-testid={`${testId}-${it.id}`} onClick={it.run}>
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
