/**
 * Track — reparte cada cambio de issues, comentarios y proyectos a:
 *   1. el audit log (lib/track-audit),
 *   2. los webhooks salientes (issue.created desde fuera de la app,
 *      issue.deleted, comment.created, project.*; issue.updated y
 *      issue.status_changed ya los emite updateIssue),
 *   3. Slack (avisos por canal e hilos sincronizados) y los tickets de
 *      soporte vinculados (Sentry, Zendesk, Intercom), por la cola con
 *      reintentos de lib/track-integrations.
 *
 * Lo llama lib/track-data en los puntos donde ya pasan todos los caminos
 * (app, API, MCP, Slack, GitHub, Flow). Corre después de responder (after)
 * y nunca lanza.
 */
import { after } from 'next/server';
import type { TrackProjectRow } from './db';
import type { TrackIssueWithStatus } from './track-data';
import { currentTrackVia, currentTrackViewer, type TrackVia } from './track-access';
import { recordAudit } from './track-audit';
import { processOutbox } from './track-integrations';

export type TrackEventInput =
  | { type: 'issue.created'; issueId: string; actorId: string; source: string }
  | {
      type: 'issue.updated';
      before: TrackIssueWithStatus;
      after: TrackIssueWithStatus;
      changes: string[];
      actorId?: string | null;
      /** Cambio automático (hoy GitHub): pisa el camino del request. */
      via?: TrackVia;
    }
  | { type: 'issue.deleted'; issue: TrackIssueWithStatus; actorId?: string | null; count: number }
  | { type: 'comment.created'; issueId: string; commentId: string; actorId: string; body: string }
  | { type: 'project.created' | 'project.updated' | 'project.deleted'; project: TrackProjectRow; actorId?: string | null; changes?: string[] };

export interface TrackEventContext {
  via: TrackVia;
  /** Persona del request (para los eventos que no traen actor, como borrar). */
  viewer?: Promise<string | null>;
}

/** Campos que se comparan para el "antes → después" del audit log y del webhook. */
const DIFF_FIELDS: Array<[keyof TrackIssueWithStatus, string]> = [
  ['title', 'title'],
  ['status_name', 'status'],
  ['priority', 'priority'],
  ['assignee_email', 'assignee'],
  ['cycle_name', 'cycle'],
  ['milestone_name', 'milestone'],
  ['estimate', 'estimate'],
  ['start_date', 'startDate'],
  ['due_date', 'dueDate'],
  ['parent_id', 'parentId'],
  ['labels', 'labels'],
];

export function issueDiff(before: TrackIssueWithStatus, after: TrackIssueWithStatus): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [field, key] of DIFF_FIELDS) {
    const a = before[field] ?? null;
    const b = after[field] ?? null;
    if (a !== b) out[key] = { from: a, to: b };
  }
  if (before.description !== after.description) out.description = { from: '…', to: '…' };
  return out;
}

export function notifyTrackEvent(event: TrackEventInput): void {
  // Un import masivo no deja una entrada ni un aviso por issue.
  if (event.type === 'issue.created' && event.source === 'import') return;
  // El camino (API, MCP, Slack…) se lee ahora: dentro de after() el contexto puede no estar.
  const ctx: TrackEventContext = { via: currentTrackVia(), viewer: currentTrackViewer().catch(() => null) };
  const job = () => handleTrackEvent(event, ctx).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[track-events] failed', err);
  });
  try {
    after(job);
  } catch {
    void job();
  }
}

function workspaceOf(p: Pick<TrackProjectRow, 'team_id' | 'owner_id'>): string {
  return (p.team_id ?? p.owner_id) as string;
}

