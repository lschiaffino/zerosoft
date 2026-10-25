'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import type { HealthState } from '@/lib/track-planning-core';

/** fetch JSON con { ok, status, data } (sin tirar en errores de red). */
export async function api<T = Record<string, unknown>>(
  url: string,
  method = 'GET',
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: T }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: {} as T };
  }
}

export interface Person {
  id: string;
  name: string | null;
  email: string;
}

export const personName = (p: Person | undefined | null) => (p ? p.name || p.email : '');

/** YYYY-MM-DD → fecha corta del idioma ("12 nov"). */
export function fmtDay(day: string | null | undefined, locale: string, withYear = false): string {
  if (!day) return '';
  const d = new Date(`${day.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: withYear || !sameYear ? 'numeric' : undefined });
}

export function fmtWhen(iso: string, locale: string): string {
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Ícono de salud (círculo con color semántico), como en Linear. */
export function HealthDot({ health, label }: { health: HealthState; label: string }) {
  return (
    <span className={`tp-health tp-health-${health}`} title={label}>
      <span className="tp-health-dot" aria-hidden="true" />
      <span className="tp-health-label">{label}</span>
    </span>
  );
}

/** Estado de un plan: círculo como el de los status de issues. */
export function PlanStatusIcon({ status }: { status: string }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const fill: Record<string, number> = { backlog: 0, planned: 0, in_progress: 0.5, paused: 0.5, completed: 1, canceled: 1 };
  const f = fill[status] ?? 0;
  return (
    <svg className={`tp-status-icon tp-status-${status}`} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray={status === 'backlog' ? '2 2' : undefined} />
      {f > 0 && f < 1 && (
        <circle cx="8" cy="8" r={r / 2} fill="none" stroke="currentColor" strokeWidth={r} strokeDasharray={`${(c / 2) * f} ${c}`} transform="rotate(-90 8 8)" />
      )}
      {f === 1 && <circle cx="8" cy="8" r={r} fill="currentColor" />}
    </svg>
  );
}

export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <span className="tp-progress" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span className="tp-progress-track">
        <span className="tp-progress-fill" style={{ width: `${p}%` }} />
      </span>
      <span className="tp-progress-num">{p}%</span>
    </span>
  );
}

/** Modal liviano sobre <dialog class="ui-modal">: Esc y clic afuera cierran. */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  testId,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}) {
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
      className="ui-modal tp-modal"
      aria-modal="true"
      data-testid={testId}
      aria-label={typeof title === 'string' ? title : undefined}
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
          <div className="ui-modal-body">{children}</div>
          {footer && <div className="ui-modal-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="ui-loading-stack" aria-busy="true">
      <span className="ui-skeleton ui-skeleton-title" />
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="ui-skeleton ui-skeleton-row" />
      ))}
    </div>
  );
}

/** Lista de casillas (miembros, equipos, iniciativas) para elegir varios. */
export function CheckList<T extends { id: string }>({
  items,
  selected,
  onChange,
  label,
  render,
  name,
}: {
  items: T[];
  selected: string[];
  onChange: (ids: string[]) => void;
  label: string;
  render: (item: T) => ReactNode;
  name: string;
}) {
  return (
    <fieldset className="tp-checklist">
      <legend className="sr-only">{label}</legend>
      {items.map((it) => {
        const on = selected.includes(it.id);
        return (
          <label key={it.id} className="ui-check tp-check">
            <input
              type="checkbox"
              name={name}
              checked={on}
              onChange={() => onChange(on ? selected.filter((s) => s !== it.id) : [...selected, it.id])}
            />
            <span>{render(it)}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** Copiar al portapapeles con fallback silencioso. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadFile(filename: string, content: string, type = 'text/csv') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
