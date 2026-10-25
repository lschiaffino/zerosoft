'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { openCommandMenu } from '@/lib/cmdk-context';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import { isCompletedCategory, PRIORITIES } from '@/lib/track-tasks';
import { Popover, PriorityIcon, StatusDot } from './InlineEditors';
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
  /** Sin sub-issues no se muestra nada (el "+ Add sub-issues" vive en la barra del issue). */
  hideEmpty?: boolean;
}

type SubOrder = 'manual' | 'priority' | 'status' | 'created';
interface SubDisplay {
  priority: boolean;
  assignee: boolean;
  hideCompleted: boolean;
  order: SubOrder;
}
const DISPLAY_KEY = 'track:subissues-display';
const DEFAULT_DISPLAY: SubDisplay = { priority: true, assignee: true, hideCompleted: false, order: 'manual' };
const CATEGORY_ORDER = ['in_progress', 'todo', 'backlog', 'done', 'cancelled'];

function readDisplay(): SubDisplay {
  try {
    const raw = window.localStorage.getItem(DISPLAY_KEY);
    return raw ? { ...DEFAULT_DISPLAY, ...(JSON.parse(raw) as Partial<SubDisplay>) } : DEFAULT_DISPLAY;
  } catch {
    return DEFAULT_DISPLAY;
  }
}

function initial(name: string | null | undefined): string {
  return (name ?? '?').trim().charAt(0).toUpperCase() || '?';
}

/**
 * Sección "Sub-issues" del issue, como en Linear: anillo de progreso x/y,
 * filas densas estado → ID → título → asignado (el ID con ancho fijo), cada
 * valor abre el mismo menú que su atajo, un menú "…" por fila (abrir, elegir
 * otro padre, sacar del padre) y opciones de la sección (propiedades visibles,
 * ocultar completados y orden). Arrastrar (o Alt+↑/↓) ordena; el composer en
 * línea crea con Enter y queda listo para el siguiente, pegar varias líneas
 * crea varios, Esc sale.
 */
