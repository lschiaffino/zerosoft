'use client';

import LocalText from '@/components/ui/LocalText';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import type { TrackIssueActivityWithAuthor, TrackIssueWithStatus } from '@/lib/track-data';
import { formatDay, isCompletedCategory, toIsoDay, type IssuePriority } from '@/lib/track-tasks';
import { parseDbUtc, relDate } from '@/lib/utils';
import dynamic from 'next/dynamic';
import { PriorityIcon, StatusDot } from './InlineEditors';
import { ProgressRing } from './ProgressRing';
import TrackIcon from './TrackIcon';
import { projectCommand, rowTargetId, setPeekIssue, subscribePeek, type PeekState } from './trackCommands';
import IssueSidebar from './IssueSidebar';
import { describeActivity, EventGlyph, parseMeta, type ActivityEventLabels } from './activityText';
import { openCommandMenu, setCommandContext } from '@/lib/cmdk-context';

// El render de markdown (marked) se carga recién al abrir el peek.
const MarkdownView = dynamic(() => import('./MarkdownView').then((m) => m.MarkdownView));

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || typeof node.closest !== 'function') return false;
  return node.isContentEditable || Boolean(node.closest('input, textarea, select, [contenteditable="true"]'));
}

function descriptionText(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((b: { text?: string }) => b.text ?? '').join('\n') : raw;
  } catch {
    return raw;
  }
}

// Campos que la vista de abajo cambia (optimista y al guardar): la vista rápida los toma de ahí.
const LIVE_FIELDS = [
  'title',
  'status_id',
  'status_name',
  'status_color',
  'status_category',
  'priority',
  'assignee_id',
  'assignee_name',
  'assignee_email',
  'labels',
  'plan_id',
  'plan_name',
  'plan_milestone_id',
  'plan_milestone_name',
  'milestone_id',
  'milestone_name',
  'cycle_id',
  'cycle_name',
  'estimate',
  'due_date',
  'start_date',
  'updated_at',
] as const satisfies ReadonlyArray<keyof TrackIssueWithStatus>;

function withLive(base: TrackIssueWithStatus, live: TrackIssueWithStatus): TrackIssueWithStatus {
  const next = { ...base } as Record<string, unknown>;
  for (const k of LIVE_FIELDS) if (k in live) next[k] = live[k];
  return next as unknown as TrackIssueWithStatus;
}

const PRIORITY_KEYS: IssuePriority[] = ['urgent', 'high', 'medium', 'low', 'none'];
const EVENT_KEYS = [
  'created',
  'statusChange',
  'assigneeChange',
  'priorityChange',
  'cycleChange',
  'dueDateChange',
  'estimateChange',
  'titleChange',
  'descriptionChange',
  'relationAdded',
  'relationRemoved',
  'attachmentAdded',
  'subtaskAdded',
  'closed',
  'reopened',
  'unassigned',
] as const satisfies ReadonlyArray<keyof ActivityEventLabels>;

/** Entradas de actividad que entran en la vista rápida (las últimas). */
const RECENT_ACTIVITY = 6;

