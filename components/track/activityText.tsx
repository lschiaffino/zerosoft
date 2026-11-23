'use client';

import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import type { TrackIssueActivityWithAuthor } from '@/lib/track-data';
import { PriorityIcon, StatusDot } from './glyphs';
import TrackIcon, { type TrackIconName } from './TrackIcon';

/**
 * Texto y glifo de un evento de la actividad de un issue ("cambió la
 * prioridad de Alta a Urgente"). Lo usan la línea de tiempo del issue y la
 * vista rápida, así los dos dicen lo mismo.
 */

export type ActivityMember = { id: string; name: string | null; email: string };

type Tr = (key: string, values?: Record<string, string | number>) => string;

/** Plantillas de los eventos ({user}, {from}, {to}), de `track.activity`. */
export interface ActivityEventLabels {
  created: string;
  statusChange: string;
  assigneeChange: string;
  priorityChange: string;
  cycleChange: string;
  dueDateChange: string;
  estimateChange: string;
  titleChange: string;
  descriptionChange: string;
  relationAdded: string;
  relationRemoved: string;
  attachmentAdded: string;
  subtaskAdded: string;
  closed: string;
  reopened: string;
  unassigned: string;
}

export interface ActivityTextContext {
  labels: ActivityEventLabels;
  /** `track.ux.thread`. */
  tt: Tr;
  /** `track.priorities`. */
  tp: Tr;
  locale: string;
  members: ActivityMember[];
  /** Adjuntos actuales (para enlazar las entradas "subió X"). */
  attachmentUrls?: Map<string, string>;
}

