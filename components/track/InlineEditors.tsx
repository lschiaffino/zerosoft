'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { TrackStatusRow } from '@/lib/db';
import type { ProjectMember } from '@/lib/track-data';
import { addDays, formatDay, isCompletedCategory, toIsoDay, type IssuePriority } from '@/lib/track-tasks';
import type { TrackUiLabels } from './ui-labels';

// ---------- Visuales chicos ----------

export function priorityColor(priority: string): string {
  return priority === 'urgent'
    ? 'var(--bad)'
    : priority === 'high'
      ? 'var(--c-track)'
      : priority === 'medium'
        ? 'var(--warn)'
        : '#bbbbbb';
}

/** Barras de prioridad estilo Linear (1–4 barras llenas). */
export function PriorityIcon({ priority }: { priority: string }) {
  const level = priority === 'urgent' ? 4 : priority === 'high' ? 3 : priority === 'medium' ? 2 : 1;
  const color = priorityColor(priority);
  return (
    <span className="track-prio-icon" aria-hidden>
      {[1, 2, 3, 4].map((n) => (
        <span key={n} style={{ height: 3 + n * 2, background: n <= level ? color : 'var(--line)' }} />
      ))}
    </span>
  );
}

export function StatusDot({ color, category }: { color: string | null; category: string | null }) {
  const c = color || '#999999';
  const done = category === 'done';
  const cancelled = category === 'cancelled';
  const progress = category === 'in_progress';
  return (
    <span
      className={`track-status-dot${done ? ' is-done' : ''}${cancelled ? ' is-cancelled' : ''}${progress ? ' is-progress' : ''}`}
      style={{ '--dot': c } as CSSProperties}
      aria-hidden
    />
  );
}

function initials(name: string | null | undefined, email?: string | null): string {
  const src = (name || email || '?').trim();
  return src[0]?.toUpperCase() ?? '?';
}

// ---------- Checkbox de "hecho" ----------

export function DoneCheckbox({
  category,
  disabled,
  onToggle,
  labels,
}: {
  category: string | null;
  disabled?: boolean;
  onToggle: () => void;
  labels: TrackUiLabels['inline'];
}) {
  const checked = isCompletedCategory(category);
  const cancelled = category === 'cancelled';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? labels.markOpen : labels.markDone}
      title={checked ? labels.markOpen : labels.markDone}
      className={`track-check${checked ? ' is-checked' : ''}${cancelled ? ' is-cancelled' : ''}`}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
    >
      <svg viewBox="0 0 12 12" aria-hidden>
        {cancelled ? <path d="M3.5 3.5l5 5M8.5 3.5l-5 5" /> : <path d="M2.8 6.2l2.2 2.2 4.2-4.6" />}
      </svg>
    </button>
  );
}

// ---------- Popover base ----------

interface PopoverProps {
  trigger: ReactNode;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  children: (close: () => void) => ReactNode;
  width?: number;
}

/**
 * Menú flotante anclado al trigger con `position: fixed` (para no quedar
 * recortado por contenedores con overflow). Cierra con Esc, click afuera,
 * scroll o resize, y devuelve el foco al trigger.
 */