export default function SubIssues({ parent, store, project, ui, composerSignal, onCreate, onAddExisting, hideEmpty = false }: SubIssuesProps) {
  const t = useTranslations('track.ux.sub');
  const tc = useTranslations('track.ux.cmd');
  const children = store.issues;
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [display, setDisplayState] = useState<SubDisplay>(DEFAULT_DISPLAY);
  const inputRef = useRef<HTMLInputElement>(null);
  const done = children.filter((c) => isCompletedCategory(c.status_category)).length;

  useEffect(() => {
    setDisplayState(readDisplay());
  }, []);
  const setDisplay = (patch: Partial<SubDisplay>) => {
    setDisplayState((cur) => {
      const next = { ...cur, ...patch };
      try {
        window.localStorage.setItem(DISPLAY_KEY, JSON.stringify(next));
      } catch {
        // Sin storage: vale para esta visita.
      }
      return next;
    });
  };

  useEffect(() => {
    if (composerSignal > 0) {
      setCollapsed(false);
      setComposing(true);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [composerSignal]);

  const rows = useMemo(() => {
    let list = display.hideCompleted ? children.filter((c) => !isCompletedCategory(c.status_category)) : children;
    if (display.order === 'priority') list = [...list].sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority));
    else if (display.order === 'status')
      list = [...list].sort((a, b) => CATEGORY_ORDER.indexOf(a.status_category ?? '') - CATEGORY_ORDER.indexOf(b.status_category ?? ''));
    else if (display.order === 'created') list = [...list].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    return list;
  }, [children, display.hideCompleted, display.order]);
  const manual = display.order === 'manual';

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
    if (fromId === toId || !manual) return;
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

  const pick = (page: string, child: TrackIssueWithStatus) => (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    openCommandMenu(page, { anchor: e.currentTarget, targetId: child.id });
  };

  // Sin sub-issues: nada (la página muestra "+ Add sub-issues"), o el botón suelto.
  if (children.length === 0 && !composing) {
    if (hideEmpty) return null;
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
          <span className="track-subissues-progress" data-testid="track-subissues-progress" title={t('nested', { done, total: children.length })}>
            <ProgressRing done={done} total={children.length} />
            <span className="data">
              {done}/{children.length}
            </span>
          </span>
        )}
        <span className="track-subissues-actions">
          <Popover
            ariaLabel={t('options')}
            className="btn btn-ghost btn-sm btn-icon"
            width={240}
            trigger={<TrackIcon name="settings" size={14} />}
          >
            {() => (
              <div className="track-sub-options" data-testid="track-subissues-options">
                <p className="track-menu-heading">{t('showProps')}</p>
                {(['priority', 'assignee'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={display[k]}
                    className="track-menu-item"
                    onClick={() => setDisplay({ [k]: !display[k] })}
                  >
                    <span className="track-menu-label">{t(`prop.${k}`)}</span>
                    {display[k] && <span className="track-menu-check" aria-hidden>✓</span>}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={display.hideCompleted}
                  className="track-menu-item"
                  onClick={() => setDisplay({ hideCompleted: !display.hideCompleted })}
                  data-testid="track-sub-hide-completed"
                >
                  <span className="track-menu-label">{t('hideCompleted')}</span>
                  {display.hideCompleted && <span className="track-menu-check" aria-hidden>✓</span>}
                </button>
                <div className="track-menu-sep" role="separator" />
                <p className="track-menu-heading">{t('orderBy')}</p>
                {(['manual', 'priority', 'status', 'created'] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    role="menuitemradio"
                    aria-checked={display.order === o}
                    className="track-menu-item"
                    onClick={() => setDisplay({ order: o })}
                  >
                    <span className="track-menu-label">{t(`order.${o}`)}</span>
                    {display.order === o && <span className="track-menu-check" aria-hidden>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </Popover>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={openComposer}
            aria-label={t('add')}
            title={`${t('add')} (⌘⇧O)`}
            aria-keyshortcuts="Meta+Shift+O Control+Shift+O"
            data-testid="track-add-subissue-head"
          >
            <TrackIcon name="plus" size={14} />
          </button>
        </span>
      </div>

      {!collapsed && (
        <ul
          className="track-subtask-list"
          role="list"
          // El ID tiene el ancho del más largo (MOBILE-APP-12 entra entero, como en Linear).
          style={{ '--sub-id-ch': Math.max(6, ...children.map((c) => c.identifier.length)) } as React.CSSProperties}
        >
          {rows.map((child, index) => {
            const pending = isPendingIssue(child);
            const prioLabel = ui.priorities.find((p) => p.value === child.priority)?.label ?? child.priority;
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
                draggable={!pending && manual}
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
                  const target = rows[index + (e.key === 'ArrowUp' ? -1 : 1)];
                  if (!target) return;
                  e.preventDefault();
                  reorder(child.id, target.id);
                }}
              >
                <span className="track-subtask-grip" aria-hidden>
                  {manual && <TrackIcon name="grip" size={12} />}
                </span>
                <button
                  type="button"
                  className="track-subtask-status"
                  disabled={pending}
                  aria-label={`${ui.inline.status}: ${child.status_name ?? '–'}`}
                  title={`${child.status_name ?? ''} · S`}
                  onClick={pick('status', child)}
                >
                  <StatusDot color={child.status_color} category={child.status_category} />
                </button>
                <span className="track-identifier track-subtask-id">{child.identifier}</span>
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
                {display.priority && child.priority !== 'none' && (
                  <button
                    type="button"
                    className="track-subtask-prop"
                    disabled={pending}
                    aria-label={`${ui.inline.priority}: ${prioLabel}`}
                    title={`${prioLabel} · P`}
                    onClick={pick('priority', child)}
                  >
                    <PriorityIcon priority={child.priority} />
                  </button>
                )}
                {display.assignee && (
                  <button
                    type="button"
                    className={`track-subtask-prop${child.assignee_id ? '' : ' is-unassigned'}`}
                    disabled={pending}
                    aria-label={`${ui.inline.assignee}: ${child.assignee_id ? (child.assignee_name || child.assignee_email) : ui.noAssignee}`}
                    title={`${child.assignee_id ? (child.assignee_name || child.assignee_email) : ui.noAssignee} · A`}
                    onClick={pick('assignee', child)}
                  >
                    {child.assignee_id ? (
                      <span className="track-avatar is-small">{initial(child.assignee_name || child.assignee_email)}</span>
                    ) : (
                      <span className="track-avatar is-small track-avatar-empty" />
                    )}
                  </button>
                )}
                {!pending && (
                  <Popover ariaLabel={t('rowMenu', { id: child.identifier })} className="track-subtask-more" width={220} trigger={<TrackIcon name="more" size={14} />}>
                    {(close) => (
                      <>
                        <Link href={`/app/track/issues/${child.id}`} role="menuitem" className="track-menu-item" data-autofocus onClick={() => close()}>
                          <span className="track-menu-label">{tc('open')}</span>
                        </Link>
                        <button
                          type="button"
                          role="menuitem"
                          className="track-menu-item"
                          onClick={() => {
                            close();
                            window.setTimeout(() => openCommandMenu('parent', { targetId: child.id }), 0);
                          }}
                        >
                          <span className="track-menu-label">{tc('setParent')}</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="track-menu-item"
                          data-testid="track-sub-remove"
                          onClick={() => {
                            close();
                            void store.update(child.id, { parentId: null }).then(() => store.setIssues((list) => list.filter((c) => c.id !== child.id)));
                          }}
                        >
                          <span className="track-menu-label">{t('removeFromParent', { id: parent.identifier })}</span>
                        </button>
                      </>
                    )}
                  </Popover>
                )}
              </li>
            );
          })}
          {composing && (
            <li className="track-subtask-row is-composer">
              <span className="track-subtask-grip" aria-hidden />
              <span className="track-subtask-status" aria-hidden>
                <StatusDot color={null} category="todo" />
              </span>
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
      {!collapsed && display.hideCompleted && rows.length < children.length && (
        <button type="button" className="track-sub-hidden" onClick={() => setDisplay({ hideCompleted: false })}>
          {t('hiddenCompleted', { count: children.length - rows.length })}
        </button>
      )}
    </section>
  );
}