export async function handleTrackEvent(event: TrackEventInput, ctx: TrackEventContext): Promise<void> {
  const viewer = (await ctx.viewer) ?? null;
  const { getIssue, getProject } = await import('./track-data');
  const { toApiIssue, toApiProject } = await import('./track-api');
  const { emitWebhook } = await import('./webhooks');
  const { emitEvent } = await import('./events');

  if (event.type.startsWith('project.')) {
    const e = event as Extract<TrackEventInput, { project: TrackProjectRow }>;
    const ws = workspaceOf(e.project);
    await recordAudit({
      workspaceId: ws,
      actorId: e.actorId ?? viewer,
      via: ctx.via,
      action: e.type,
      entityType: 'project',
      entityId: e.project.id,
      entityLabel: e.project.name,
      projectId: e.type === 'project.deleted' ? null : e.project.id,
      data: e.changes?.length ? { changes: e.changes } : {},
    });
    if (e.project.owner_id) {
      await emitWebhook(e.project.owner_id, e.type, { project: toApiProject(e.project), changes: e.changes ?? [] });
    }
    return;
  }

  if (event.type === 'issue.deleted') {
    const project = await getProject(event.issue.project_id);
    if (!project) return;
    const ws = workspaceOf(project);
    await recordAudit({
      workspaceId: ws,
      actorId: event.actorId ?? viewer,
      via: ctx.via,
      action: 'issue.deleted',
      entityType: 'issue',
      entityId: event.issue.id,
      entityLabel: `${event.issue.identifier} ${event.issue.title}`,
      projectId: project.id,
      data: event.count > 1 ? { withSubIssues: event.count - 1 } : {},
    });
    if (project.owner_id) {
      await emitWebhook(project.owner_id, 'issue.deleted', {
        issue: { id: event.issue.id, identifier: event.issue.identifier, title: event.issue.title },
        project: { id: project.id, name: project.name },
      });
    }
    return;
  }

  if (event.type !== 'issue.created' && event.type !== 'issue.updated' && event.type !== 'comment.created') return;
  const issue = event.type === 'issue.updated' ? event.after : await getIssue(event.issueId);
  if (!issue) return;
  const project = await getProject(issue.project_id);
  if (!project) return;
  const ws = workspaceOf(project);
  const apiIssue = toApiIssue(issue);
  const projectRef = { id: project.id, name: project.name };

  if (event.type === 'issue.created') {
    await recordAudit({
      workspaceId: ws,
      actorId: event.actorId,
      via: event.source === 'import' ? 'import' : ctx.via,
      action: 'issue.created',
      entityType: 'issue',
      entityId: issue.id,
      entityLabel: `${issue.identifier} ${issue.title}`,
      projectId: project.id,
      data: { source: event.source },
    });
    // Desde la app ya lo emite la ruta (webhook + Flow); un import masivo no
    // dispara nada; lo que crea un Flow solo va a webhooks (sin cadenas).
    if (project.owner_id && event.source !== 'app' && event.source !== 'import') {
      const payload = {
        issue: {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          priority: issue.priority,
          status: issue.status_name ?? null,
          assigneeId: issue.assignee_id,
        },
        project: projectRef,
        source: event.source,
        data: apiIssue,
      };
      if (event.source === 'flow') await emitWebhook(project.owner_id, 'issue.created', payload);
      else await emitEvent(project.owner_id, 'issue.created', payload);
    }
  } else if (event.type === 'issue.updated') {
    const diff = issueDiff(event.before, event.after);
    if (Object.keys(diff).length > 0) {
      await recordAudit({
        workspaceId: ws,
        actorId: event.actorId ?? viewer,
        via: event.via ?? ctx.via,
        action: 'issue.updated',
        entityType: 'issue',
        entityId: issue.id,
        entityLabel: `${issue.identifier} ${issue.title}`,
        projectId: project.id,
        data: diff,
      });
    }
  } else if (event.type === 'comment.created') {
    await recordAudit({
      workspaceId: ws,
      actorId: event.actorId,
      via: ctx.via,
      action: 'comment.created',
      entityType: 'comment',
      entityId: event.commentId,
      entityLabel: `${issue.identifier} ${issue.title}`,
      projectId: project.id,
      data: { excerpt: event.body.slice(0, 140) },
    });
    if (project.owner_id) {
      await emitWebhook(project.owner_id, 'comment.created', {
        comment: { id: event.commentId, body: event.body, authorId: event.actorId, issueId: issue.id },
        issue: { id: issue.id, identifier: issue.identifier, title: issue.title },
        project: projectRef,
      });
    }
  }

  // Slack y soporte: encolan llamadas (con reintentos) y se intentan ya.
  let queued = 0;
  try {
    const { slackOnTrackEvent } = await import('./track-slack');
    queued += await slackOnTrackEvent(ws, event, ctx, issue, project);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[track-events] slack', err);
  }
  try {
    const { supportOnTrackEvent } = await import('./track-support');
    queued += await supportOnTrackEvent(ws, event, ctx, issue);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[track-events] support', err);
  }
  if (queued > 0) await drainNewOutbox(ws);
}

/** Lo recién encolado de este workspace se intenta en el momento. */
async function drainNewOutbox(workspaceId: string): Promise<void> {
  const { getDb } = await import('./db');
  const rows = (await getDb()
    .prepare(
      `SELECT id FROM track_integration_outbox WHERE workspace_id = ? AND status = 'pending' AND attempts = 0
       ORDER BY created_at LIMIT 20`,
    )
    .all(workspaceId)) as Array<{ id: string }>;
  const { runOutboxItem } = await import('./track-integrations');
  for (const r of rows) await runOutboxItem(r.id);
}

/** Cron de cada minuto: lo que quedó pendiente en la cola de integraciones. */
export async function processTrackIntegrationQueue(opts: { limit?: number } = {}): Promise<number> {
  return processOutbox(opts);
}
