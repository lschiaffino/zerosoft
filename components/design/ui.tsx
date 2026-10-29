'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isColor } from '@/lib/design-model';

/** Evento que avisa al sidebar y a la lista que cambiaron diseños o carpetas. */
export const DESIGN_CHANGED = 'zs:design-changed';
export function notifyDesignChanged() {
  window.dispatchEvent(new Event(DESIGN_CHANGED));
}

/** <dialog class="ui-modal"> con showModal(): foco atrapado y Esc cierra. */
export function Modal({
  open,
  title,
  onClose,
  children,
  foot,
  wide,
  testId,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  foot?: ReactNode;
  wide?: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`ui-modal${wide ? ' ui-modal-wide' : ''}`}
      aria-labelledby={`${id}-t`}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      data-testid={testId}
    >
      {open && (
        <>
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id={`${id}-t`}>
              {title}
            </h2>
          </div>
          <div className="ui-modal-body">{children}</div>
          {foot && <div className="ui-modal-foot">{foot}</div>}
        </>
      )}
    </dialog>
  );
}

/** Color: muestra + selector del sistema + hex escrito a mano. */
export function ColorField({ label, value, onChange, allowTransparent, testId }: { label: string; value: string; onChange: (v: string) => void; allowTransparent?: boolean; testId?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const id = useId();
  const swatch = value === 'transparent' ? '#ffffff' : value.slice(0, 7);
  return (
    <span className="dz-color" data-testid={testId}>
      <label className="dz-color-swatch" htmlFor={`${id}-c`} title={label} style={{ background: value === 'transparent' ? undefined : value }} data-transparent={value === 'transparent' || undefined}>
        <span className="sr-only">{label}</span>
        <input id={`${id}-c`} type="color" value={/^#[0-9a-f]{6}$/i.test(swatch) ? swatch : '#000000'} onChange={(e) => onChange(e.target.value)} />
      </label>
      <input
        className="input dz-color-hex"
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = text.trim();
          if (isColor(v) && (allowTransparent || v !== 'transparent')) onChange(v);
          else setText(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        spellCheck={false}
      />
    </span>
  );
}

/** Menú desplegable simple (botón + lista), se cierra con Esc o al hacer clic afuera. */
export function Popover({
  label,
  button,
  children,
  className,
  align = 'left',
  testId,
}: {
  label: string;
  button: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
  align?: 'left' | 'right';
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Fijo en la pantalla (debajo del botón, dentro de la ventana): así no lo
  // recorta la barra de herramientas, que scrollea en horizontal.
  // Devuelve false si el botón ya no se ve (el menú no tendría dónde colgarse).
  const place = (): boolean => {
    const btn = ref.current?.querySelector('button');
    const body = bodyRef.current;
    if (!btn || !body) return true;
    const r = btn.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return false;
    const w = body.offsetWidth;
    const h = body.offsetHeight;
    let left = align === 'right' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8 && r.top - h - 4 > 8) top = r.top - h - 4;
    setPos({ top, left });
    return true;
  };
  const placeRef = useRef(place);
  placeRef.current = place;
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    placeRef.current();
  }, [open, align]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // Al scrollear, el menú sigue al botón; si el botón sale de la pantalla, se cierra.
    const onScroll = (e: Event) => {
      if (bodyRef.current?.contains(e.target as Node)) return;
      if (!placeRef.current()) setOpen(false);
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        (ref.current?.querySelector('button') as HTMLButtonElement | null)?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div className={`dz-pop ${className ?? ''}`} ref={ref}>
      <button type="button" className="btn btn-ghost btn-sm dz-tool" aria-expanded={open} aria-haspopup="true" aria-label={label} title={label} onClick={() => setOpen((o) => !o)} data-testid={testId}>
        {button}
      </button>
      {open && (
        <div
          ref={bodyRef}
          className={`dz-pop-body dz-pop-${align}`}
          role="group"
          aria-label={label}
          style={pos ? { position: 'fixed', top: pos.top, left: pos.left, right: 'auto' } : { position: 'fixed', visibility: 'hidden', top: 0, left: 0 }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function Glyph({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Trazos de los botones del editor. */
export const G = {
  undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  back: 'M15 18l-6-6 6-6',
  comment: 'M4 5h16v11H9l-5 4z',
  play: 'M7 5v14l11-7z',
  share: 'M16 6l-4-4-4 4 M12 2v13 M5 12v8h14v-8',
  download: 'M12 4v11 M7 10l5 5 5-5 M4 20h16',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  copy: 'M8 8h12v12H8z M4 16V4h12',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 7.5-2',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18 M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3 3.6 M6.4 6.5C3.8 8.3 2 12 2 12s4 6 10 6a9.6 9.6 0 0 0 4-.9',
  up: 'M12 19V5 M6 11l6-6 6 6',
  down: 'M12 5v14 M6 13l6 6 6-6',
  layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
  shapes: 'M3 13h8v8H3z M17 3l4 7h-8z M17 14a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  text: 'M5 6V4h14v2 M12 4v16 M9 20h6',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 16v4h16v-4',
  brand: 'M12 3a9 9 0 1 0 0 18c1 0 2-.8 2-1.8 0-1-1-1.6-1-2.6 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z',
  template: 'M4 4h16v16H4z M4 10h16 M10 10v10',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7z M7 12h7a4 4 0 0 1 0 8H7z',
  italic: 'M10 4h8 M6 20h8 M15 4L9 20',
  underline: 'M7 4v7a5 5 0 0 0 10 0V4 M5 20h14',
  caps: 'M4 18L8 6l4 12 M5.5 14h5 M14 18l3-9 3 9 M15 15h4',
  alignLeft: 'M4 6h16 M4 10h10 M4 14h16 M4 18h10',
  alignCenter: 'M4 6h16 M7 10h10 M4 14h16 M7 18h10',
  alignRight: 'M4 6h16 M10 10h10 M4 14h16 M10 18h10',
  crop: 'M6 2v16h16 M2 6h16v16',
  flipH: 'M12 3v18 M8 7L3 12l5 5z M16 7l5 5-5 5z',
  flipV: 'M3 12h18 M7 8l5-5 5 5z M7 16l5 5 5-5z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  group: 'M3 3h7v7H3z M14 14h7v7h-7z M10 6h4 M6 10v4',
  position: 'M4 4h7v7H4z M13 13h7v7h-7z',
  keyboard: 'M3 6h18v12H3z M7 10h.01 M11 10h.01 M15 10h.01 M7 14h10',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  page: 'M6 3h12v18H6z',
  opacity: 'M12 3a9 9 0 1 0 0 18z M12 3a9 9 0 0 1 0 18',
};
