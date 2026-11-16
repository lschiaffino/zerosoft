'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatMinutes } from '@/lib/time/types';

export { formatMinutes };

/** fetch JSON a la API de Time: { ok, status, data } (nunca lanza). */
export async function api<T = Record<string, unknown>>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const { json, ...rest } = init;
  try {
    const res = await fetch(url, {
      ...rest,
      headers: {
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(rest.headers ?? {}),
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return { ok: res.ok, status: res.status, data };
  } catch {
    return {
      ok: false,
      status: 0,
      data: { error: 'network' } as T & { error?: string },
    };
  }
}

/** Texto del error de la API en el idioma de la UI (time.errors.<code>). */
export function useErrorText() {
  const t = useTranslations('time.errors');
  return useCallback(
    (code: string | undefined | null) => {
      const key = code || 'generic';
      return t.has(key) ? t(key) : t('generic');
    },
    [t],
  );
}

/** Fecha local de hoy "YYYY-MM-DD" (la del navegador, recién al montar). */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Formatea una fecha "YYYY-MM-DD" sin que el huso la corra de día. */
export function useDayFormat() {
  const locale = useLocale();
  return useCallback(
    (date: string, opts: Intl.DateTimeFormatOptions) =>
      new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, {
        timeZone: 'UTC',
        ...opts,
      }),
    [locale],
  );
}

/** Monto en centavos con la moneda del workspace. */
export function useMoney(currency: string) {
  const locale = useLocale();
  return useCallback(
    (cents: number) => {
      try {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
        }).format(cents / 100);
      } catch {
        return `${currency} ${(cents / 100).toFixed(2)}`;
      }
    },
    [locale, currency],
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

/** Modal (<dialog>): Esc cierra, el foco queda adentro, Enter envía el form de adentro. */
export function TimeDialog({ open, title, onClose, children, testId }: { open: boolean; title: string; onClose: () => void; children: ReactNode; testId?: string }) {
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
      className="ui-modal tm-dialog"
      aria-label={title}
      data-testid={testId}
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

/** Horas con dos decimales para inputs ("1.5"); vacío si no hay. */
export function minutesToHoursInput(minutes: number | null): string {
  if (minutes === null) return '';
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0$/, '');
}

/** "12.50" o "12,50" → centavos; null si vacío; NaN si no se entiende. */
export function parseMoney(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, '');
  if (!s) return null;
  const normalized = s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Math.round(Number(normalized) * 100);
}
