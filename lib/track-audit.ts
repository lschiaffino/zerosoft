/**
 * Track — audit log: quién cambió qué, cuándo y por dónde (app, API, MCP,
 * GitHub, Slack, Sentry). Lo escriben lib/track-events (issues, comentarios,
 * proyectos) y las rutas de acceso e integraciones. Lo ven los admins en
 * Track › Ajustes › Audit log, con filtro y export a CSV.
 */
import { getDb } from './db';
import { currentTrackVia, type TrackVia } from './track-access';

export interface AuditInput {
  workspaceId: string;
  actorId: string | null;
  action: string;
  entityType: 'issue' | 'comment' | 'project' | 'access' | 'integration' | 'import' | 'webhook';
  entityId?: string | null;
  entityLabel?: string | null;
  projectId?: string | null;
  data?: Record<string, unknown>;
  via?: TrackVia;
  ip?: string | null;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorLabel: string | null;
  via: TrackVia;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  projectId: string | null;
  projectName: string | null;
  data: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

async function requestIp(): Promise<string | null> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    return (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || null;
  } catch {
    return null;
  }
}

/** Nunca lanza: el audit no puede romper la operación que registra. */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const ip = input.ip !== undefined ? input.ip : await requestIp();
    await getDb()
      .prepare(
        `INSERT INTO track_audit_log (id, workspace_id, actor_id, via, action, entity_type, entity_id, entity_label, project_id, data, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        input.workspaceId,
        input.actorId,
        input.via ?? currentTrackVia(),
        input.action,
        input.entityType,
        input.entityId ?? null,
        (input.entityLabel ?? '').slice(0, 300) || null,
        input.projectId ?? null,
        JSON.stringify(input.data ?? {}).slice(0, 8000),
        ip,
      );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[track-audit] write failed', err);
  }
}

export interface AuditQuery {
  action?: string | null;
  actorId?: string | null;
  entityType?: string | null;
  q?: string | null;
  limit?: number;
  offset?: number;
}

export const AUDIT_ACTIONS = [
  'issue.created',
  'issue.updated',
  'issue.deleted',
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'project.created',
  'project.updated',
  'project.deleted',
  'project.visibility',
  'access.member_added',
  'access.member_removed',
  'access.guest_set',
  'access.guest_removed',
  'integration.connected',
  'integration.updated',
  'integration.disconnected',
  'import.started',
] as const;

export async function listAudit(workspaceId: string, query: AuditQuery = {}): Promise<{ rows: AuditEntry[]; total: number }> {
  const where = ['a.workspace_id = ?'];
  const args: Array<string | number> = [workspaceId];
  if (query.action) {
    where.push('a.action = ?');
    args.push(query.action);
  }
  if (query.entityType) {
    where.push('a.entity_type = ?');
    args.push(query.entityType);
  }
  if (query.actorId) {
    where.push('a.actor_id = ?');
    args.push(query.actorId);
  }
  if (query.q?.trim()) {
    const like = `%${query.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where.push("(a.entity_label LIKE ? ESCAPE '\\' OR a.data LIKE ? ESCAPE '\\')");
    args.push(like, like);
  }
  const whereSql = where.join(' AND ');
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 5000);
  const offset = Math.max(query.offset ?? 0, 0);
  const db = getDb();
  const total = ((await db.prepare(`SELECT COUNT(*) AS c FROM track_audit_log a WHERE ${whereSql}`).get(...args)) as { c: number }).c;
  const rows = (await db
    .prepare(
      `SELECT a.*, u.name AS actor_name, u.email AS actor_email, p.name AS project_name
       FROM track_audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
       LEFT JOIN track_projects p ON p.id = a.project_id
       WHERE ${whereSql}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset)) as Array<{
    id: string;
    actor_id: string | null;
    actor_name: string | null;
    actor_email: string | null;
    actor_label: string | null;
    via: TrackVia;
    action: string;
    entity_type: string;
    entity_id: string | null;
    entity_label: string | null;
    project_id: string | null;
    project_name: string | null;
    data: string;
    ip: string | null;
    created_at: string;
  }>;
  return {
    total,
    rows: rows.map((r) => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(r.data) as Record<string, unknown>;
      } catch {
        data = {};
      }
      return {
        id: r.id,
        actorId: r.actor_id,
        actorName: r.actor_name,
        actorEmail: r.actor_email,
        actorLabel: r.actor_label,
        via: r.via,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        entityLabel: r.entity_label,
        projectId: r.project_id,
        projectName: r.project_name,
        data,
        ip: r.ip,
        createdAt: r.created_at,
      };
    }),
  };
}

/** Celda CSV: neutraliza fórmulas (= + - @) y escapa comillas, comas y saltos. */
export function auditCsvCell(value: string): string {
  const safe = (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replace(/"/g, '""');
  return /[",\n\r]/.test(safe) ? `"${safe}"` : safe;
}

export function auditToCsv(rows: AuditEntry[]): string {
  const cols = ['created_at', 'actor', 'via', 'action', 'entity_type', 'entity', 'project', 'details', 'ip'];
  const lines = [cols.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.createdAt,
        r.actorEmail ?? r.actorLabel ?? '',
        r.via,
        r.action,
        r.entityType,
        r.entityLabel ?? r.entityId ?? '',
        r.projectName ?? '',
        JSON.stringify(r.data),
        r.ip ?? '',
      ]
        .map((v) => auditCsvCell(String(v)))
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
