'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import { isCompletedCategory } from '@/lib/track-tasks';
import { AssigneeMenu, PriorityMenu, StatusMenu } from './InlineEditors';
import TrackIcon from './TrackIcon';
import { isPendingIssue, type IssueStore, type ProjectContext } from './useIssueStore';
import type { TrackUiLabels } from './ui-labels';

import { ProgressRing } from './ProgressRing';

export { ProgressRing };

interface SubIssuesProps {
  parent: TrackIssueWithStatus;
  store: IssueStore;
  project: ProjectContext;
  ui: TrackUiLabels;
  /** Abre el composer desde afuera (⌘⇧O, ⌘K, menú "…"). */
  composerSignal: number;
  /** Crea un sub-issue con el título (hereda prioridad, cycle y milestone). */
  onCreate: (title: string) => Promise<void>;
  /** "Agregar existente": la paleta con la búsqueda de issues. */
  onAddExisting: () => void;
}

/**
 * Sección "Sub-issues" del issue, como en Linear: progreso x/y, filas densas
 * con estado, prioridad y asignado editables en el lugar, arrastrar (o
 * Alt+↑/↓) para ordenar, y un composer en línea: Enter crea y queda listo
 * para el siguiente, pegar varias líneas crea varios, Esc sale.
 */
export default function SubIssues({ parent, store, project, ui, composerSignal, onCreate, onAddExisting }: SubIssuesProps) {
  const t = useTranslations('track.ux.sub');
  const children = store.issues;
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const done = children.filter((c) => isCompletedCategory(c.status_category)).length;

  useEffect(() => {
    if (composerSignal > 0) {
      setCollapsed(false);
      setComposing(true);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [composerSignal]);

  async function create(raw: string) {
    // Varias líneas pegadas: un sub-issue por línea (sin viñetas ni tareas).
    const titles = raw
      .split('\n')
      .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '').trim())
      .filter(Boolean)
      .slice(0, 50);
    for (const tt of titles) await onCreate(tt);
  }

  function reorder(fromId: string, toId: string) {
    if (fromId === toId) return;
    const ids = children.map((c) => c.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    const order = new Map(ids.map((id, i) => [id, (i + 1) * 1024]));
    // Orden optimista inmediato; cada fila guarda su sub_order (un solo ⌘Z).
    store.setIssues((list) => [...list].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)));
    void store.updateMany(ids, (issue) => ({ subOrder: order.get(issue.id) ?? null }));
  }

  const openComposer = () => {
    setCollapsed(false);
    setComposing(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Sin sub-issues: solo el botón "+ Agregar sub-issues", como en Linear.
  if (children.length === 0 && !composing) {
    return (
      <div className="track-subissues-empty-row">
        <button
          type="button"
          className="track-subissues-empty"
          onClick={openComposer}
          title={`${t('add')} (⌘⇧O)`}
          aria-keyshortcuts="Meta+Shift+O Control+Shift+O"
          data-testid="track-add-subissue"
        >
          <TrackIcon name="plus" size={12} /> {t('addFirst')}
        </button>
        <button type="button" className="track-subissues-empty" onClick={onAddExisting} data-testid="track-add-existing-subissue">
          <TrackIcon name="parent" size={12} /> {t('addExisting')}
        </button>
      </div>
    );
  }

  return (
    <section className="track-subissues" aria-label={t('title')} data-testid="track-subissues">
      <div className="track-subissues-head">
        <button
          type="button"
          className="track-subissues-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
          disabled={children.length === 0}
        >
          <span className={`track-chevron${collapsed ? ' is-collapsed' : ''}`} aria-hidden>
            <TrackIcon name="chevronDown" size={12} />
          </span>
          {t('title')}
        </button>
        {children.length > 0 && (
          <span className="track-subissues-progress" data-testid="track-subissues-progress">
            <ProgressRing done={done} total={children.length} />
            {done}/{children.length}
          </span>
        )}
        <span className="track-subissues-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={onAddExisting}
            aria-label={t('addExisting')}
            title={t('addExisting')}
            data-testid="track-add-existing-subissue"
          >
            <TrackIcon name="parent" size={14} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={openComposer}
            aria-label={t('add')}
            title={`${t('add')} (⌘⇧O)`}
            aria-keyshortcuts="Meta+Shift+O Control+Shift+O"
            data-testid="track-add-subissue"
          >
            <TrackIcon name="plus" size={14} />
          </button>
        </span>
      </div>

      {!collapsed && (
        <ul className="track-subtask-list" role="list">
          {children.map((child, index) => {
            const pending = isPendingIssue(child);
            return (
              <li
                key={child.id}
                className={[
                  'track-subtask-row',
                  dragId === child.id ? 'is-dragging' : '',
                  overId === child.id && dragId !== child.id ? 'is-over' : '',
                  isCompletedCategory(child.status_category) ? 'is-completed' : '',
                  pending ? 'is-pending' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-issue-key={pending ? undefined : child.id}
                data-issue-row={pending ? undefined : ''}
                data-href={pending ? undefined : `/app/track/issues/${child.id}`}
                draggable={!pending}
                tabIndex={-1}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', child.identifier);
                  e.dataTransfer.effectAllowed = 'move';
                  setDragId(child.id);
                }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  setOverId(child.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId) reorder(dragId, child.id);
                  setDragId(null);
                  setOverId(null);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                onKeyDown={(e) => {
                  // Alt+↑/↓ mueve la fila (alternativa de teclado al arrastre).
                  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                  const target = children[index + (e.key === 'ArrowUp' ? -1 : 1)];
                  if (!target) return;
                  e.preventDefault();
                  reorder(child.id, target.id);
                }}
              >
                <span className="track-subtask-grip" aria-hidden>
                  <TrackIcon name="grip" size={12} />
                </span>
                <PriorityMenu
                  compact
                  priority={child.priority}
                  priorities={ui.priorities}
                  disabled={pending}
                  label={ui.inline.priority}
                  onChange={(priority) => void store.update(child.id, { priority })}
                />
                <span className="track-identifier track-subtask-id">{child.identifier}</span>
                <StatusMenu
                  glyphOnly
                  statusId={child.status_id}
                  statusName={child.status_name}
                  statusColor={child.status_color}
                  statusCategory={child.status_category}
                  statuses={project.statuses}
                  disabled={pending}
                  label={ui.inline.status}
                  onChange={(statusId) => void store.update(child.id, { statusId })}
                />
                {pending ? (
                  <span className="track-subtask-title">{child.title}</span>
                ) : (
                  <Link
                    href={`/app/track/issues/${child.id}`}
                    className="track-subtask-title"
                    draggable={false}
                    onKeyDown={(e) => {
                      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) e.preventDefault();
                    }}
                  >
                    {child.title || '–'}
                  </Link>
                )}
                {child.child_count > 0 && (
                  <span className="track-subtask-indicator" title={t('nested', { done: child.child_done ?? 0, total: child.child_count })}>
                    <ProgressRing done={child.child_done ?? 0} total={child.child_count} size={12} />
                    {child.child_done ?? 0}/{child.child_count}
                  </span>
                )}
                <AssigneeMenu
                  compact
                  assigneeId={child.assignee_id}
                  assigneeName={child.assignee_name}
                  assigneeEmail={child.assignee_email}
                  members={project.members}
                  disabled={pending}
                  label={ui.inline.assignee}
                  noAssignee={ui.inline.assignee}
                  onChange={(assigneeId) => void store.update(child.id, { assigneeId })}
                />
              </li>
            );
          })}
          {composing && (
            <li className="track-subtask-row is-composer">
              <span className="track-subtask-grip" aria-hidden />
              <TrackIcon name="subtasks" size={14} />
              <input
                ref={inputRef}
                className="track-subtask-input"
                value={title}
                placeholder={t('placeholder')}
                aria-label={t('placeholder')}
                maxLength={500}
                onChange={(e) => setTitle(e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text');
                  if (!text.includes('\n')) return;
                  e.preventDefault();
                  setTitle('');
                  void create(text);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    const value = title.trim();
                    if (!value) return;
                    setTitle('');
                    void create(value);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setComposing(false);
                    setTitle('');
                  }
                }}
                onBlur={() => {
                  if (!title.trim()) setComposing(false);
                }}
                data-testid="track-subissue-input"
              />
              <span className="track-subtask-hint">{t('hint')}</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
