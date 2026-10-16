import { getDb } from './db';
import { linkShortUrl, type LinkWithDomain } from './links';

/** Página link-in-bio (/@handle): perfil + links elegidos, en orden. */

export interface BioSettings {
  title: string;
  bio: string;
  avatarUrl: string | null;
  published: boolean;
  linkIds: string[];
}

export interface PublicBio {
  handle: string;
  title: string;
  bio: string;
  avatarUrl: string | null;
  links: Array<{ id: string; title: string; href: string }>;
}

export async function getBioSettings(userId: string): Promise<BioSettings> {
  const row = (await getDb().prepare('SELECT * FROM link_bio WHERE user_id = ?').get(userId)) as
    | { title: string; bio: string; avatar_url: string | null; published: number }
    | undefined;
  const links = (await getDb()
    .prepare('SELECT id FROM links WHERE user_id = ? AND bio_position IS NOT NULL ORDER BY bio_position ASC')
    .all(userId)) as Array<{ id: string }>;
  return {
    title: row?.title ?? '',
    bio: row?.bio ?? '',
    avatarUrl: row?.avatar_url ?? null,
    published: row?.published === 1,
    linkIds: links.map((l) => l.id),
  };
}

export interface BioEditorLink {
  id: string;
  label: string;
  short: string;
  archived: boolean;
}

function toEditorLink(l: LinkWithDomain): BioEditorLink {
  return { id: l.id, label: l.title || l.url, short: linkShortUrl(l), archived: l.archived === 1 };
}

/**
 * Links para el editor: todos los ya elegidos (aunque sean viejos o estén
 * archivados, así se pueden quitar y reordenar) + los `recent` activos más
 * nuevos. El resto se busca desde el editor.
 */
export async function bioEditorLinks(userId: string, recent = 50): Promise<BioEditorLink[]> {
  const db = getDb();
  const chosen = (await db
    .prepare(
      `SELECT l.*, d.hostname AS domain_hostname FROM links l LEFT JOIN link_domains d ON d.id = l.domain_id
       WHERE l.user_id = ? AND l.bio_position IS NOT NULL ORDER BY l.bio_position ASC`,
    )
    .all(userId)) as LinkWithDomain[];
  const latest = (await db
    .prepare(
      `SELECT l.*, d.hostname AS domain_hostname FROM links l LEFT JOIN link_domains d ON d.id = l.domain_id
       WHERE l.user_id = ? AND l.bio_position IS NULL AND l.archived = 0 ORDER BY l.created_at DESC, l.id LIMIT ?`,
    )
    .all(userId, recent)) as LinkWithDomain[];
  return [...chosen, ...latest].map(toEditorLink);
}

export async function saveBioSettings(userId: string, input: BioSettings): Promise<void> {
  const db = getDb();
  await db
    .prepare(
      `INSERT INTO link_bio (user_id, title, bio, avatar_url, published, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (user_id) DO UPDATE SET title = excluded.title, bio = excluded.bio,
         avatar_url = excluded.avatar_url, published = excluded.published, updated_at = excluded.updated_at`,
    )
    .run(userId, input.title, input.bio, input.avatarUrl, input.published ? 1 : 0);
  await db.prepare('UPDATE links SET bio_position = NULL WHERE user_id = ?').run(userId);
  for (let i = 0; i < input.linkIds.length; i++) {
    // Solo links propios: el WHERE user_id evita colar links de otros.
    await db.prepare('UPDATE links SET bio_position = ? WHERE id = ? AND user_id = ?').run(i, input.linkIds[i], userId);
  }
}

/** Datos públicos de /@handle (null si no existe o no está publicada). */
export async function getPublicBio(handle: string): Promise<PublicBio | null> {
  const db = getDb();
  const user = (await db.prepare('SELECT id, handle, name FROM users WHERE handle = ?').get(handle.toLowerCase())) as
    | { id: string; handle: string; name: string | null }
    | undefined;
  if (!user) return null;
  const bio = (await db.prepare('SELECT * FROM link_bio WHERE user_id = ? AND published = 1').get(user.id)) as
    | { title: string; bio: string; avatar_url: string | null }
    | undefined;
  if (!bio) return null;
  const links = (await db
    .prepare(
      `SELECT l.*, d.hostname AS domain_hostname FROM links l LEFT JOIN link_domains d ON d.id = l.domain_id
       WHERE l.user_id = ? AND l.bio_position IS NOT NULL AND l.archived = 0
         AND l.password_hash IS NULL AND (l.expires_at IS NULL OR l.expires_at > ?)
         AND (l.max_clicks IS NULL OR l.clicks < l.max_clicks)
       ORDER BY l.bio_position ASC`,
    )
    .all(user.id, new Date().toISOString())) as LinkWithDomain[];
  return {
    handle: user.handle,
    title: bio.title || user.name || `@${user.handle}`,
    bio: bio.bio,
    avatarUrl: bio.avatar_url,
    // Cada botón pasa por el link corto: los clicks se cuentan como siempre.
    links: links.map((l) => ({ id: l.id, title: l.title || l.url.replace(/^https?:\/\//, ''), href: linkShortUrl(l) })),
  };
}
