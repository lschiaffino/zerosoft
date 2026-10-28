/**
 * Registro de actividad de Link: quién creó, cambió, archivó o borró cada
 * link y qué cambió (destino, slug, vencimiento…). Responde la pregunta de
 * siempre: "¿quién cambió el destino del link que está impreso en el QR?".
 * Los links borrados conservan su historial (sin FK a links). Server-only.
 */
import { getDb } from './db';

export const LINK_ACTIVITY_ACTIONS = [
  'created',
  'updated',
  'archived',
  'unarchived',
  'deleted',
  'blocked',
  'unblocked',
] as const;
export type LinkActivityAction = (typeof LINK_ACTIVITY_ACTIONS)[number];

export type LinkActivityVia = 'app' | 'api' | 'mcp' | 'import' | 'system';

/** Cambio de un campo: [antes, después] (strings cortos, sin secretos). */
export type LinkChanges = Record<string, [string | null, string | null] | string | null>;

export interface LinkActivityEntry {
  userId: string;
  linkId: string | null;
  slug: string;
  actorId: string | null;
  via?: LinkActivityVia;
  action: LinkActivityAction;
  changes?: LinkChanges | Record<string, unknown> | null;
}

/** Anota una entrada. Nunca lanza: el registro no puede romper la operación. */
export async function logLinkActivity(e: LinkActivityEntry): Promise<void> {
  try {
    await getDb()
      .prepare('INSERT INTO link_activity (user_id, link_id, slug, actor_id, via, action, changes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(e.userId, e.linkId, e.slug, e.actorId, e.via ?? 'app', e.action, e.changes ? JSON.stringify(e.changes) : null);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[link-activity] insert failed', (err as Error)?.name ?? 'error');
  }
}

const clip = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 300 ? `${s.slice(0, 299)}…` : s;
};

/** Campos que se comparan para el registro (la contraseña solo dice si cambió). */
const TRACKED: Array<[string, string]> = [
  ['url', 'url'],
  ['slug', 'slug'],
  ['title', 'title'],
  ['tags', 'tags'],
  ['expires_at', 'expiresAt'],
  ['max_clicks', 'maxClicks'],
  ['redirect_type', 'redirectType'],
  ['og_title', 'ogTitle'],
  ['og_description', 'ogDescription'],
  ['og_image', 'ogImage'],
  ['forward_params', 'forwardParams'],
  ['expired_url', 'expiredUrl'],
  ['targeting', 'targeting'],
  ['external_id', 'externalId'],
  ['folder_id', 'folderId'],
  ['track_conversion', 'trackConversion'],
  ['cloak', 'cloak'],
];

/** Diferencias entre dos versiones de un link (fila de la base). */
export function diffLink(before: Record<string, unknown>, after: Record<string, unknown>): LinkChanges {
  const out: LinkChanges = {};
  for (const [col, key] of TRACKED) {
    const a = clip(before[col]);
    const b = clip(after[col]);
    if (a !== b) out[key] = [a, b];
  }
  if ((before.password_hash ?? null) !== (after.password_hash ?? null)) {
    out.password = after.password_hash ? (before.password_hash ? 'changed' : 'set') : 'removed';
  }
  return out;
}

export interface LinkActivityRow {
  id: number;
  link_id: string | null;
  slug: string;
  actor_id: string | null;
  actor_name: string | null;
  via: LinkActivityVia;
  action: LinkActivityAction;
  changes: LinkChanges | null;
  created_at: string;
}

export interface ListActivityOptions {
  linkId?: string;
  /** Paginación por id descendente. */
  before?: number;
  limit?: number;
}

/** Actividad del workspace (o de un link), lo más nuevo primero. */
export async function listLinkActivity(
  userId: string,
  opts: ListActivityOptions = {},
): Promise<{ rows: LinkActivityRow[]; nextBefore: number | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const args: Array<string | number> = [userId];
  let where = 'a.user_id = ?';
  if (opts.linkId) {
    where += ' AND a.link_id = ?';
    args.push(opts.linkId);
  }
  if (opts.before) {
    where += ' AND a.id < ?';
    args.push(opts.before);
  }
  const rows = (await getDb()
    .prepare(
      `SELECT a.*, u.name AS actor_name, u.email AS actor_email FROM link_activity a
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE ${where} ORDER BY a.id DESC LIMIT ?`,
    )
    .all(...args, limit + 1)) as Array<Omit<LinkActivityRow, 'changes'> & { changes: string | null; actor_email: string | null }>;
  const page = rows.slice(0, limit);
  return {
    rows: page.map(({ actor_email, ...r }) => {
      let changes: LinkChanges | null = null;
      try {
        changes = r.changes ? (JSON.parse(r.changes) as LinkChanges) : null;
      } catch {
        changes = null;
      }
      return { ...r, actor_name: r.actor_name || actor_email || null, changes };
    }),
    nextBefore: rows.length > limit ? page[page.length - 1].id : null,
  };
}
