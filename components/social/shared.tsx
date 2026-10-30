'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ValidationIssue } from '@/lib/social-networks';

/** Red con su marca de color. */
export function NetworkTag({ network, name }: { network: string; name: string }) {
  return (
    <span className="sc-net" data-net={network}>
      {name}
    </span>
  );
}

/** Estado de una publicación, destino o cuenta. */
export function StatusTag({ status }: { status: string }) {
  const t = useTranslations('social.status');
  return (
    <span className="sc-status" data-s={status}>
      {t.has(status) ? t(status) : status}
    </span>
  );
}

/** Llamada JSON a /api/social; tira con el código de error del servidor. */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api/social${path}`, {
    ...rest,
    headers: json !== undefined ? { 'content-type': 'application/json', ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
  if (!res.ok) throw Object.assign(new Error(data.error ?? `http_${res.status}`), { code: data.error ?? `http_${res.status}`, details: data.details });
  return data as T;
}

export type ApiError = Error & { code?: string; details?: unknown };

/** Mensaje de error traducido (social.errors.<code>), o el genérico. */
export function useErrorText() {
  const t = useTranslations('social.errors');
  return (err: unknown) => {
    const code = (err as ApiError)?.code ?? '';
    return t.has(code) ? t(code) : t('generic');
  };
}

/** Texto de un problema de validación de una red. */
export function useIssueText() {
  const t = useTranslations('social.issues');
  return (issue: ValidationIssue) => {
    const { code, ...vars } = issue as ValidationIssue & Record<string, string | number>;
    return t(code, vars as Record<string, string | number>);
  };
}

export function fmtDateTime(iso: string | null, locale: string, tz?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', ...(tz ? { timeZone: tz } : {}) }).format(d);
}

export function fmtNum(n: number | null | undefined, locale: string): string {
  if (n == null) return '·';
  return new Intl.NumberFormat(locale, { notation: n >= 100_000 ? 'compact' : 'standard' }).format(n);
}

export function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

/** Aviso corto abajo a la derecha (se va solo). */
export function useToast(): [ReactNode, (msg: string, bad?: boolean) => void] {
  const [toast, setToast] = useState<{ msg: string; bad: boolean } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  const node = (
    <div className="ui-toasts" role="status" aria-live="polite">
      {toast && (
        <div className="ui-toast" data-tone={toast.bad ? 'error' : undefined}>
          {toast.msg}
        </div>
      )}
    </div>
  );
  return [node, (msg, bad = false) => setToast({ msg, bad })];
}
