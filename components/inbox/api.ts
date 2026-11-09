'use client';

/** fetch JSON a la API de Inbox: { ok, status, data } (nunca lanza). */
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

/** Aviso entre la app, la barra de carpetas y Ajustes: algo cambió, recargar. */
export const INBOX_CHANGED = 'zs:inbox-changed';

export function notifyInboxChanged() {
  window.dispatchEvent(new Event(INBOX_CHANGED));
}

/** Arrastrar chats de la lista: tipo de dato con los ids (JSON). */
export const THREADS_MIME = 'application/x-zs-inbox-threads';
/** Chats soltados sobre una carpeta del sidebar: la app los mueve y ofrece deshacer. */
export const INBOX_DROP_THREADS = 'zs:inbox-drop-threads';
export interface DropThreadsDetail {
  ids: string[];
  folderId: string;
  folderName: string;
}

/** ¿El foco está en un campo de texto? (los atajos de una letra no corren ahí). */
export function typingIn(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

/** Iniciales para el avatar ("Ana Pérez" → "AP", "+54 9 11…" → "#"). */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '#';
  if (/^\d/.test(words[0])) return '#';
  return (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase();
}

/** Color estable por chat para el avatar (de la paleta de carpetas). */
export function avatarHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/** "14:05" hoy, "lun" esta semana, "12/3" antes. */
export function shortWhen(iso: string | null, locale: string, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 6 && days > 0) return d.toLocaleDateString(locale, { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: '2-digit' });
}

/** "lun 19 oct, 21:40" para fechas futuras (posponer, programar). */
export function longWhen(iso: string | null, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Valor para <input type="datetime-local"> en la zona del navegador. */
export function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
