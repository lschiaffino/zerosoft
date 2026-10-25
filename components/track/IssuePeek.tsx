'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import { isCompletedCategory } from '@/lib/track-tasks';
import dynamic from 'next/dynamic';
import { PriorityIcon, StatusDot } from './InlineEditors';
import { ProgressRing } from './ProgressRing';
import TrackIcon from './TrackIcon';
import { projectCommand, rowTargetId } from './trackCommands';
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
 */
export default function IssuePeek() {
  const t = useTranslations('track');
  const tx = useTranslations('track.ux.peek');
  const tc = useTranslations('track.ux.cmd');
  const ts = useTranslations('track.ux.side');
  const router = useRouter();
  const pathname = usePathname();
  const [issueId, setIssueId] = useState<string | null>(null);
  const [issue, setIssue] = useState<TrackIssueWithStatus | null>(null);
  const [children, setChildren] = useState<TrackIssueWithStatus[]>([]);
  const [error, setError] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setIssueId(null);
    setIssue(null);
    setChildren([]);
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
    ])
      .then(([i, c]) => {
        if (!alive) return;
        if (!i) setError(true);
        setIssue(i);
        setChildren(c.rows);
        window.setTimeout(() => panel.current?.focus(), 0);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [issueId]);

  // Mientras está abierta, ⌘K y ⇧P actúan sobre el issue de la vista rápida.
  useEffect(() => {
    if (!issue) return;
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
  }, [issue, tc]);

  if (!issueId) return null;
  const done = children.filter((c) => isCompletedCategory(c.status_category)).length;
  const labels = issue ? parseLabels(issue.labels) : [];

  return (
    <div
      ref={panel}
      className="track-peek"
      role="dialog"
      aria-modal="false"
      aria-label={issue ? `${issue.identifier} ${issue.title}` : tx('title')}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        } else if (e.key.toLowerCase() === 'p' && e.shiftKey && !e.metaKey && !e.ctrlKey && issue && !isTypingTarget(e.target)) {
          e.preventDefault();
          openCommandMenu('project');
        } else if (e.key === 'Enter' && issue && !isTypingTarget(e.target) && e.target === panel.current) {
          e.preventDefault();
          router.push(`/app/track/issues/${issue.id}`);
        }
      }}
      data-testid="track-peek"
    >
      <div className="track-peek-head">
        <span className="track-identifier">{issue?.identifier ?? '…'}</span>
        <span className="track-peek-hint">{tx('hint')}</span>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={close} aria-label={tx('close')}>
          <TrackIcon name="close" size={14} />
        </button>
      </div>
      {error ? (
        <p className="ui-error" role="alert">
          {t('errors.generic')}
        </p>
      ) : !issue ? (
        <div className="ui-loading-stack" aria-busy="true">
          <span className="ui-skeleton ui-skeleton-title" />
          <span className="ui-skeleton ui-skeleton-row" />
          <span className="ui-skeleton ui-skeleton-row" />
        </div>
      ) : (
        <div className="track-peek-body">
          {issue.parent_identifier && (
            <p className="track-parent-line">
              <TrackIcon name="parent" size={12} />
              <span className="track-identifier">{issue.parent_identifier}</span>
              <span className="track-parent-title">{issue.parent_title}</span>
            </p>
          )}
          <h2 className="track-peek-title">{issue.title || t('issues.untitled')}</h2>
          <dl className="track-peek-props">
            <div>
              <dt>{t('issues.status')}</dt>
              <dd>
                <StatusDot color={issue.status_color} category={issue.status_category} /> {issue.status_name ?? '–'}
              </dd>
            </div>
            <div>
              <dt>{t('issues.priority')}</dt>
              <dd>
                <PriorityIcon priority={issue.priority} /> {t(`priorities.${issue.priority}`)}
              </dd>
            </div>
            <div>
              <dt>{t('issues.assignee')}</dt>
              <dd>{issue.assignee_name ?? issue.assignee_email ?? t('issues.noAssignee')}</dd>
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
                  className={`track-inline-trigger${issue.plan_id ? '' : ' is-dim'}`}
                  onClick={() => openCommandMenu('project')}
                  aria-keyshortcuts="Shift+P"
                  data-testid="track-peek-plan"
                >
                  {issue.plan_name ?? tc('noProject')}
                </button>
              </dd>
            </div>
            {issue.due_date && (
              <div>
                <dt>{t('issues.dueDate')}</dt>
                <dd>{issue.due_date}</dd>
              </div>
            )}
          </dl>
          {descriptionText(issue.description).trim() ? (
            <MarkdownView source={descriptionText(issue.description)} className="track-peek-desc" />
          ) : (
            <p className="ui-help">{tx('noDescription')}</p>
          )}
          {children.length > 0 && (
            <section className="track-peek-sub">
              <p className="track-subissues-progress">
                <ProgressRing done={done} total={children.length} /> {tx('subIssues', { done, total: children.length })}
              </p>
              <ul className="track-subtask-list" role="list">
                {children.map((c) => (
                  <li key={c.id} className="track-subtask-row">
                    <StatusDot color={c.status_color} category={c.status_category} />
                    <span className="track-identifier track-subtask-id">{c.identifier}</span>
                    <Link href={`/app/track/issues/${c.id}`} className="track-subtask-title">
                      {c.title || '–'}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <Link href={`/app/track/issues/${issue.id}`} className="btn btn-sm track-peek-open">
            {tx('open')} <kbd className="kbd track-kbd">↵</kbd>
          </Link>
        </div>
      )}
    </div>
  );
}
