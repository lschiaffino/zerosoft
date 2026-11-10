'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMounted } from '@/components/ui/useMounted';

/** fetch JSON a la API de Calls: { ok, status, data } (nunca lanza). */
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

/** Fecha en la zona del navegador (recién al hidratar). */
export function useDate() {
  const locale = useLocale();
  const mounted = useMounted();
  return useCallback(
    (value: string | null | undefined, withTime = true) => {
      if (!value || !mounted) return '';
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleString(locale, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
    },
    [locale, mounted],
  );
}

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

/** Texto del error de la API en el idioma de la UI (calls.errors.<código>). */
export function useErrorText() {
  const t = useTranslations('calls.errors');
  return useCallback(
    (code: string | undefined | null) => {
      const key = code || 'generic';
      return t.has(key) ? t(key) : t('generic');
    },
    [t],
  );
}

/** Modal (<dialog>): Esc cierra, el foco queda adentro, Enter envía el form de adentro. */
export function CallsDialog({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
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
      className={`ui-modal cl-dialog${wide ? ' cl-dialog-wide' : ''}`}
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

/** 0 → "0:00"; 3_725_000 → "1:02:05". */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`;
}

/** Duración corta: "42 min", "1 h 05 min", "35 s". */
export function useDuration() {
  const t = useTranslations('calls');
  return useCallback(
    (ms: number) => {
      const s = Math.round(ms / 1000);
      if (s < 60) return t('dur.s', { n: s });
      const m = Math.round(s / 60);
      if (m < 60) return t('dur.m', { n: m });
      return t('dur.hm', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') });
    },
    [t],
  );
}

/** Estados en que la llamada todavía cambia sola (la UI vuelve a preguntar). */
export const MOVING = ['queued', 'joining', 'waiting', 'recording', 'uploading', 'processing'];

export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('calls.status');
  const tone = status === 'ready' ? '' : status === 'failed' ? ' badge-bad' : status === 'recording' ? ' badge-warn' : MOVING.includes(status) ? ' badge-info' : ' badge-outline';
  if (status === 'ready') return null;
  return (
    <span className={`badge${tone} cl-status`} data-status={status}>
      {status === 'recording' && <i className="cl-rec-dot" aria-hidden="true" />}
      {t.has(status) ? t(status) : status}
    </span>
  );
}

const PART = 4 * 1024 * 1024;

/** Sube una grabación en partes de 4 MB (hasta 3 a la vez, con reintento). */
export async function uploadRecording(callId: string, file: File, onProgress: (done: number, total: number) => void): Promise<void> {
  const count = Math.max(1, Math.ceil(file.size / PART));
  let sent = 0;
  let next = 0;
  const sendOne = async (n: number) => {
    let lastError = 'network';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`/api/calls/calls/${callId}/parts/${n}`, { method: 'PUT', body: file.slice(n * PART, (n + 1) * PART) });
        if (res.ok) return;
        lastError = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'generic';
        if (res.status < 500 && res.status !== 429) break;
      } catch {
        lastError = 'network';
      }
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
    throw new Error(lastError);
  };
  await Promise.all(
    Array.from({ length: Math.min(3, count) }, async () => {
      while (next < count) {
        const n = next++;
        await sendOne(n);
        sent++;
        onProgress(sent, count);
      }
    }),
  );
  const durationMs = await mediaDuration(file);
  const res = await api(`/api/calls/calls/${callId}/complete`, { method: 'POST', json: durationMs ? { durationMs } : {} });
  if (!res.ok) throw new Error(res.data.error ?? 'generic');
}

/** Duración de un audio o video, leída en el navegador antes de subirlo. */
function mediaDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
    el.preload = 'metadata';
    const done = (d?: number) => {
      URL.revokeObjectURL(url);
      resolve(d && Number.isFinite(d) ? Math.round(d * 1000) : undefined);
    };
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done();
    window.setTimeout(() => done(), 8000);
    el.src = url;
  });
}