function parseLabels(raw: string): Array<{ id: string; name: string; color: string }> {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Vista rápida de un issue (Espacio sobre una fila), como el "peek" de
 * Linear: título, propiedades, descripción y sub-issues en un panel lateral
 * sin salir de la lista. Espacio o Esc la cierran; Enter abre el issue.
 *
 * Las propiedades se editan acá con los mismos chips y menús que el panel del
 * issue (IssueSidebar + ⌘K anclado), y el cambio lo aplica la vista de abajo
 * (useTrackCommands): la fila cambia al instante, vuelve atrás si falla y
 * entra en ⌘Z. Sin una vista dueña, las propiedades quedan como texto.
 */
export default function IssuePeek() {
  const t = useTranslations('track');
  const tx = useTranslations('track.ux.peek');
  const tc = useTranslations('track.ux.cmd');
  const ts = useTranslations('track.ux.side');
  const tt = useTranslations('track.ux.thread');
  const tprio = useTranslations('track.priorities');
  const router = useRouter();
  const pathname = usePathname();
  const [issueId, setIssueId] = useState<string | null>(null);
  const [issue, setIssue] = useState<TrackIssueWithStatus | null>(null);
  const [children, setChildren] = useState<TrackIssueWithStatus[]>([]);
  const [activity, setActivity] = useState<TrackIssueActivityWithAuthor[]>([]);
  const locale = useLocale();
  const [error, setError] = useState(false);
  const [hosted, setHosted] = useState<PeekState | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // La vista de abajo que tiene este issue lo edita y nos manda su fila al día.
  useEffect(() => subscribePeek(setHosted), []);
  useEffect(() => {
    setPeekIssue(issueId);
    return () => setPeekIssue(null);
  }, [issueId]);
  const live = hosted && issue && hosted.issue.id === issue.id ? hosted : null;
  const view = useMemo(() => (issue && live ? withLive(issue, live.issue) : issue), [issue, live]);

  const close = useCallback(() => {
    setIssueId(null);
    setIssue(null);
    setChildren([]);
    setActivity([]);
    opener.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTypingTarget(e.target)) return;
      if (issueId) {
        e.preventDefault();
        close();
        return;
      }
      if (document.querySelector('[role="dialog"], dialog[open], .cmdk, [role="menu"]')) return;
      const id = rowTargetId();
      if (!id) return;
      e.preventDefault();
      opener.current = document.activeElement as HTMLElement | null;
      setIssueId(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [issueId, close]);

  // Navegar cierra la vista rápida.
  useEffect(() => {
    setIssueId(null);
  }, [pathname]);

  useEffect(() => {
    if (!issueId) return;
    let alive = true;
    setError(false);
    setIssue(null);
    Promise.all([
      fetch(`/api/track/issues/${issueId}`).then((r) => (r.ok ? (r.json() as Promise<TrackIssueWithStatus>) : null)),
      fetch(`/api/track/issues/${issueId}/children`).then((r) =>
        r.ok ? (r.json() as Promise<{ rows: TrackIssueWithStatus[] }>) : { rows: [] },
      ),
      // Actividad reciente (los comentarios): no frena la vista si falla.
      fetch(`/api/track/issues/${issueId}/activities`)
        .then((r) => (r.ok ? (r.json() as Promise<{ rows: TrackIssueActivityWithAuthor[] }>) : { rows: [] }))
        .catch(() => ({ rows: [] as TrackIssueActivityWithAuthor[] })),
    ])
      .then(([i, c, a]) => {
        if (!alive) return;
        if (!i) setError(true);
        setIssue(i);
        setChildren(c.rows);
        setActivity(a.rows);
        window.setTimeout(() => panel.current?.focus(), 0);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [issueId]);

  // La fila de la vista dueña cambió (optimista y otra vez al guardar): la
  // actividad se vuelve a pedir un rato después y trae la entrada nueva.
  const liveRow = live?.issue ?? null;
  const seenRow = useRef<TrackIssueWithStatus | null>(null);
  useEffect(() => {
    if (!issueId || !liveRow) return;
    if (seenRow.current === null) {
      seenRow.current = liveRow;
      return;
    }
    if (seenRow.current === liveRow) return;
    seenRow.current = liveRow;
    let alive = true;
    const timer = window.setTimeout(() => {
      fetch(`/api/track/issues/${issueId}/activities`)
        .then((r) => (r.ok ? (r.json() as Promise<{ rows: TrackIssueActivityWithAuthor[] }>) : null))
        .then((a) => {
          if (alive && a) setActivity(a.rows);
        })
        .catch(() => null);
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [issueId, liveRow]);
  useEffect(() => {
    seenRow.current = null;
  }, [issueId]);

  // Sin vista dueña, ⌘K y ⇧P actúan sobre el issue de la vista rápida (solo Project).
  useEffect(() => {
    if (!issue || live) return;
    const apply = async (patch: { planId?: string | null }) => {
      const res = await fetch(`/api/track/issues/${issue.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).catch(() => null);
      if (res?.ok) setIssue((await res.json()) as TrackIssueWithStatus);
    };
    return setCommandContext(() => ({
      title: issue.identifier,
      actions: [projectCommand([issue], (p) => void apply(p), (k, v) => tc(k, v))],
    }));
  }, [issue, live, tc]);

  const eventLabels = useMemo(
    () => Object.fromEntries(EVENT_KEYS.map((k) => [k, t.raw(`activity.${k}`) as string])) as unknown as ActivityEventLabels,
    [t],
  );
  const priorities = useMemo(() => PRIORITY_KEYS.map((value) => ({ value, label: tprio(value) })), [tprio]);

  if (!issueId) return null;
  const done = children.filter((c) => isCompletedCategory(c.status_category)).length;
  const labels = view ? parseLabels(view.labels) : [];
  const today = toIsoDay(new Date());
  // Comentarios y cambios (estado, prioridad, asignado…) en orden, como el feed del issue.
  const entries = [...activity]
    .sort((a, b) => parseDbUtc(a.created_at).getTime() - parseDbUtc(b.created_at).getTime())
    .map((a) => {
      if (a.type !== 'comment') return { kind: 'event' as const, activity: a };
      let body = '';
      try {
        body = String((JSON.parse(a.meta) as { body?: string }).body ?? '');
      } catch {
        body = '';
      }
      return { kind: 'comment' as const, activity: a, who: a.user_name ?? a.user_email, body };
    })
    .filter((e) => e.kind === 'event' || e.body.trim());
  const recent = entries.slice(-RECENT_ACTIVITY);
  const members = live?.data.members ?? [];
  const eventText = (a: TrackIssueActivityWithAuthor) =>
    describeActivity(a, { labels: eventLabels, tt: (k, v) => tt(k, v), tp: (k) => tprio(k), locale, members });

  return (
    <div
      ref={panel}
      className="track-peek"
      role="dialog"
      aria-modal="false"
      aria-label={view ? `${view.identifier} ${view.title}` : tx('title')}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        } else if (e.key.toLowerCase() === 'p' && e.shiftKey && !e.metaKey && !e.ctrlKey && issue && !live && !isTypingTarget(e.target)) {
          e.preventDefault();
          openCommandMenu('project');
        } else if (
          e.key === 'Enter' &&
          issue &&
          !isTypingTarget(e.target) &&
          !(e.target as HTMLElement).closest('a, button, summary')
        ) {
          e.preventDefault();
          router.push(`/app/track/issues/${issue.id}`);
        }
      }}
      data-testid="track-peek"
      data-track-peek=""
    >
      <div className="track-peek-head">
        <span className="track-identifier">{view?.identifier ?? '…'}</span>
        <span className="track-peek-hint">{tx('hint')}</span>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={close} aria-label={tx('close')}>
          <TrackIcon name="close" size={14} />
        </button>
      </div>
      {error ? (
        <p className="ui-error" role="alert">
          {t('errors.generic')}
        </p>
      ) : !view ? (
        <div className="ui-loading-stack" aria-busy="true">
          <span className="ui-skeleton ui-skeleton-title" />
          <span className="ui-skeleton ui-skeleton-row" />
          <span className="ui-skeleton ui-skeleton-row" />
        </div>
      ) : (
        <div className="track-peek-body">
          {view.parent_identifier && (
            <p className="track-parent-line">
              <TrackIcon name="parent" size={12} />
              <span className="track-identifier">{view.parent_identifier}</span>
              <span className="track-parent-title">{view.parent_title}</span>
            </p>
          )}
          <h2 className="track-peek-title">{view.title || t('issues.untitled')}</h2>
          {live ? (
            <div className="track-peek-edit" data-testid="track-peek-props">
              <IssueSidebar
                issue={view}
                cycles={live.data.cycles}
                milestones={live.data.milestones}
                locale={locale}
                ui={{ priorities }}
                today={today}
                labels={{
                  status: t('issues.status'),
                  priority: t('issues.priority'),
                  assignee: t('issues.assignee'),
                  cycle: t('issues.cycle'),
                  estimate: t('issues.estimate'),
                  dueDate: t('issues.dueDate'),
                  labels: t('issues.labels'),
                  noAssignee: t('issues.noAssignee'),
                  none: t('issues.none'),
                  title: t('issues.detail.properties'),
                }}
                estimateScale={live.data.estimateScale}
              />
            </div>
          ) : (
            <dl className="track-peek-props" data-testid="track-peek-props">
              <div>
                <dt>{t('issues.status')}</dt>
                <dd>
                  <StatusDot color={view.status_color} category={view.status_category} /> {view.status_name ?? '–'}
                </dd>
              </div>
              <div>
                <dt>{t('issues.priority')}</dt>
                <dd>
                  <PriorityIcon priority={view.priority} /> {t(`priorities.${view.priority}`)}
                </dd>
              </div>
              <div>
                <dt>{t('issues.assignee')}</dt>
                <dd>{view.assignee_name ?? view.assignee_email ?? t('issues.noAssignee')}</dd>
              </div>
              {labels.length > 0 && (
                <div>
                  <dt>{t('issues.labels')}</dt>
                  <dd className="track-label-chips">
                    {labels.map((l) => (
                      <span key={l.id} className="track-label-tag">
                        <span className="track-label-tag-dot" style={{ background: l.color }} aria-hidden />
                        {l.name}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
              <div>
                <dt>{ts('plan')}</dt>
                <dd>
                  <button
                    type="button"
                    className={`track-inline-trigger${view.plan_id ? '' : ' is-dim'}`}
                    onClick={() => openCommandMenu('project')}
                    aria-keyshortcuts="Shift+P"
                    data-testid="track-peek-plan"
                  >
                    {view.plan_name ?? tc('noProject')}
                  </button>
                </dd>
              </div>
              {view.cycle_name && (
                <div>
                  <dt>{t('issues.cycle')}</dt>
                  <dd>
                    <TrackIcon name="cycle" size={12} /> {view.cycle_name}
                  </dd>
                </div>
              )}
              {view.estimate != null && (
                <div>
                  <dt>{t('issues.estimate')}</dt>
                  <dd>
                    <TrackIcon name="estimate" size={12} /> {view.estimate}
                  </dd>
                </div>
              )}
              {view.due_date && (
                <div>
                  <dt>{t('issues.dueDate')}</dt>
                  <dd className={view.due_date.slice(0, 10) < today && !isCompletedCategory(view.status_category) ? 'is-overdue' : undefined}>
                    <TrackIcon name="calendar" size={12} /> {formatDay(view.due_date.slice(0, 10), locale, today)}
                  </dd>
                </div>
              )}
            </dl>
          )}
          {descriptionText(view.description).trim() ? (
            <MarkdownView source={descriptionText(view.description)} className="track-peek-desc" />
          ) : (
            <p className="ui-help">{tx('noDescription')}</p>
          )}
          {children.length > 0 && (
            <section className="track-peek-sub">
              <p className="track-subissues-progress">
                <ProgressRing done={done} total={children.length} /> {tx('subIssues', { done, total: children.length })}
              </p>
              <ul className="track-subtask-list" role="list">
                {children.slice(0, 12).map((c) => (
                  <li key={c.id} className="track-subtask-row track-peek-subrow">
                    <StatusDot color={c.status_color} category={c.status_category} />
                    <span className="track-identifier track-subtask-id">{c.identifier}</span>
                    <Link href={`/app/track/issues/${c.id}`} className="track-subtask-title">
                      {c.title || '–'}
                    </Link>
                    {c.assignee_id && (
                      <span className="track-avatar is-small" title={c.assignee_name ?? c.assignee_email ?? ''} aria-hidden>
                        {(c.assignee_name ?? c.assignee_email ?? '?')[0]?.toUpperCase()}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {children.length > 12 && <p className="ui-help">{tx('moreSubIssues', { count: children.length - 12 })}</p>}
            </section>
          )}
          <section className="track-peek-activity" aria-label={tx('activity')} data-testid="track-peek-activity">
            <h3 className="track-peek-section-title">{tx('activity')}</h3>
            {recent.length === 0 ? (
              <p className="ui-help">{tx('noComments')}</p>
            ) : (
              <>
                {entries.length > recent.length && (
                  <p className="ui-help">{tx('olderActivity', { count: entries.length - recent.length })}</p>
                )}
                <ul className="track-peek-comments" role="list">
                  {recent.map((entry) =>
                    entry.kind === 'comment' ? (
                      <li key={entry.activity.id} className="track-peek-comment">
                        <p className="track-peek-comment-head">
                          <span className="track-avatar is-small" aria-hidden>
                            {entry.who?.[0]?.toUpperCase() ?? '?'}
                          </span>
                          <strong>{entry.who}</strong>
                          <span className="track-peek-comment-at">
                            <LocalText>{relDate(entry.activity.created_at, locale)}</LocalText>
                          </span>
                        </p>
                        <MarkdownView source={entry.body} className="track-peek-comment-body" />
                      </li>
                    ) : (
                      <li key={entry.activity.id} className="track-peek-event" data-testid="track-peek-event">
                        <span className="track-event-icon" aria-hidden>
                          <EventGlyph activity={entry.activity} meta={parseMeta(entry.activity.meta)} members={members} />
                        </span>
                        <span className="track-peek-event-text">{eventText(entry.activity)}</span>
                        <span className="track-peek-comment-at">
                          <LocalText>{relDate(entry.activity.created_at, locale)}</LocalText>
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              </>
            )}
          </section>
          <Link href={`/app/track/issues/${view.id}`} className="btn btn-sm track-peek-open">
            {tx('open')} <kbd className="kbd track-kbd">↵</kbd>
          </Link>
        </div>
      )}
    </div>
  );
}
