'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';

/** fetch JSON a la API de People: { ok, status, data } (nunca lanza). */
export async function api<T = Record<string, unknown>>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const { json, ...rest } = init;
  try {
    const res = await fetch(url, {
      ...rest,
      headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(rest.headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'network' } as T & { error?: string } };
  }
}

/** Texto del error de la API en el idioma de la UI (people.errors.<code>). */
export function useErrorText() {
  const t = useTranslations('people.errors');
  return useCallback(
    (code: string | undefined | null) => {
      const key = code || 'generic';
      return t.has(key) ? t(key) : t('generic');
    },
    [t],
  );
}

/** 'YYYY-MM-DD' o ISO → fecha corta en el idioma de la UI (las fechas de licencias son días, en UTC). */
export function useDay() {
  const locale = useLocale();
  return useCallback(
    (value: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) => {
      if (!value) return '';
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
      const d = new Date(dateOnly ? `${value}T00:00:00Z` : value);
      if (Number.isNaN(d.getTime())) return value;
      return dateOnly ? d.toLocaleDateString(locale, { ...opts, timeZone: 'UTC' }) : d.toLocaleString(locale, opts);
    },
    [locale],
  );
}

export function useNumber() {
  const locale = useLocale();
  return useCallback((n: number, max = 2) => n.toLocaleString(locale, { maximumFractionDigits: max }), [locale]);
}

/** Toasts (mismo estilo que el resto de la app). */
export function useToast(): [ReactNode, (msg: string, tone?: 'ok' | 'bad') => void] {
  const [items, setItems] = useState<Array<{ id: number; msg: string; tone: 'ok' | 'bad' }>>([]);
  const seq = useRef(0);
  const push = useCallback((msg: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = ++seq.current;
    setItems((x) => [...x, { id, msg, tone }]);
    window.setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3500);
  }, []);
  const node = (
    <div className="ui-toasts" role="status" aria-live="polite">
      {items.map((i) => (
        <div key={i.id} className={`ui-toast${i.tone === 'bad' ? ' ui-toast-bad' : ''}`}>
          {i.msg}
        </div>
      ))}
    </div>
  );
  return [node, push];
}

/** Modal (<dialog>): Esc cierra, foco atrapado, Enter envía el form de adentro. */
export function Dialog({ open, title, onClose, children, wide = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
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
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <>
          <div className="ui-modal-head">
            <h2 className="ui-modal-title">{title}</h2>
          </div>
          {children}
        </>
      )}
    </dialog>
  );
}

/** Foto o iniciales. */
export function Avatar({ name, photo, size = 32 }: { name: string; photo?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="ppl-avatar" src={photo} alt="" width={size} height={size} style={{ width: size, height: size }} />
  ) : (
    <span className="ppl-avatar ppl-avatar-initials" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size / 2.6)) }}>
      {initials || '?'}
    </span>
  );
}

/** Pestañas con role=tablist (flechas, Home y End). */
export function Tabs<K extends string>({ items, value, onChange, label }: { items: Array<{ key: K; label: string; count?: number }>; value: K; onChange: (k: K) => void; label: string }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div className="ui-tabs" role="tablist" aria-label={label}>
      {items.map((it, i) => (
        <button
          key={it.key}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          className="ui-tab"
          aria-selected={value === it.key}
          tabIndex={value === it.key ? 0 : -1}
          onClick={() => onChange(it.key)}
          onKeyDown={(e) => {
            let next = -1;
            if (e.key === 'ArrowRight') next = (i + 1) % items.length;
            if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
            if (e.key === 'Home') next = 0;
            if (e.key === 'End') next = items.length - 1;
            if (next >= 0) {
              e.preventDefault();
              onChange(items[next].key);
              refs.current[next]?.focus();
            }
          }}
        >
          {it.label}
          {it.count != null && <span className="ui-tab-count"> {it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="ui-field">
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="ppl-hint">{hint}</p>}
    </div>
  );
}

/** Un dato de la ficha: etiqueta y valor (o "Solo HR" si quien mira no lo ve). */
export function Fact({ label, value, hidden }: { label: string; value: ReactNode; hidden?: boolean }) {
  const t = useTranslations('people.profile');
  return (
    <div className="ppl-fact">
      <dt>{label}</dt>
      <dd>{hidden ? <span className="ppl-muted">{t('restricted')}</span> : value || <span className="ppl-muted">{t('notSet')}</span>}</dd>
    </div>
  );
}

export function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="ppl-bar" role="img" aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
