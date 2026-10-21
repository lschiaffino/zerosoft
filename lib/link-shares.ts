/**
 * Páginas públicas de analytics de un link o de un tag (server-only).
 *
 * Cada página es un token largo y aleatorio (no se adivina) que se puede
 * revocar. La página muestra totales, días y desgloses agregados: sin IPs,
 * sin el click log y sin URLs completas de referrer (solo el dominio).
 */
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { getDb, type LinkAnalyticsShareRow } from './db';
import { linkShortUrl, getUserLink, type LinkWithDomain } from './links';
import { shortUrl } from './utils';

export const MAX_SHARES_PER_TARGET = 10;

export const shareCreateSchema = z.union([
  z.object({ linkId: z.string().min(1).max(64) }),
  z.object({ tag: z.string().trim().min(1).max(40) }),
]);

export type ShareTarget = z.infer<typeof shareCreateSchema>;

/** Token de 32 bytes en base64url (43 caracteres). */
export function newShareToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Forma válida de un token (antes de ir a la base). */
export function isShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export interface ShareDto {
  id: string;
  token: string;
  path: string;
  /** URL absoluta en el dominio de la app. */
  url: string;
  link_id: string | null;
  tag: string | null;
  created_at: string;
}

export function sharePath(token: string): string {
  return `/stats/${token}`;
}

function toDto(row: LinkAnalyticsShareRow): ShareDto {
  return {
    id: row.id,
    token: row.token,
    path: sharePath(row.token),
    url: shortUrl(sharePath(row.token).slice(1)),
    link_id: row.link_id, tag: row.tag,
    created_at: row.created_at,
  };
}

/** Tag usado por algún link del workspace. */
async function tagExists(ownerId: string, tag: string): Promise<boolean> {
  return !!(await getDb()
    .prepare(
      `SELECT 1 AS x FROM links l, json_each(CASE WHEN json_valid(l.tags) THEN l.tags ELSE '[]' END) j
       WHERE l.user_id = ? AND j.value = ? LIMIT 1`,
    )
    .get(ownerId, tag));
}

export async function listShares(ownerId: string, target: ShareTarget): Promise<ShareDto[]> {
  const rows = (await getDb()
    .prepare(
      'linkId' in target
        ? 'SELECT * FROM link_analytics_shares WHERE user_id = ? AND link_id = ? AND revoked_at IS NULL ORDER BY created_at DESC'
        : 'SELECT * FROM link_analytics_shares WHERE user_id = ? AND link_id IS NULL AND tag = ? AND revoked_at IS NULL ORDER BY created_at DESC',
    )
    .all(ownerId, 'linkId' in target ? target.linkId : target.tag)) as LinkAnalyticsShareRow[];
  return rows.map(toDto);
}

export async function createShare(
  ownerId: string,
  target: ShareTarget,
  createdBy: string | null,
): Promise<{ ok: true; share: ShareDto } | { ok: false; code: 'not_found' | 'too_many' }> {
  if ('linkId' in target) {
    if (!(await getUserLink(ownerId, target.linkId))) return { ok: false, code: 'not_found' };
  } else if (!(await tagExists(ownerId, target.tag))) {
    return { ok: false, code: 'not_found' };
  }
  if ((await listShares(ownerId, target)).length >= MAX_SHARES_PER_TARGET) return { ok: false, code: 'too_many' };
  const id = crypto.randomUUID();
  const token = newShareToken();
  await getDb()
    .prepare('INSERT INTO link_analytics_shares (id, user_id, token, link_id, tag, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, ownerId, token, 'linkId' in target ? target.linkId : null, 'tag' in target ? target.tag : null, createdBy);
  const row = (await getDb().prepare('SELECT * FROM link_analytics_shares WHERE id = ?').get(id)) as LinkAnalyticsShareRow;
  return { ok: true, share: toDto(row) };
}

/** Revoca la página: el link deja de funcionar al instante. */
export async function revokeShare(ownerId: string, id: string): Promise<boolean> {
  const res = await getDb()
    .prepare("UPDATE link_analytics_shares SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .run(id, ownerId);
  return res.changes > 0;
}

export async function getShare(ownerId: string, id: string): Promise<LinkAnalyticsShareRow | undefined> {
  return (await getDb().prepare('SELECT * FROM link_analytics_shares WHERE id = ? AND user_id = ?').get(id, ownerId)) as
    | LinkAnalyticsShareRow
    | undefined;
}

export interface PublicShare {
  share: LinkAnalyticsShareRow;
  /** El link compartido (si es de un link). */
  link: LinkWithDomain | null;
  /** Lo que se muestra como título: la URL corta o el tag. */
  label: string;
}

/** La página pública de un token vigente (no revocado y con su link o tag todavía en pie). */
export async function getPublicShare(token: string): Promise<PublicShare | null> {
  if (!isShareToken(token)) return null;
  const share = (await getDb()
    .prepare('SELECT * FROM link_analytics_shares WHERE token = ? AND revoked_at IS NULL')
    .get(token)) as LinkAnalyticsShareRow | undefined;
  if (!share) return null;
  if (share.link_id) {
    const link = await getUserLink(share.user_id, share.link_id);
    if (!link) return null;
    return { share, link, label: linkShortUrl(link).replace(/^https?:\/\//, '') };
  }
  if (!share.tag) return null;
  return { share, link: null, label: share.tag };
}
