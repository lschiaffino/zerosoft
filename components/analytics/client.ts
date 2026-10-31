'use client';

/**
 * Analytics del lado del cliente: pedidos a /api/analytics/*, el aviso de
 * cambios (para el sidebar y las listas) y formatos.
 */
import type { InsightQuery, InsightResult, WebQuery, WebResult } from '@/lib/analytics/types';

export const ANALYTICS_CHANGED = 'zs:analytics-changed';
export const PROJECT_COOKIE = 'zs_analytics_project';

export function notifyChanged(): void {
  window.dispatchEvent(new Event(ANALYTICS_CHANGED));
}

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public detail?: string | null,
  ) {
    super(code);
  }
}

/** Mensaje para la persona: el código de la API (server_error, invalid_body…) nunca se muestra crudo. */
export function apiErrorText(err: unknown, t: (key: 'error' | 'errorInvalid') => string): string {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 ? t('errorInvalid') : t('error');
}

export async function api<T>(url: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body ? 'POST' : 'GET'),
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: init?.signal,
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(typeof data.error === 'string' ? data.error : 'request_failed', res.status, (data.detail as string | null) ?? null);
  return data as T;
}

export async function runQuery(projectId: string, query: InsightQuery, signal?: AbortSignal): Promise<InsightResult> {
  return (await api<{ result: InsightResult }>('/api/analytics/query', { body: { projectId, query }, signal })).result;
}

export async function runWebQuery(projectId: string, query: WebQuery, signal?: AbortSignal): Promise<WebResult> {
  return (await api<{ result: WebResult }>('/api/analytics/query', { body: { projectId, query }, signal })).result;
}

/** Elige el proyecto que se mira (cookie de un año) y recarga. */
export function setProjectCookie(id: string): void {
  document.cookie = `${PROJECT_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function fmtNumber(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
}

export function fmtPercent(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(n);
}

export function fmtDuration(ms: number | null): string {
  if (ms == null) return '–';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function fmtTime(ts: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(ts));
}

/** Etiqueta corta de una cubeta ('2026-10-29', '2026-10-29 14:00'). */
export function bucketLabel(bucket: string, locale: string): string {
  const hour = / (\d{2}):00$/.exec(bucket);
  const d = new Date(`${bucket.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return bucket;
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
  return hour ? `${day} ${hour[1]}:00` : day;
}

/** Cambio contra el período anterior (null si no hay base). */
export function delta(value: number, previous: number | null): number | null {
  if (previous == null || previous === 0) return null;
  return (value - previous) / previous;
}
