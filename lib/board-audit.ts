/**
 * Board: registro de actividad (audit log). Quién creó, renombró, movió,
 * mandó a la papelera, restauró o borró una pizarra, y quién cambió su acceso
 * o sus links, por dónde (app, API, MCP). Lo ven los admins en Board ›
 * Ajustes, con export a CSV. Server-only.
 */
import { getDb } from './db';

import { BOARD_AUDIT_ACTIONS, type BoardAuditAction, type BoardAuditEntry, type BoardAuditVia } from './board-audit-types';

export { BOARD_AUDIT_ACTIONS, type BoardAuditAction, type BoardAuditEntry, type BoardAuditVia };

/** Anota una acción. Nunca tira: el registro no puede romper lo que registra. */
export async function logBoardAudit(e: {
  workspaceId: string;
  actorId: string | null;
  action: BoardAuditAction;
  boardId?: string | null;
  boardName?: string | null;
  via?: BoardAuditVia;
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    await getDb()
      .prepare(
        `INSERT INTO board_audit (id, workspace_id, board_id, board_name, actor_id, via, action, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        e.workspaceId,
        e.boardId ?? null,
        e.boardName?.slice(0, 200) ?? null,
        e.actorId,
        e.via ?? 'app',
        e.action,
        JSON.stringify(e.data ?? {}),
        new Date().toISOString(),
      );
  } catch {
    /* sin registro */
  }
}

export async function listBoardAudit(
  workspaceId: string,
  opts: { action?: string | null; boardId?: string | null; limit?: number; before?: string | null } = {},
): Promise<BoardAuditEntry[]> {
  const where = ['a.workspace_id = ?'];
  const args: Array<string | number> = [workspaceId];
  if (opts.action && (BOARD_AUDIT_ACTIONS as readonly string[]).includes(opts.action)) {
    where.push('a.action = ?');
    args.push(opts.action);
  }
  if (opts.boardId) {
    where.push('a.board_id = ?');
    args.push(opts.boardId);
  }
  if (opts.before) {
    where.push('a.created_at < ?');
    args.push(opts.before);
  }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  const rows = (await getDb()
    .prepare(
      `SELECT a.*, u.name AS actor_name, u.email AS actor_email FROM board_audit a LEFT JOIN users u ON u.id = a.actor_id
       WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT ?`,
    )
    .all(...args, limit)) as Array<{
    id: string;
    board_id: string | null;
    board_name: string | null;
    actor_id: string | null;
    actor_name: string | null;
    actor_email: string | null;
    via: string;
    action: string;
    data: string;
    created_at: string;
  }>;
  return rows.map((r) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(r.data) as Record<string, unknown>;
    } catch {
      /* vacío */
    }
    return {
      id: r.id,
      boardId: r.board_id,
      boardName: r.board_name,
      actorId: r.actor_id,
      actorName: r.actor_name ?? r.actor_email ?? null,
      via: (r.via === 'api' || r.via === 'mcp' ? r.via : 'app') as BoardAuditVia,
      action: r.action as BoardAuditAction,
      data,
      createdAt: r.created_at,
    };
  });
}

/** Celda CSV segura: comillas y sin fórmulas (=, +, -, @ al principio). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function boardAuditCsv(entries: BoardAuditEntry[]): string {
  const head = ['created_at', 'actor', 'via', 'action', 'board_id', 'board_name', 'data'];
  const lines = entries.map((e) => [e.createdAt, e.actorName ?? '', e.via, e.action, e.boardId ?? '', e.boardName ?? '', e.data].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\n') + '\n';
}
