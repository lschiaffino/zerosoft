'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatMoney, parseAmountLocal, toInputString } from '@/lib/books-money';

/** fetch JSON a la API de Books: { ok, status, data } (nunca lanza). */
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

/** Texto del error de la API (books.errors.<code>, con un genérico). */
export function useErrorText() {
  const t = useTranslations('books.errors');
  return useCallback(
    (code: string | undefined | null) => {
      const key = code || 'generic';
      return t.has(key) ? t(key) : t('generic');
    },
    [t],
  );
}

export function useMoney(currency: string) {
  const locale = useLocale();
  return useCallback((minor: number) => formatMoney(minor, currency, locale), [currency, locale]);
}

export function useDate() {
  const locale = useLocale();
  return useCallback(
    (value: string | null | undefined, withTime = false) => {
      if (!value) return '';
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return value;
      return d.toLocaleString(locale, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium', timeZone: 'UTC' });
    },
    [locale],
  );
}

const STATUS_CLASS: Record<string, string> = {
  draft: 'badge-outline',
  sent: 'badge-info',
  partial: 'badge-warn',
  paid: 'badge-ok',
  overdue: 'badge-bad',
  void: 'badge-outline',
  posted: 'badge-ok',
  received: 'badge-ok',
  cancelled: 'badge-outline',
  active: 'badge-ok',
  paused: 'badge-outline',
  ended: 'badge-outline',
  unmatched: 'badge-warn',
  matched: 'badge-ok',
  ignored: 'badge-outline',
};

export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('books.status');
  return (
    <span className={`badge ${STATUS_CLASS[status] ?? 'badge-outline'}`} data-status={status}>
      {t.has(status) ? t(status) : status}
    </span>
  );
}

export function useToast(): [ReactNode, (msg: string, tone?: 'ok' | 'bad') => void] {
  const [items, setItems] = useState<Array<{ id: number; msg: string; tone: 'ok' | 'bad' }>>([]);
  const seq = useRef(0);
  const push = useCallback((msg: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = ++seq.current;
    setItems((x) => [...x, { id, msg, tone }]);
    window.setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4000);
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

/** Modal (<dialog>): Esc cierra, clic en el telón cierra, Enter envía el form de adentro. */
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
      className={`ui-modal bk-dialog${wide ? ' bk-dialog-wide' : ''}`}
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

/** Input de dinero en texto decimal ("1234.50"): emite unidades mínimas de la moneda (o null). */
export function MoneyInput({ value, onChange, currency, label, id, required, autoFocus }: { value: number | null; onChange: (v: number | null) => void; currency: string; label: string; id?: string; required?: boolean; autoFocus?: boolean }) {
  const [text, setText] = useState(value == null ? '' : toInputString(value, currency));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value == null ? '' : toInputString(value, currency));
    }
  }, [value, currency]);
  return (
    <input
      id={id}
      className="input num"
      inputMode="decimal"
      aria-label={label}
      required={required}
      autoFocus={autoFocus}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = e.target.value.trim() === '' ? null : parseAmountLocal(e.target.value, currency);
        if (e.target.value.trim() === '' || parsed != null) {
          last.current = parsed;
          onChange(parsed);
        }
      }}
    />
  );
}

/** Sección que el rol de Books no puede ver. */
export function NoAccess() {
  const t = useTranslations('books.common');
  return (
    <div className="app-page ui-page bk-page">
      <div className="panel bk-panel" role="alert">
        <h1 className="bk-panel-title">{t('noAccessTitle')}</h1>
        <p className="ui-help">{t('noAccessBody')}</p>
      </div>
    </div>
  );
}

export function Kpi({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="bk-kpi">
      <span className="bk-kpi-label">{label}</span>
      <span className={`bk-kpi-value${small ? ' bk-kpi-small' : ''}`}>{value}</span>
    </div>
  );
}
