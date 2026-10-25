'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { activeRowElement } from './kbCursor';
import { useTranslations } from 'next-intl';
import type { TrackStatusRow } from '@/lib/db';
import type { ProjectMember } from '@/lib/track-data';
import type { WorkspaceLabel } from './LabelPicker';
import { openCommandMenu } from '@/lib/cmdk-context';
import { isTypingTarget as isTextTarget } from './trackCommands';

// Casillas y botones no cuentan como tipeo: X sigue andando después de un clic.
function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (isTextTarget(el)) return true;
  return Boolean(node && typeof node.closest === 'function' && node.closest('dialog, [role="dialog"]'));
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
      // Con la paleta o un menú abiertos, Esc los cierra a ellos (no la selección).
      if (document.querySelector('.cmdk, [role="menu"]')) return;
      if (e.key === 'Escape') {
        setSelected((prev) => (prev.size ? new Set() : prev));
        return;
      }
      if (e.key.toLowerCase() !== 'x') return;
      const kb = activeRowElement();
      const row =
        (kb?.dataset.issueId ? kb : null) ??
        document.querySelector<HTMLElement>('[data-issue-id].is-kb-active') ??
        document.querySelector<HTMLElement>('[data-issue-id]:hover');
      const id = row?.dataset.issueId ?? kb?.dataset.issueKey;
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

/**
 * Barra de acciones para los issues seleccionados, como la de Linear: cada
 * acción abre la misma página de ⌘K que su atajo (estado, prioridad,
 * asignado, labels, project, cycle, padre, mover de team), con filtro tipeado.
 * ⌘⌫ borra (con Deshacer) desde la paleta; acá queda el botón con confirmación.
 */
export function BulkBar({ count, cycles, canDelete, onDelete, onClear }: BulkBarProps) {
  const t = useTranslations('track');
  const tb = useTranslations('track.ux.bulk');
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

  const action = (page: string, label: string, shortcut: string, testId: string) => (
    <button
      type="button"
      className="btn btn-ghost btn-sm track-bulk-action"
      disabled={busy}
      onClick={() => openCommandMenu(page)}
      aria-keyshortcuts={shortcut.replace('⇧', 'Shift+').replace('⌘', 'Meta+')}
      data-testid={testId}
    >
      {label}
      <kbd className="kbd track-kbd" aria-hidden>
        {shortcut}
      </kbd>
    </button>
  );

  return (
    <div className="track-bulk-bar" role="toolbar" aria-label={t('bulk.selected', { count })} data-testid="track-bulk-bar">
      <span className="track-bulk-count">{t('bulk.selected', { count })}</span>
      {action('status', tb('status'), 'S', 'track-bulk-status')}
      {action('priority', tb('priority'), 'P', 'track-bulk-priority')}
      {action('assignee', tb('assignee'), 'A', 'track-bulk-assignee')}
      {action('labels', tb('labels'), 'L', 'track-bulk-labels')}
      {action('project', tb('project'), '⇧P', 'track-bulk-project')}
      {cycles.length > 0 && action('cycle', tb('cycle'), '⇧C', 'track-bulk-cycle')}
      {action('parent', tb('parent'), '⌘⇧P', 'track-bulk-parent')}
      {action('move-team', tb('move'), '⌘⇧M', 'track-bulk-move')}
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
          <button type="button" className="btn btn-sm btn-ghost btn-danger" disabled={busy} onClick={() => setConfirming(true)}>
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