export function Popover({ trigger, ariaLabel, disabled, className, children, width = 220 }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setStyle(
      spaceBelow < 300 && r.top > spaceBelow
        ? { position: 'fixed', left, bottom: window.innerHeight - r.top + 4, width }
        : { position: 'fixed', left, top: r.bottom + 4, width },
    );
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[data-autofocus], [role="menuitemradio"][aria-checked="true"], [role="menuitemradio"], input');
    first?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      close(false);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement as HTMLElement);
    let next = 0;
    if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % items.length;
    else if (e.key === 'ArrowUp') next = idx <= 0 ? items.length - 1 : idx - 1;
    else if (e.key === 'End') next = items.length - 1;
    items[next]?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`track-inline-trigger${className ? ` ${className}` : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        disabled={disabled}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={menuRef}
          className="track-menu"
          role="menu"
          aria-label={ariaLabel}
          style={style}
          onKeyDown={onMenuKeyDown}
          onClick={(e) => e.stopPropagation()}
        >
          {children(() => close())}
        </div>
      )}
    </>
  );
}

interface MenuOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

function OptionList({
  options,
  value,
  onSelect,
}: {
  options: MenuOption[];
  value: string;
  onSelect: (value: string) => void;
}) {
  return (
    <>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="menuitemradio"
          aria-checked={o.value === value}
          className={`track-menu-item${o.value === value ? ' is-active' : ''}`}
          onClick={() => onSelect(o.value)}
        >
          {o.icon}
          <span className="track-menu-label">{o.label}</span>
          {o.value === value && (
            <span className="track-menu-check" aria-hidden>
              ✓
            </span>
          )}
        </button>
      ))}
    </>
  );
}

// ---------- Editores ----------

export function StatusMenu({
  statusId,
  statusName,
  statusColor,
  statusCategory,
  statuses,
  onChange,
  disabled,
  label,
  compact,
}: {
  statusId: string | null;
  statusName: string | null;
  statusColor: string | null;
  statusCategory: string | null;
  statuses: TrackStatusRow[];
  onChange: (statusId: string) => void;
  disabled?: boolean;
  label: string;
  compact?: boolean;
}) {
  return (
    <Popover
      ariaLabel={`${label}: ${statusName ?? '—'}`}
      disabled={disabled || statuses.length === 0}
      trigger={
        <>
          <StatusDot color={statusColor} category={statusCategory} />
          {!compact && <span className="track-inline-text">{statusName ?? '—'}</span>}
        </>
      }
    >
      {(close) => (
        <OptionList
          value={statusId ?? ''}
          options={statuses.map((s) => ({
            value: s.id,
            label: s.name,
            icon: <StatusDot color={s.color} category={s.category} />,
          }))}
          onSelect={(v) => {
            close();
            if (v !== statusId) onChange(v);
          }}
        />
      )}
    </Popover>
  );
}

export function PriorityMenu({
  priority,
  priorities,
  onChange,
  disabled,
  label,
  compact,
}: {
  priority: IssuePriority;
  priorities: TrackUiLabels['priorities'];
  onChange: (priority: IssuePriority) => void;
  disabled?: boolean;
  label: string;
  compact?: boolean;
}) {
  const current = priorities.find((p) => p.value === priority)?.label ?? priority;
  return (
    <Popover
      ariaLabel={`${label}: ${current}`}
      disabled={disabled}
      width={180}
      trigger={
        <>
          <PriorityIcon priority={priority} />
          {!compact && <span className="track-inline-text">{current}</span>}
        </>
      }
    >
      {(close) => (
        <OptionList
          value={priority}
          options={priorities.map((p) => ({ value: p.value, label: p.label, icon: <PriorityIcon priority={p.value} /> }))}
          onSelect={(v) => {
            close();
            if (v !== priority) onChange(v as IssuePriority);
          }}
        />
      )}
    </Popover>
  );
}

export function AssigneeMenu({
  assigneeId,
  assigneeName,
  assigneeEmail,
  members,
  onChange,
  disabled,
  label,
  noAssignee,
  compact,
}: {
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  members: ProjectMember[];
  onChange: (assigneeId: string | null) => void;
  disabled?: boolean;
  label: string;
  noAssignee: string;
  compact?: boolean;
}) {
  const display = assigneeId ? assigneeName || assigneeEmail || '—' : noAssignee;
  return (
    <Popover
      ariaLabel={`${label}: ${display}`}
      disabled={disabled}
      width={240}
      trigger={
        <>
          {assigneeId ? (
            <span className="track-avatar">{initials(assigneeName, assigneeEmail)}</span>
          ) : (
            <span className="track-avatar track-avatar-empty" aria-hidden />
          )}
          {!compact && <span className={`track-inline-text${assigneeId ? '' : ' is-dim'}`}>{display}</span>}
        </>
      }
    >
      {(close) => (
        <OptionList
          value={assigneeId ?? ''}
          options={[
            { value: '', label: noAssignee, icon: <span className="track-avatar track-avatar-empty" aria-hidden /> },
            ...members.map((m) => ({
              value: m.id,
              label: m.name || m.email,
              icon: <span className="track-avatar">{initials(m.name, m.email)}</span>,
            })),
          ]}
          onSelect={(v) => {
            close();
            const next = v || null;
            if (next !== assigneeId) onChange(next);
          }}
        />
      )}
    </Popover>
  );
}

export function DueDateMenu({
  dueDate,
  locale,
  onChange,
  disabled,
  labels,
  today,
}: {
  dueDate: string | null;
  locale: string;
  onChange: (dueDate: string | null) => void;
  disabled?: boolean;
  labels: TrackUiLabels['inline'];
  today: string;
}) {
  const day = dueDate ? dueDate.slice(0, 10) : null;
  const overdue = day !== null && day < today;
  const isToday = day === today;
  const display = day ? (isToday ? labels.today : formatDay(day, locale, today)) : labels.noDate;
  const set = (v: string | null, close: () => void) => {
    close();
    if (v !== day) onChange(v);
  };
  return (
    <Popover
      ariaLabel={`${labels.dueDate}: ${display}`}
      disabled={disabled}
      width={220}
      className={overdue ? 'is-overdue' : isToday ? 'is-today' : undefined}
      trigger={
        <>
          <svg className="track-inline-cal" viewBox="0 0 16 16" aria-hidden>
            <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
            <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
          </svg>
          <span className={`track-inline-text${day ? '' : ' is-dim'}`}>{display}</span>
        </>
      }
    >
      {(close) => (
        <>
          <button type="button" role="menuitem" className="track-menu-item" onClick={() => set(today, close)}>
            <span className="track-menu-label">{labels.today}</span>
            <span className="track-menu-meta">{formatDay(today, locale, today)}</span>
          </button>
          <button type="button" role="menuitem" className="track-menu-item" onClick={() => set(addDays(today, 1), close)}>
            <span className="track-menu-label">{labels.tomorrow}</span>
            <span className="track-menu-meta">{formatDay(addDays(today, 1), locale, today)}</span>
          </button>
          <button type="button" role="menuitem" className="track-menu-item" onClick={() => set(addDays(today, 7), close)}>
            <span className="track-menu-label">{labels.nextWeek}</span>
            <span className="track-menu-meta">{formatDay(addDays(today, 7), locale, today)}</span>
          </button>
          <div className="track-menu-sep" />
          <label className="track-menu-date">
            <span>{labels.pickDate}</span>
            <input
              type="date"
              defaultValue={day ?? ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const v = (e.target as HTMLInputElement).value;
                  set(v || null, close);
                }
              }}
              onChange={(e) => {
                // Los pickers nativos disparan change al elegir: aplicar directo.
                const v = e.target.value;
                if (/^\d{4}-\d{2}-\d{2}$/.test(v)) set(v, close);
              }}
            />
          </label>
          {day && (
            <>
              <div className="track-menu-sep" />
              <button type="button" role="menuitem" className="track-menu-item" onClick={() => set(null, close)}>
                <span className="track-menu-label">{labels.clear}</span>
              </button>
            </>
          )}
        </>
      )}
    </Popover>
  );
}

// ---------- Quick-add inline ----------

/**
 * "+ New task": botón que se convierte en input. Enter crea (sin esperar a la
 * API) y deja el foco para la siguiente; Esc cancela.
 */
export function QuickAdd({
  labels,
  onCreate,
  projects,
  defaultProjectId,
  variant = 'row',
}: {
  labels: TrackUiLabels['quick'];
  onCreate: (title: string, projectId: string) => void;
  projects?: Array<{ id: string; name: string }>;
  defaultProjectId?: string;
  variant?: 'row' | 'card';
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects?.[0]?.id ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = () => {
    const title = value.trim();
    if (!title || (projects && projects.length > 0 && !projectId)) return;
    onCreate(title, projectId);
    setValue('');
    inputRef.current?.focus();
  };

  if (!open) {
    return (
      <button type="button" className={`track-quick-add-btn track-quick-add-${variant}`} onClick={() => setOpen(true)}>
        <span aria-hidden>+</span> {labels.newTask}
      </button>
    );
  }

  return (
    <div
      ref={wrapRef}
      className={`track-quick-add track-quick-add-${variant}`}
      onBlur={(e) => {
        if (wrapRef.current?.contains(e.relatedTarget as Node)) return;
        if (!value.trim()) setOpen(false);
      }}
    >
      {projects && projects.length > 1 && (
        <select
          className="track-quick-add-project"
          aria-label={labels.project}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        aria-label={labels.newTask}
        placeholder={labels.placeholder}
        maxLength={500}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setValue('');
            setOpen(false);
          }
        }}
      />
      <span className="track-quick-add-hint mono" aria-hidden>
        {labels.hint}
      </span>
    </div>
  );
}

/** Mensaje flotante para errores de guardado (con revert). */
export function TrackToast({ message, onDismiss, dismissLabel }: { message: string | null; onDismiss: () => void; dismissLabel: string }) {
  if (!message) return null;
  return (
    <div className="track-toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label={dismissLabel}>
        ×
      </button>
    </div>
  );
}

/** Hoy en la zona horaria del navegador (se recalcula al montar). */
export function useToday(initial?: string): string {
  const [today, setToday] = useState(() => initial ?? toIsoDay(new Date()));
  useEffect(() => {
    setToday(toIsoDay(new Date()));
  }, []);
  return today;
}
