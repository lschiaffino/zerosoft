'use client';

import { useCallback, useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/*
 * Lo mínimo de components/groups/ui.tsx que usan también los diálogos compartidos con Inbox (encuesta,
 * contacto): el fetch con JSON, el texto de los errores y el modal. Aparte, para que Inbox no cargue todos
 * los textos de Lines (tests/unit/i18n-client-namespaces.test.ts). ui.tsx lo vuelve a exportar.
 */

/** fetch con JSON: devuelve { data } o { error: código }. Nunca tira. */
export async function api<T = Record<string, unknown>>(
  url: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<{ data: T; error: null } | { data: null; error: string }> {
  try {
    const res = await fetch(url, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
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
    if (open && !d.open) {
      d.showModal();
      // Abierto con un atajo (C, N...): el foco va al primer campo, no queda en la página.
      requestAnimationFrame(() => {
        if (d.contains(document.activeElement) && document.activeElement !== d) return;
        const first = d.querySelector<HTMLElement>('.ui-modal-body [autofocus], .ui-modal-body input:not([type=hidden]):not([disabled]), .ui-modal-body textarea, .ui-modal-body select, .ui-modal-body button, .ui-modal-foot button');
        first?.focus();
      });
    }
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
      // Solo abierto, cuando el título existe: el <dialog> cerrado viene del servidor con el id del servidor, y si el
      // de la hidratación sale distinto React no corrige el atributo; así el nombre se pone en el cliente, con el id del título.
      aria-labelledby={open ? titleId : undefined}
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
