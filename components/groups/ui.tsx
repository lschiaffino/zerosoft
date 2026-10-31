'use client';

import { useMounted } from '@/components/ui/useMounted';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { mediaKind, previewToken } from '@/lib/groups-rules';
import { parseDbUtc } from '@/lib/utils';

/** fetch con JSON: devuelve { data } o { error: código }. Nunca tira. */
export async function api<T = Record<string, unknown>>(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ data: T; error: null } | { data: null; error: string }> {
  try {
    const res = await fetch(url, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const e = json.error;
      return { data: null, error: typeof e === 'string' ? e : typeof e === 'object' && e ? String((e as { code?: string }).code) : 'server_error' };
    }
    return { data: json as T, error: null };
  } catch {
    return { data: null, error: 'network_error' };
  }
}

/** Traduce un código de error de la API (groups.errors.*), con uno genérico de respaldo. */
export function useErrorText() {
  const t = useTranslations('groups.errors');
  return useCallback(
    (code: string | null | undefined) => {
      if (!code) return '';
      const [base, ...rest] = code.split(':');
      // Con detalle (ej. missing_columns:empresa plan) se dice qué falta, si hay texto para eso.
      const detail = rest.join(':').trim();
      if (detail && t.has(`${base}_detail`)) return t(`${base}_detail`, { detail: detail.split(/\s+/).join(', ') });
      return t.has(base) ? t(base) : t('generic');
    },
    [t],
  );
}

/** El número a proponer: el primero conectado (si no hay, el primero). */
export function defaultNumberId(numbers: ReadonlyArray<{ id: string; status: string }>, prefer?: string | null): string {
  const connected = numbers.filter((n) => n.status === 'connected');
  if (prefer && connected.some((n) => n.id === prefer)) return prefer;
  return connected[0]?.id ?? numbers[0]?.id ?? '';
}

/** Opciones de "Desde el número": los no conectados se ven, con su estado, pero no se pueden elegir. */
export function NumberOptions({ numbers }: { numbers: ReadonlyArray<{ id: string; name: string; phone: string; status: string }> }) {
  const t = useTranslations('groups');
  return (
    <>
      {numbers.map((n) => (
        <option key={n.id} value={n.id} disabled={n.status !== 'connected'}>
          {n.name}
          {n.phone ? ` +${n.phone}` : ''}
          {n.status !== 'connected' ? ` (${t(`numberStatus.${n.status}`)})` : ''}
        </option>
      ))}
    </>
  );
}

/** Texto de una vista previa o adjunto: el nombre del archivo o el tipo traducido (Imagen, Audio...). */
export function useMediaText() {
  const t = useTranslations('groups.media');
  return useCallback(
    (input: { preview?: string; media?: { type: string; name: string } | null }) => {
      if (input.media) return input.media.name || t(mediaKind(input.media.type));
      const tok = previewToken(input.preview ?? '');
      return tok ? t(tok) : input.preview ?? '';
    },
    [t],
  );
}

/** "hace 5 min" corto y en el idioma de la página. */
export function useRelativeTime() {
  const t = useTranslations('groups.time');
  const locale = useLocale();
  const mounted = useMounted();
  return (iso: string | null | undefined, now = Date.now()) => {
    if (!iso || !mounted) return '';
    const diff = Math.max(0, now - parseDbUtc(iso).getTime());
    const min = Math.floor(diff / 60_000);
    if (min < 1) return t('now');
    if (min < 60) return t('min', { n: min });
    const h = Math.floor(min / 60);
    if (h < 24) return t('hours', { n: h });
    const d = Math.floor(h / 24);
    if (d < 7) return t('days', { n: d });
    return parseDbUtc(iso).toLocaleDateString(locale);
  };
}

export function formatMinutes(min: number | null | undefined, t: (k: string, v?: Record<string, number>) => string): string {
  if (min == null) return '—';
  if (min < 60) return t('min', { n: min });
  if (min < 60 * 24) return t('hours', { n: Math.round(min / 60) });
  return t('days', { n: Math.round(min / 1440) });
}

/**
 * Modal de la app (<dialog class="ui-modal">): Esc y clic en el telón
 * cierran, Enter envía el formulario.
 */
export function Modal({
  open,
  title,
  onClose,
  onSubmit,
  children,
  foot,
  wide = false,
  busy = false,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  onSubmit?: () => void;
  children: ReactNode;
  foot?: ReactNode;
  wide?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) onSubmit?.();
  };
  return (
    <dialog
      ref={ref}
      className={`ui-modal${wide ? ' ui-modal-wide' : ''}`}
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      {open && (
        <form onSubmit={submit}>
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id={titleId}>
              {title}
            </h2>
          </div>
          <div className="ui-modal-body">{children}</div>
          {foot && <div className="ui-modal-foot">{foot}</div>}
        </form>
      )}
    </dialog>
  );
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
  const show = useCallback((msg: string, bad = false) => setToast({ msg, bad }), []);
  return [node, show];
}

/** Placa cuadrada con iniciales (o el ícono de grupo). */
export function ChatPlate({ name, kind }: { name: string; kind: 'dm' | 'group' }) {
  const initials =
    name
      .replace(/^\+/, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '#';
  return (
    <span className={`gr-plate${kind === 'group' ? ' gr-plate-group' : ''}`} aria-hidden="true">
      {kind === 'group' ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="8" r="3" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M3 19c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5M15 15c2.6 0 4.6 1.2 5.5 3.5" />
        </svg>
      ) : (
        initials
      )}
    </span>
  );
}

export function LabelTag({ name, color }: { name: string; color: string }) {
  return (
    <span className={`gr-label gr-label-${color}`}>
      <i aria-hidden="true" />
      {name}
    </span>
  );
}
