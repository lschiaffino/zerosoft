'use client';

import { useMounted } from '@/components/ui/useMounted';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';

/** fetch JSON a la API de Hiring: { ok, status, data } (nunca lanza). */
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

/** Texto del error de la API en el idioma de la UI (hiring.errors.<code>). */
export function useErrorText() {
  const t = useTranslations('hiring.errors');
  return useCallback(
    (code: string | undefined | null) => {
      const key = code || 'generic';
      return t.has(key) ? t(key) : t('generic');
    },
    [t],
  );
}

export function useDate() {
  const locale = useLocale();
  const mounted = useMounted();
  return useCallback(
    (value: string | null | undefined, withTime = true) => {
      if (!value || (!mounted)) return '';
      const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
      if (Number.isNaN(d.getTime())) return value;
      return d.toLocaleString(locale, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
    },
    [locale, mounted],
  );
}

const JOB_CLASS: Record<string, string> = { published: 'badge-ok', draft: 'badge-outline', closed: 'badge-warn', archived: 'badge-outline' };
const APP_CLASS: Record<string, string> = { active: 'badge-info', rejected: 'badge-bad', hired: 'badge-ok', withdrawn: 'badge-outline' };

export function JobStatusBadge({ status }: { status: string }) {
  const t = useTranslations('hiring.jobStatus');
  return (
    <span className={`badge ${JOB_CLASS[status] ?? 'badge-outline'}`} data-status={status}>
      {t.has(status) ? t(status) : status}
    </span>
  );
}

export function AppStatusBadge({ status }: { status: string }) {
  const t = useTranslations('hiring.appStatus');
  return (
    <span className={`badge ${APP_CLASS[status] ?? 'badge-outline'}`} data-status={status}>
      {t.has(status) ? t(status) : status}
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

/** Modal (<dialog>): Esc cierra, foco atrapado por el navegador, Enter envía el form de adentro. */
export function HrDialog({ open, title, onClose, children, wide = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
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
      className={`ui-modal hr-dialog${wide ? ' hr-dialog-wide' : ''}`}
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

export function money(amount: number | null | undefined, currency: string, locale: string): string {
  if (amount == null) return '';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}
