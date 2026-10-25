'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Picker de teclado como los de Linear: un popover con un campo que filtra
 * mientras se tipea, flechas para moverse, Enter elige (o tilda, si es de
 * varios) y Esc cierra devolviendo el foco. Opcionalmente "Crear «…»" cuando
 * lo tipeado no existe. Lo usan el triage (duplicado), la página del
 * proyecto (estado, prioridad, lead, miembros, teams, labels) y las fechas.
 */
export interface KeyPickerOption {
  value: string;
  label: string;
  icon?: ReactNode;
  meta?: string;
  keywords?: string;
  /** Encabezado de grupo (p. ej. "Sugeridos"): se muestra antes de la primera opción del grupo. */
  group?: string;
}

export interface KeyPickerHandle {
  open: () => void;
  close: () => void;
}

interface KeyPickerProps {
  /** Contenido del botón. Sin trigger, el picker se abre solo con el handle (y se ancla a `anchor`). */
  trigger?: ReactNode;
  ariaLabel: string;
  placeholder?: string;
  options: KeyPickerOption[];
  /** Valor actual (uno) o valores tildados (varios). */
  value?: string | string[] | null;
  onSelect: (value: string) => void;
  multi?: boolean;
  /** Crear lo tipeado (Enter cuando no hay coincidencia exacta). */
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
  /** Opciones que dependen de lo tipeado (una fecha, un issue del servidor). */
  dynamic?: (query: string) => KeyPickerOption[];
  emptyLabel?: string;
  className?: string;
  width?: number;
  disabled?: boolean;
  testId?: string;
  /** Elemento al que se ancla cuando no hay trigger propio. */
  anchor?: () => HTMLElement | null;
  onOpenChange?: (open: boolean) => void;
  /** Lo tipeado (para pedir opciones al servidor). */
  onQueryChange?: (query: string) => void;
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Coincide si todas las palabras aparecen; las que empiezan con lo tipeado van primero. */
export function rankOptions(options: KeyPickerOption[], query: string): KeyPickerOption[] {
  const q = fold(query.trim());
  if (!q) return options;
  const words = q.split(/\s+/);
  return options
    .map((o, i) => {
      const hay = fold(`${o.label} ${o.keywords ?? ''} ${o.meta ?? ''}`);
      if (!words.every((w) => hay.includes(w))) return null;
      const l = fold(o.label);
      const rank = l.startsWith(q) ? 0 : l.split(/[\s(,-]+/).some((w) => w.startsWith(q)) ? 1 : 2;
      return { o, rank, i };
    })
    .filter((x): x is { o: KeyPickerOption; rank: number; i: number } => x !== null)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.o);
}

const KeyPicker = forwardRef<KeyPickerHandle, KeyPickerProps>(function KeyPicker(props, ref) {
  const { trigger, ariaLabel, options, value, onSelect, multi, onCreate, createLabel, dynamic, width = 240 } = props;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [style, setStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const onOpenChange = props.onOpenChange;
  const anchorRef = useRef(props.anchor);
  anchorRef.current = props.anchor;

  const doOpen = useCallback(() => {
    returnFocus.current = (document.activeElement as HTMLElement | null) ?? null;
    setQ('');
    setSel(0);
    setOpen(true);
  }, []);
  const doClose = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) (triggerRef.current ?? returnFocus.current)?.focus();
  }, []);
  useImperativeHandle(ref, () => ({ open: doOpen, close: () => doClose() }), [doOpen, doClose]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const selected = useMemo(() => new Set(Array.isArray(value) ? value : value ? [value] : []), [value]);
  const list = useMemo(() => {
    const dyn = dynamic ? dynamic(q) : [];
    return [...dyn, ...rankOptions(options, q)];
  }, [dynamic, options, q]);
  const exact = list.some((o) => fold(o.label) === fold(q.trim()));
  const canCreate = Boolean(onCreate && q.trim() && !exact);
  const total = list.length + (canCreate ? 1 : 0);

  const onQueryChange = props.onQueryChange;
  useEffect(() => {
    setSel(0);
    if (open) onQueryChange?.(q);
  }, [q, open, onQueryChange]);

  useLayoutEffect(() => {
    if (!open) return;
    const a = triggerRef.current ?? anchorRef.current?.() ?? null;
    const r = a?.getBoundingClientRect() ?? { left: window.innerWidth / 2 - width / 2, bottom: 120, top: 120 };
    const w = Math.min(width, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    setStyle(
      spaceBelow < 320 && r.top > spaceBelow
        ? { position: 'fixed', left, bottom: window.innerHeight - r.top + 4, width: w }
        : { position: 'fixed', left, top: r.bottom + 4, width: w },
    );
    // El campo toma el foco: quien tipea rápido después del atajo no pierde teclas.
    inputRef.current?.focus();
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      doClose(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, doClose]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>(`[data-index="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel, open]);

  const choose = (i: number) => {
    if (i < list.length) {
      const o = list[i];
      onSelect(o.value);
      if (multi) {
        setQ('');
        inputRef.current?.focus();
      } else doClose();
    } else if (canCreate) {
      onCreate?.(q.trim());
      setQ('');
      if (!multi) doClose();
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      doClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => (total ? (s + 1) % total : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => (total ? (s - 1 + total) % total : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (total) choose(Math.min(sel, total - 1));
    } else if (e.key === 'Tab') {
      doClose(false);
    }
    // Las teclas sueltas no llegan a los atajos de la página.
    e.stopPropagation();
  };

  let lastGroup: string | undefined;
  const menu = open ? (
    <div
      ref={menuRef}
      className="track-menu track-keypicker"
      role="dialog"
      aria-label={ariaLabel}
      style={style}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      data-testid={props.testId ? `${props.testId}-menu` : undefined}
    >
      <input
        ref={inputRef}
        className="track-keypicker-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={props.placeholder ?? ariaLabel}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded="true"
        aria-controls={`${props.testId ?? 'kp'}-list`}
        aria-activedescendant={total ? `${props.testId ?? 'kp'}-opt-${sel}` : undefined}
        autoComplete="off"
        spellCheck={false}
      />
      <div className="track-keypicker-list" role="listbox" id={`${props.testId ?? 'kp'}-list`} aria-multiselectable={multi || undefined}>
        {list.map((o, i) => {
          const header = o.group && o.group !== lastGroup ? <p className="track-keypicker-group">{o.group}</p> : null;
          lastGroup = o.group;
          const checked = selected.has(o.value);
          return (
            <div key={`${o.value}-${i}`} role="presentation">
              {header}
              <button
                type="button"
                role="option"
                id={`${props.testId ?? 'kp'}-opt-${i}`}
                data-index={i}
                aria-selected={i === sel}
                tabIndex={-1}
                className={`track-menu-item${i === sel ? ' is-sel' : ''}${checked ? ' is-active' : ''}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => choose(i)}
              >
                {multi && <span className={`track-keypicker-box${checked ? ' is-on' : ''}`} aria-hidden />}
                {o.icon}
                <span className="track-menu-label">{o.label}</span>
                {o.meta && <span className="track-menu-meta">{o.meta}</span>}
                {!multi && checked && (
                  <span className="track-menu-check" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            </div>
          );
        })}
        {canCreate && (
          <button
            type="button"
            role="option"
            id={`${props.testId ?? 'kp'}-opt-${list.length}`}
            data-index={list.length}
            aria-selected={sel === list.length}
            tabIndex={-1}
            className={`track-menu-item track-keypicker-create${sel === list.length ? ' is-sel' : ''}`}
            onMouseEnter={() => setSel(list.length)}
            onClick={() => choose(list.length)}
          >
            <span className="track-keypicker-plus" aria-hidden>
              +
            </span>
            <span className="track-menu-label">{createLabel ? createLabel(q.trim()) : q.trim()}</span>
          </button>
        )}
        {total === 0 && <p className="track-keypicker-empty">{props.emptyLabel ?? '–'}</p>}
      </div>
    </div>
  ) : null;

  return (
    <>
      {trigger !== undefined && (
        <button
          ref={triggerRef}
          type="button"
          className={`track-inline-trigger${props.className ? ` ${props.className}` : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={ariaLabel}
          title={ariaLabel}
          disabled={props.disabled}
          data-testid={props.testId}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (open) doClose(false);
            else doOpen();
          }}
          onKeyDown={(e) => {
            if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !open) {
              e.preventDefault();
              doOpen();
            }
          }}
        >
          {trigger}
        </button>
      )}
      {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : null}
    </>
  );
});

export default KeyPicker;
