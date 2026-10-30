'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/shop-money';

/** fetch JSON a la API de Shop: { ok, status, data } (nunca lanza). */
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

/** Texto del error de la API en el idioma de la UI (shop.errors.<code>). */
export function useErrorText() {
  const t = useTranslations('shop.errors');
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
  return useCallback((cents: number) => formatMoney(cents, currency, locale), [currency, locale]);
}

export function useDate() {
  const locale = useLocale();
  return useCallback(
    (value: string | null | undefined, withTime = true) => {
      if (!value) return '';
      const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
      if (Number.isNaN(d.getTime())) return value;
      return d.toLocaleString(locale, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
    },
    [locale],
  );
}

const STATUS_CLASS: Record<string, string> = {
  pending: 'badge-warn',
  paid: 'badge-info',
  fulfilled: 'badge-ok',
  cancelled: 'badge-outline',
  refunded: 'badge-bad',
  active: 'badge-ok',
  draft: 'badge-outline',
  archived: 'badge-outline',
};

export function StatusBadge({ status, kind = 'order' }: { status: string; kind?: 'order' | 'product' }) {
  const t = useTranslations('shop');
  const key = `${kind === 'order' ? 'orderStatus' : 'productStatus'}.${status}`;
  return (
    <span className={`badge ${STATUS_CLASS[status] ?? 'badge-outline'}`} data-status={status}>
      {t.has(key) ? t(key) : status}
    </span>
  );
}

/** Toasts simples (mismo estilo que el resto de la app). */
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

/** Modal de la app (<dialog>): Esc cierra, foco atrapado, Enter envía el form. */
export function ShopDialog({ open, title, onClose, children, wide = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
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
      className={`ui-modal shop-dialog${wide ? ' shop-dialog-wide' : ''}`}
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

/** "12.50" ⇄ cents en un input de dinero. */
export function MoneyInput({ value, onChange, label, id, required }: { value: number | null; onChange: (v: number | null) => void; label: string; id: string; required?: boolean }) {
  const [text, setText] = useState(value == null ? '' : (value / 100).toFixed(2));
  useEffect(() => {
    const parsed = text.trim() === '' ? null : Math.round(Number(text.replace(',', '.')) * 100);
    if (parsed !== value && !(Number.isNaN(parsed) && value == null)) setText(value == null ? '' : (value / 100).toFixed(2));
    // Solo cuando cambia desde afuera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      id={id}
      className="input"
      inputMode="decimal"
      aria-label={label}
      required={required}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const raw = e.target.value.trim().replace(',', '.');
        if (raw === '') onChange(null);
        else if (/^\d+(\.\d{0,2})?$/.test(raw)) onChange(Math.round(Number(raw) * 100));
      }}
    />
  );
}
