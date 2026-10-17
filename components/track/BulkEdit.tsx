'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TrackStatusRow } from '@/lib/db';
import type { ProjectMember } from '@/lib/track-data';
import type { WorkspaceLabel } from './LabelPicker';

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || typeof node.closest !== 'function') return false;
  return node.isContentEditable || Boolean(node.closest('input, textarea, select, [contenteditable="true"], dialog, [role="dialog"]'));
}

export interface IssueSelection {
  selected: Set<string>;
  /** Click en el checkbox; con shift selecciona el rango desde el último. */
  toggle: (id: string, shift?: boolean) => void;
  toggleAll: () => void;
  clear: () => void;
}

/**
 * Selección múltiple de issues: checkbox, shift+clic para rangos y X para
 * la fila activa (J/K) o la que está bajo el mouse. Escape limpia.
 */
export function useIssueSelection(orderedIds: string[]): IssueSelection {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const idsRef = useRef(orderedIds);
  idsRef.current = orderedIds;

  // Los ids que ya no están en la lista salen de la selección.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(orderedIds);
      const next = new Set(Array.from(prev).filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [orderedIds]);

  const toggle = useCallback((id: string, shift = false) => {
    // El updater corre después: capturamos el ancla antes de moverla.
    const from0 = anchor.current;
    const ids = idsRef.current;
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && from0 && from0 !== id && ids.includes(from0)) {
        const a = ids.indexOf(from0);
        const b = ids.indexOf(id);
        const [from, to] = a < b ? [a, b] : [b, a];
        const on = !prev.has(id) || prev.has(from0);
        for (const x of ids.slice(from, to + 1)) {
          if (on) next.add(x);
          else next.delete(x);
        }
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = id;
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => (prev.size === idsRef.current.length ? new Set() : new Set(idsRef.current)));
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === 'Escape') {
        setSelected((prev) => (prev.size ? new Set() : prev));
        return;
      }
      if (e.key.toLowerCase() !== 'x') return;
      const row =
        document.querySelector<HTMLElement>('[data-issue-id].is-kb-active') ??
        document.querySelector<HTMLElement>('[data-issue-id]:hover');
      const id = row?.dataset.issueId;
      if (!id) return;
      e.preventDefault();
      toggle(id, e.shiftKey);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { selected, toggle, toggleAll, clear };
}

export interface BulkPatch {
  statusId?: string;
  priority?: string;
  assigneeId?: string | null;
  cycleId?: string | null;
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

interface BulkBarProps {
  count: number;
  statuses: TrackStatusRow[];
  members: ProjectMember[];
  cycles: Array<{ id: string; name: string }>;
  labels: WorkspaceLabel[];
  priorities: Array<{ value: string; label: string }>;
  canDelete: boolean;
  onApply: (patch: BulkPatch) => Promise<void>;
  onDelete: () => Promise<void>;
  onClear: () => void;
}

/** Barra de acciones para los issues seleccionados. */
export function BulkBar({
  count,
  statuses,
  members,
  cycles,
  labels,
  priorities,
  canDelete,
  onApply,
  onDelete,
  onClear,
}: BulkBarProps) {
  const t = useTranslations('track');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (count === 0) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const select = (label: string, onPick: (v: string) => void, options: Array<{ value: string; label: string }>, testId: string) => (
    <select
      className="select track-bulk-select"
      value=""
      disabled={busy}
      aria-label={label}
      data-testid={testId}
      onChange={(e) => {
        const v = e.target.value;
        if (v) onPick(v);
      }}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  return (
    <div className="track-bulk-bar" role="toolbar" aria-label={t('bulk.selected', { count })} data-testid="track-bulk-bar">
      <span className="track-bulk-count">{t('bulk.selected', { count })}</span>
      {select(
        t('bulk.status'),
        (v) => void run(() => onApply({ statusId: v })),
        statuses.map((s) => ({ value: s.id, label: s.name })),
        'track-bulk-status',
      )}
      {select(t('bulk.priority'), (v) => void run(() => onApply({ priority: v })), priorities, 'track-bulk-priority')}
      {select(
        t('bulk.assignee'),
        (v) => void run(() => onApply({ assigneeId: v === '__none' ? null : v })),
        [{ value: '__none', label: t('bulk.unassign') }, ...members.map((m) => ({ value: m.id, label: m.name ?? m.email }))],
        'track-bulk-assignee',
      )}
      {labels.length > 0 &&
        select(
          t('bulk.labels'),
          (v) =>
            void run(() =>
              onApply(v.startsWith('-') ? { removeLabelIds: [v.slice(1)] } : { addLabelIds: [v.slice(1)] }),
            ),
          [
            ...labels.map((l) => ({ value: `+${l.id}`, label: t('bulk.addLabel', { name: l.name }) })),
            ...labels.map((l) => ({ value: `-${l.id}`, label: t('bulk.removeLabel', { name: l.name }) })),
          ],
          'track-bulk-labels',
        )}
      {cycles.length > 0 &&
        select(
          t('bulk.cycle'),
          (v) => void run(() => onApply({ cycleId: v === '__none' ? null : v })),
          [{ value: '__none', label: t('bulk.noCycle') }, ...cycles.map((c) => ({ value: c.id, label: c.name }))],
          'track-bulk-cycle',
        )}
      {canDelete &&
        (confirming ? (
          <span className="track-bulk-confirm">
            <span>{t('bulk.confirmDelete', { count })}</span>
            <button
              type="button"
              className="btn btn-sm btn-primary btn-danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await onDelete();
                  setConfirming(false);
                })
              }
            >
              {t('bulk.delete')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => setConfirming(true)}>
            {t('bulk.delete')}
          </button>
        ))}
      <button type="button" className="btn btn-ghost btn-sm track-bulk-clear" onClick={onClear} aria-keyshortcuts="Escape">
        {t('bulk.clear')}
        <kbd className="kbd track-kbd" aria-hidden>
          Esc
        </kbd>
      </button>
    </div>
  );
}
