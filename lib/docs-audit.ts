/**
 * Docs: registro de auditoría del workspace (quién hizo qué y cuándo con las
 * páginas, los permisos y la seguridad). Lo ven y exportan los admins.
 * Se guarda una línea por evento; escribir nunca rompe la acción original.
 */
import { getDb } from './db';

export const DOCS_AUDIT_ACTIONS = [
  'page.created',
  'page.trashed',
  'page.restored',
  'page.deleted',
  'page.moved',
  'page.duplicated',
  'page.exported',
  'page.published',
  'page.unpublished',
  'page.locked',
  'page.unlocked',
  'page.member_role',
  'page.verified',
  'page.unverified',
  'page.owner',
  'version.restored',
  'share.added',
  'share.role',
  'share.removed',
  'guest.invited',
  'guest.accepted',
  'guest.revoked',
  'teamspace.created',
  'teamspace.updated',
  'teamspace.deleted',
  'teamspace.member_added',
  'teamspace.member_removed',
  'settings.updated',
  'settings.exported',
  'settings.imported',
  'settings.site',
] as const;

export type DocsAuditAction = (typeof DOCS_AUDIT_ACTIONS)[number];

export interface DocsAuditEntry {
  id: string;
  workspace_id: string;
  actor_id: string | null;
  actor_label: string;
  action: DocsAuditAction;
  page_id: string | null;
  page_title: string;
  detail: string;
  ip: string | null;
  created_at: string;
}

export interface AuditActor {
  id: string;
  email?: string | null;
  name?: string | null;
}

/**
 * Nombre legible de a quién apunta un share o un cambio de miembros (persona
 * o team), para el detalle del registro: así se lee "Carol · comment" y no un id.
 */
export async function auditTargetLabel(kind: string, targetId: string | null | undefined): Promise<string> {
  if (!targetId) return kind;
  try {
    if (kind === 'team') {
      const team = (await getDb().prepare('SELECT name FROM teams WHERE id = ?').get(targetId)) as { name: string } | undefined;
      return team?.name || targetId;
    }
    const u = (await getDb().prepare('SELECT name, email FROM users WHERE id = ?').get(targetId)) as { name: string | null; email: string } | undefined;
    return u ? u.name?.trim() || u.email : targetId;
  } catch {
    return targetId;
  }
}

/** Retención: un año (como Notion). */
export const AUDIT_RETENTION_DAYS = 365;

export async function logDocsAudit(args: {
  workspaceId: string;
  actor: AuditActor | null;
  action: DocsAuditAction;
  page?: { id: string; title?: string | null } | null;
  detail?: string;
  ip?: string | null;
}): Promise<void> {
  try {
    await getDb()
      .prepare(
        `INSERT INTO docs_audit (id, workspace_id, actor_id, actor_label, action, page_id, page_title, detail, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        args.workspaceId,
        args.actor?.id ?? null,
        (args.actor?.name?.trim() || args.actor?.email || '').slice(0, 200),
        args.action,
        args.page?.id ?? null,
        (args.page?.title ?? '').slice(0, 300),
        (args.detail ?? '').slice(0, 1000),
        args.ip ? args.ip.slice(0, 64) : null,
        new Date().toISOString(),
      );
  } catch {
    /* la auditoría no frena la acción */
  }
}

export interface AuditFilters {
  from?: string | null;
  to?: string | null;
  actorId?: string | null;
  action?: string | null;
  pageId?: string | null;
  /** Cursor: created_at del último de la página anterior. */
  before?: string | null;
  limit?: number;
}

export async function listDocsAudit(workspaceId: string, f: AuditFilters = {}): Promise<DocsAuditEntry[]> {
  const where = ['workspace_id = ?'];
  const args: Array<string | number> = [workspaceId];
  const since = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86_400_000).toISOString();
  where.push('created_at >= ?');
  args.push(f.from && f.from > since ? f.from : since);
  if (f.to) {
    where.push('created_at <= ?');
    args.push(f.to);
  }
  if (f.actorId) {
    where.push('actor_id = ?');
    args.push(f.actorId);
  }
  if (f.action) {
    // "share" filtra todas las share.*; "page.locked" una sola.
    if (f.action.includes('.')) {
      where.push('action = ?');
      args.push(f.action);
    } else {
      where.push('action LIKE ?');
      args.push(`${f.action.replace(/[%_]/g, '')}.%`);
    }
  }
  if (f.pageId) {
    where.push('page_id = ?');
    args.push(f.pageId);
  }
  if (f.before) {
    where.push('created_at < ?');
    args.push(f.before);
  }
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 5000);
  return (await getDb()
    .prepare(`SELECT * FROM docs_audit WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...args, limit)) as DocsAuditEntry[];
}

/** Borra lo que pasó la retención (lo llama el cron). */
export async function pruneDocsAudit(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * 86_400_000).toISOString();
  const res = await getDb().prepare('DELETE FROM docs_audit WHERE created_at < ?').run(cutoff);
  return res.changes;
}

function csvCell(v: string | null | undefined): string {
  const s = String(v ?? '');
  // Fórmulas en planillas: un prefijo neutro para =, +, - y @.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function auditToCsv(rows: DocsAuditEntry[]): string {
  const head = ['created_at', 'actor', 'actor_id', 'action', 'page', 'page_id', 'detail', 'ip'];
  const lines = rows.map((r) =>
    [r.created_at, r.actor_label, r.actor_id, r.action, r.page_title, r.page_id, r.detail, r.ip].map(csvCell).join(','),
  );
  return [head.join(','), ...lines].join('\n') + '\n';
}

/** IP de quien hace el request (detrás de Vercel: x-forwarded-for). */
export function requestIp(headers: Headers): string | null {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() || null;
  return headers.get('x-real-ip');
}