export function parseMeta(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function userName(activity: TrackIssueActivityWithAuthor, meta: Record<string, unknown> = parseMeta(activity.meta)): string {
  // Cambios automáticos de GitHub: se firman con el autor del PR, no con el
  // owner del workspace (que solo es el user_id técnico de la fila).
  if (meta.via === 'github') {
    const author = typeof meta.viaAuthor === 'string' && meta.viaAuthor ? ` (@${meta.viaAuthor})` : '';
    return `GitHub${author}`;
  }
  // Reglas de triage y agentes: se firman con su nombre.
  if ((meta.via === 'triage' || meta.via === 'agent') && typeof meta.viaAuthor === 'string' && meta.viaAuthor) {
    return meta.viaAuthor;
  }
  return activity.user_name ?? activity.user_email ?? '?';
}

/** Ícono chico de cada evento de la línea de tiempo (como el feed de Linear). */
function eventIcon(type: string, meta: Record<string, unknown> = {}): TrackIconName {
  switch (type) {
    case 'assignee_change':
      return 'user' as const;
    case 'priority_change':
      return 'flag' as const;
    case 'cycle_change':
      // Sin activity type propio en el CHECK: project, team, padre y sub-issues van por acá.
      if (meta.field === 'project') return 'plans';
      if (meta.field === 'team') return 'team';
      if (meta.field === 'parent') return 'parent';
      if (meta.field === 'subissue') return 'subtasks';
      return 'cycle' as const;
    case 'due_date_change':
      return 'calendar' as const;
    case 'estimate_change':
      return 'estimate' as const;
    case 'title_change':
    case 'description_change':
      return 'pencil' as const;
    case 'relation_added':
      return meta.merged === true ? ('duplicate' as const) : ('link' as const);
    case 'relation_removed':
      return 'link' as const;
    case 'attachment_added':
      return 'paperclip' as const;
    case 'subtask_added':
      return 'subtasks' as const;
    case 'closed':
      return 'check' as const;
    case 'reopened':
      return 'refresh' as const;
    default:
      return 'clock' as const;
  }
}

/** Glifo del evento: el estado nuevo con su color, la prioridad con sus barras, el resto con su ícono. */
export function EventGlyph({ activity, meta, members }: { activity: TrackIssueActivityWithAuthor; meta: Record<string, unknown>; members: ActivityMember[] }) {
  if (activity.type === 'status_change' && meta.toCategory) {
    return <StatusDot color={typeof meta.toColor === 'string' && meta.toColor ? meta.toColor : null} category={String(meta.toCategory)} />;
  }
  if (activity.type === 'priority_change' && typeof meta.to === 'string') return <PriorityIcon priority={meta.to || 'none'} />;
  if (activity.type === 'assignee_change' && typeof meta.to === 'string' && meta.to) {
    const m = members.find((x) => x.id === meta.to);
    return <span className="track-avatar is-tiny">{(m?.name || m?.email || '?').trim().charAt(0).toUpperCase()}</span>;
  }
  return <TrackIcon name={eventIcon(activity.type, meta)} size={12} />;
}

export function describeActivity(
  activity: TrackIssueActivityWithAuthor,
  { labels, tt, tp, locale, members, attachmentUrls = new Map() }: ActivityTextContext,
): ReactNode {
  const meta = parseMeta(activity.meta);
  const name = userName(activity, meta);
  const from = String(meta.from ?? '');
  const to = String(meta.to ?? '');
  const fill = (tpl: string, f = from, t2 = to) => tpl.replace('{user}', name).replace('{from}', f).replace('{to}', t2);
  // Como Linear: "puso la estimación en 3" o "quitó el vencimiento" cuando
  // uno de los lados está vacío (nada de "de  a 3").
  const change = (field: 'status' | 'priority' | 'cycle' | 'dueDate' | 'estimate', tpl: string, f = from, t2 = to) => {
    if (!f && t2) return tt('fieldSet', { user: name, field: tt(`fields.${field}`), to: t2 });
    if (f && !t2) return tt('fieldCleared', { user: name, field: tt(`fields.${field}`) });
    return fill(tpl, f, t2);
  };
  const prio = (v: string) => (!v || v === 'none' ? '' : ['urgent', 'high', 'medium', 'low'].includes(v) ? tp(v) : v);
  const day = (v: string) => {
    if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return v;
    const d = new Date(`${v.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  switch (activity.type) {
    case 'created':
      return labels.created.replace('{user}', name);
    case 'status_change':
      return change('status', labels.statusChange);
    case 'assignee_change': {
      const nameOf = (id: string) =>
        id ? (members.find((m) => m.id === id)?.name ?? members.find((m) => m.id === id)?.email ?? id) : labels.unassigned;
      if (!from && to) return tt('assignedTo', { user: name, to: nameOf(to) });
      if (from && !to) return tt('unassignedFrom', { user: name, from: nameOf(from) });
      return fill(labels.assigneeChange, nameOf(from), nameOf(to));
    }
    case 'priority_change':
      return change('priority', labels.priorityChange, prio(from), prio(to));
    case 'cycle_change':
      // Cambios sin activity type propio (CHECK de la tabla): project y team.
      if (meta.field === 'project') {
        if (!to) return tt('projectRemoved', { user: name, from });
        return from ? tt('projectChange', { user: name, from, to }) : tt('projectAdded', { user: name, to });
      }
      if (meta.field === 'parent') {
        const link = (ident: string, issueId: string) =>
          issueId ? (
            <Link href={`/app/track/issues/${issueId}`} className="track-activity-link">
              {ident || issueId}
            </Link>
          ) : (
            ident
          );
        if (!to) return <>{tt('parentRemoved', { user: name })} {link(from, String(meta.fromId ?? ''))}</>;
        return <>{tt('parentSet', { user: name })} {link(to, String(meta.toId ?? ''))}</>;
      }
      if (meta.field === 'subissue') {
        const child = String(meta.child ?? '');
        const childId = String(meta.childId ?? '');
        const link = childId ? (
          <Link href={`/app/track/issues/${childId}`} className="track-activity-link">
            {child}
          </Link>
        ) : (
          child
        );
        return <>{tt(meta.action === 'removed' ? 'subissueRemoved' : 'subissueAdded', { user: name })} {link}</>;
      }
      if (meta.field === 'team') {
        return tt('teamMoved', {
          user: name,
          from,
          to,
          fromId: String(meta.fromIdentifier ?? ''),
          toId: String(meta.toIdentifier ?? ''),
        });
      }
      return change('cycle', labels.cycleChange);
    case 'due_date_change':
      return change('dueDate', labels.dueDateChange, day(from), day(to));
    case 'estimate_change':
      return change('estimate', labels.estimateChange);
    case 'title_change':
      return fill(labels.titleChange);
    case 'description_change':
      return labels.descriptionChange.replace('{user}', name);
    case 'relation_added': {
      const relatedIssueId = String(meta.relatedIssueId ?? '');
      // Marca de duplicado vista desde el original: quién, cuál y el resumen de lo que trajo.
      if (meta.merged === true) {
        const n = (k: string) => (typeof meta[k] === 'number' ? (meta[k] as number) : 0);
        const title = typeof meta.title === 'string' ? meta.title : '';
        const excerpt = typeof meta.excerpt === 'string' ? meta.excerpt : '';
        const counts = [
          n('comments') ? tt('dupComments', { count: n('comments') }) : '',
          n('attachments') ? tt('dupAttachments', { count: n('attachments') }) : '',
          n('subscribers') ? tt('dupSubscribers', { count: n('subscribers') }) : '',
          n('requests') ? tt('dupRequests', { count: n('requests') }) : '',
        ].filter(Boolean);
        return (
          <>
            {tt('dupMergedBefore', { user: name })}{' '}
            {relatedIssueId ? (
              <Link href={`/app/track/issues/${relatedIssueId}`} className="track-activity-link" data-testid="track-dup-merged-link">
                {String(meta.identifier ?? relatedIssueId)}
              </Link>
            ) : (
              String(meta.identifier ?? '')
            )}{' '}
            {tt('dupMergedAfter')}
            {(title || excerpt || counts.length > 0) && (
              <span className="track-dup-summary" data-testid="track-dup-summary">
                {title && <span className="track-dup-summary-title">{title}</span>}
                {excerpt && <span className="track-dup-summary-excerpt">{excerpt}</span>}
                {counts.length > 0 && <span className="track-dup-summary-counts">{counts.join(' · ')}</span>}
              </span>
            )}
          </>
        );
      }
      return (
        <>
          {labels.relationAdded.replace('{user}', name)}{' '}
          {relatedIssueId && (
            <Link href={`/app/track/issues/${relatedIssueId}`} className="track-activity-link">
              {String(meta.identifier ?? relatedIssueId)}
            </Link>
          )}
        </>
      );
    }
    case 'relation_removed':
      return labels.relationRemoved.replace('{user}', name);
    case 'attachment_added': {
      const filename = String(meta.filename ?? '');
      const url = attachmentUrls.get(String(meta.attachmentId ?? ''));
      // El nombre del archivo una sola vez: como link si el adjunto sigue estando.
      const text = labels.attachmentAdded.replace('{user}', name);
      const [before, after = ''] = text.includes('{filename}') ? text.split('{filename}') : [`${text} `, ''];
      return (
        <>
          {before}
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="track-activity-link">
              {filename}
            </a>
          ) : (
            filename
          )}
          {after}
        </>
      );
    }
    case 'subtask_added':
      return labels.subtaskAdded.replace('{user}', name);
    case 'closed':
      // Auto-cierre (como Linear): una línea de Track con el porqué.
      if (meta.auto === 'sub_issues_done') return tt('autoClosedSubs');
      if (meta.auto === 'parent_closed') return tt('autoClosedParent');
      return labels.closed.replace('{user}', name);
    case 'reopened':
      return labels.reopened.replace('{user}', name);
    default:
      return activity.type;
  }
}
