import {
  getDb,
  getUserById,
  type DocsCommentRow,
  type DocsPageRow,
  type DocsShareRow,
  type DocsTemplateRow,
  type TeamRow,
  type UserRow,
} from './db';
import { sanitizeBlocks } from './docs-sanitize';
import { normalizeStructure } from './docs-columns';
import { persistSyncedBlocks } from './docs-synced';
import { syncDocReminders } from './docs-reminders';
import { pageLinkIds, type PageLinkCandidate } from './docs-page-links';
import { databaseRowEntries } from './docs-database';
import { applySamePageRows, prepareDatabaseSave, type DbEffect } from './docs-db-save';
import { mergeBlocks, mergeField } from './docs-merge';
import { getRevision, recordRevisions } from './docs-revisions';
import {
  buildSnippet,
  matchesAll,
  pageSearchText,
  prefilterTerm,
  rankHits,
  searchTokens,
  type DocsSearchHit,
} from './docs-search';
import { isMember, listMembers, listOwnedTeams } from './teams';
import {
  type DocsAccess,
  type DocsBlock,
  type DocsBlockType,
  type DocsComment,
  type DocsMentionableUser,
  type DocsPage,
  type DocsPageShare,
  type DocsPageSummary,
  type DocsShareRole,
  type DocsWorkspaceTemplate,
  defaultBlocks,
  mergeInheritedShares,
  stringifyBlocks,
  withDatabaseBodies,
} from './docs-types';

export type { DocsBlock, DocsBlockType, DocsComment, DocsPage, DocsPageShare, DocsPageSummary };
export { defaultBlocks, stringifyBlocks } from './docs-types';

// ---------- Helpers JSON ----------

export function parseBlocks(raw: string | null | undefined): DocsBlock[] {
  if (!raw || raw === 'null') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as DocsBlock[];
    return [];
  } catch {
    return [];
  }
}

export function toDocPage(row: DocsPageRow): DocsPage {
  return {
    id: row.id,
    user_id: row.user_id,
    parent_id: row.parent_id,
    title: row.title,
    icon: row.icon,
    cover_url: row.cover_url,
    content: parseBlocks(row.content),
    is_public: row.is_public === 1,
    published: row.published === 1,
    slug: row.slug ?? null,
    archived: row.archived === 1,
    small_text: row.small_text === 1,
    full_width: row.full_width === 1,
    position: row.position ?? null,
    inherit_shares: row.inherit_shares !== 0,
    cover_position: row.cover_position ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toShare(row: DocsShareRow): DocsPageShare {
  return { ...row, role: row.role === 'edit' ? 'edit' : 'view' };
}

/** "Cómo empezar ¿rápido?" → "como-empezar-rapido". */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/** Slug libre dentro del workspace (base, base-2, base-3…). */
async function uniqueSlug(ownerId: string, pageId: string, title: string): Promise<string> {
  const base = slugifyTitle(title) || `page-${pageId.slice(0, 8)}`;
  const taken = new Set(
    ((await getDb()
      .prepare('SELECT slug FROM docs_pages WHERE user_id = ? AND slug IS NOT NULL AND id != ?')
      .all(ownerId, pageId)) as Array<{ slug: string }>).map((r) => r.slug),
  );
  let candidate = base;
  for (let i = 2; taken.has(candidate); i++) candidate = `${base}-${i}`;
  return candidate;
}

// ---------- Permisos ----------

export interface DocsActor {
  id: string; // owner workspace id (datos viven bajo este id)
  actingUser?: UserRow; // usuario real cuando actúa en un team ajeno
  team?: TeamRow | null;
}

/**
 * Acceso efectivo del actor a una página (null = sin acceso).
 * - Owner del workspace: 'owner'.
 * - Shares: por usuario real (target_id = id de la persona) o por team del
 *   que es miembro; gana el rol más alto ('edit' > 'view'). Cuentan los de la
 *   página y los heredados de sus ancestros (ver listEffectiveDocShares).
 * - Publicada en el centro de ayuda: cualquiera autenticado puede leerla.
 * `is_public` ya NO da lectura: solo habilita a la IA del Chat.
 *
 * `includePublished: false` ignora la publicación: el centro de ayuda solo
 * expone el contenido actual, no el historial, los comentarios ni las
 * menciones (eso exige ser owner o tener un share explícito).
 * `includePublicLink: false` ignora además el share "cualquiera con el link"
 * (para escrituras como comentar o resolver hilos).
 */
export interface DocAccessOptions {
  includePublished?: boolean;
  includePublicLink?: boolean;
}

/** Historial y comentarios: owner o share explícito (no alcanza con publicada). */
export const DOC_INTERNAL_READ: DocAccessOptions = { includePublished: false };
/** Comentar, resolver y mencionar: share de persona/team (ni publicada ni link público). */
export const DOC_INTERNAL_WRITE: DocAccessOptions = { includePublished: false, includePublicLink: false };

export async function getDocAccess(
  page: DocsPageRow,
  actor: DocsActor,
  opts: DocAccessOptions = {},
): Promise<DocsAccess | null> {
  const includePublished = opts.includePublished ?? true;
  const includePublicLink = opts.includePublicLink ?? true;
  if (page.user_id === actor.id) return 'owner';
  const userId = actor.actingUser?.id ?? actor.id;
  const shares = await listEffectiveDocShares(page);
  let access: DocsAccess | null = null;
  for (const share of shares) {
    let match = false;
    if (share.kind === 'public') match = includePublicLink;
    else if (share.kind === 'user' && share.target_id === userId) match = true;
    else if (share.kind === 'team' && share.target_id) match = await isMember(share.target_id, userId);
    if (!match) continue;
    if (share.role === 'edit' && share.kind !== 'public') return 'edit';
    access = 'view';
  }
  if (!access && includePublished && page.published === 1 && page.archived === 0) access = 'view';
  return access;
}

/** Fila + acceso del actor, o null si la página no existe o no la puede ver. */
export async function resolveDocAccess(
  actor: DocsActor,
  pageId: string,
  opts: DocAccessOptions = {},
): Promise<{ row: DocsPageRow; access: DocsAccess } | null> {
  const row = (await getDb().prepare('SELECT * FROM docs_pages WHERE id = ?').get(pageId)) as
    | DocsPageRow
    | undefined;
  if (!row) return null;
  const access = await getDocAccess(row, actor, opts);
  return access ? { row, access } : null;
}

/** Tope de links `[[` que se resuelven uno por uno para un invitado. */
const LINK_TITLES_MAX = 200;

/**
 * Título actual de cada página linkeada (`[[`) en `blocks` que el actor puede
 * abrir. Para el dueño del workspace sale de una sola consulta; para un
 * invitado se chequea el acceso de cada página linkeada, así el título solo
 * se revela si esa página también la puede ver. Las demás quedan fuera del
 * Map (el link conserva el título con que se insertó).
 */
export async function readableLinkTitles(
  actor: DocsActor,
  page: Pick<DocsPageRow, 'user_id'>,
  blocks: DocsBlock[],
): Promise<Map<string, string>> {
  const ids: string[] = [];
  for (const b of withDatabaseBodies(blocks)) {
    if (!b.content) continue;
    for (const id of pageLinkIds(b.content)) if (!ids.includes(id)) ids.push(id);
  }
  const titles = new Map<string, string>();
  if (ids.length === 0) return titles;
  if (page.user_id === actor.id) {
    for (const p of await listDocPageSummaries(actor.id)) if (ids.includes(p.id)) titles.set(p.id, p.title);
    return titles;
  }
  for (const id of ids.slice(0, LINK_TITLES_MAX)) {
    const res = await resolveDocAccess(actor, id);
    if (res && res.row.archived === 0) titles.set(id, res.row.title);
  }
  return titles;
}

/** Verifica si el actor puede leer una página (ver getDocAccess). */
export async function canReadPage(
  page: DocsPageRow,
  actor: DocsActor,
  opts: DocAccessOptions = {},
): Promise<boolean> {
  return (await getDocAccess(page, actor, opts)) !== null;
}

export async function canEditPage(page: DocsPageRow, actor: DocsActor): Promise<boolean> {
  const access = await getDocAccess(page, actor);
  return access === 'owner' || access === 'edit';
}

/**
 * Mencionables de una página: el dueño del workspace de la página y los
 * miembros de sus teams (los que la pueden abrir desde el workspace). Se arma
 * desde la página, no desde el team activo de quien escribe: un invitado de
 * otra empresa no notifica a sus compañeros (sin acceso) y sí puede mencionar
 * al equipo dueño.
 */
export async function listPageMentionables(page: Pick<DocsPageRow, 'user_id'>): Promise<DocsMentionableUser[]> {
  const out = new Map<string, DocsMentionableUser>();
  const owner = await getUserById(page.user_id);
  if (owner) out.set(owner.id, { id: owner.id, name: owner.name, email: owner.email });
  for (const team of await listOwnedTeams(page.user_id)) {
    for (const m of await listMembers(team.id)) {
      if (!out.has(m.user_id)) out.set(m.user_id, { id: m.user_id, name: m.name, email: m.email });
    }
  }
  return [...out.values()];
}

// ---------- CRUD ----------

export async function listDocPages(
  ownerId: string,
  opts: { archived?: boolean } = {},
): Promise<DocsPage[]> {
  const archived = opts.archived ? 1 : 0;
  const rows = (await getDb()
    .prepare(
      // Orden manual primero (position), el resto como antes (más recientes arriba).
      'SELECT * FROM docs_pages WHERE user_id = ? AND archived = ? ORDER BY (position IS NULL) ASC, position ASC, updated_at DESC',
    )
    .all(ownerId, archived)) as DocsPageRow[];
  return rows.map(toDocPage);
}

/**
 * Igual que listDocPages pero sin content: para el sidebar y las listas, que
 * viajan al cliente en cada navegación (antes iba el contenido de todas las páginas).
 */
export async function listDocPageSummaries(
  ownerId: string,
  opts: { archived?: boolean; limit?: number; offset?: number } = {},
): Promise<DocsPageSummary[]> {
  const archived = opts.archived ? 1 : 0;
  // Sin limit trae todas (el árbol del sidebar las necesita enteras).
  const page = opts.limit != null ? ' LIMIT ? OFFSET ?' : '';
  const args: Array<string | number> = [ownerId, archived];
  if (opts.limit != null) args.push(opts.limit, opts.offset ?? 0);
  const rows = (await getDb()
    .prepare(
      `SELECT id, parent_id, title, icon, position, updated_at FROM docs_pages
       WHERE user_id = ? AND archived = ? ORDER BY (position IS NULL) ASC, position ASC, updated_at DESC, id${page}`,
    )
    .all(...args)) as DocsPageSummary[];
  return rows.map((r) => ({
    id: r.id,
    parent_id: r.parent_id ?? null,
    title: r.title,
    icon: r.icon ?? null,
    position: r.position ?? null,
    updated_at: r.updated_at,
  }));
}

/**
 * "Enlazada desde": páginas del workspace (no archivadas) con un link `[[` a
 * esta. El LIKE es un prefiltro barato; se confirma parseando los bloques.
 */
export async function listDocBacklinks(
  ownerId: string,
  pageId: string,
): Promise<Array<Pick<DocsPageSummary, 'id' | 'title' | 'icon'>>> {
  const rows = (await getDb()
    .prepare(
      `SELECT id, title, icon, content FROM docs_pages
       WHERE user_id = ? AND archived = 0 AND id != ? AND content LIKE ?
       ORDER BY updated_at DESC LIMIT 200`,
    )
    .all(ownerId, pageId, `%data-page=%${pageId}%`)) as Array<Pick<DocsPageRow, 'id' | 'title' | 'icon' | 'content'>>;
  return rows
    .filter((r) => withDatabaseBodies(parseBlocks(r.content)).some((b) => pageLinkIds(b.content).includes(pageId)))
    .slice(0, 50)
    .map((r) => ({ id: r.id, title: r.title, icon: r.icon ?? null }));
}

/** Páginas en la papelera (solo el número, para el link del sidebar). */
export async function countArchivedDocPages(ownerId: string): Promise<number> {
  const row = (await getDb()
    .prepare('SELECT COUNT(*) AS n FROM docs_pages WHERE user_id = ? AND archived = 1')
    .get(ownerId)) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

export async function getDocPage(
  ownerId: string,
  pageId: string,
): Promise<DocsPage | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ?')
    .get(pageId)) as DocsPageRow | undefined;
  if (!row) return null;
  if (row.user_id !== ownerId) return null;
  return toDocPage(row);
}

export interface CreateDocPageInput {
  title?: string;
  parent_id?: string | null;
  icon?: string | null;
  cover_url?: string | null;
  content?: DocsBlock[];
}

export async function createDocPage(
  ownerId: string,
  input: CreateDocPageInput,
): Promise<DocsPage> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = (input.title ?? '').trim();
  let parentId = input.parent_id ?? null;
  if (parentId) {
    // Solo se cuelga de páginas del mismo workspace.
    const parent = (await getDb()
      .prepare('SELECT user_id FROM docs_pages WHERE id = ?')
      .get(parentId)) as { user_id: string } | undefined;
    if (!parent || parent.user_id !== ownerId) parentId = null;
  }
  const icon = input.icon ?? null;
  const coverUrl = input.cover_url ?? null;
  const content = stringifyBlocks(cleanContent(input.content ?? defaultBlocks()));

  await getDb()
    .prepare(
      `INSERT INTO docs_pages (id, user_id, parent_id, title, icon, cover_url, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, ownerId, parentId, title, icon, coverUrl, content, now, now);

  const row = (await getDb().prepare('SELECT * FROM docs_pages WHERE id = ?').get(id)) as DocsPageRow;
  return toDocPage(row);
}

/** Bloques listos para guardar: saneados y con columnas/sincronizados válidos. */
export function cleanContent(blocks: DocsBlock[]): DocsBlock[] {
  return normalizeStructure(sanitizeBlocks(blocks), () => crypto.randomUUID());
}

export interface UpdateDocPageInput {
  cover_position?: number;
  title?: string;
  icon?: string | null;
  cover_url?: string | null;
  content?: DocsBlock[];
  parent_id?: string | null;
  is_public?: boolean;
  published?: boolean;
  archived?: boolean;
  small_text?: boolean;
  full_width?: boolean;
  /** Hereda los shares del padre (solo el dueño lo cambia). */
  inherit_shares?: boolean;
  /**
   * Concurrencia optimista: `updated_at` sobre el que el cliente hizo sus
   * cambios. Si la página cambió desde entonces (otra persona guardó o se
   * restauró una versión), se rechaza con DocsConflictError en vez de pisarla.
   */
  base_updated_at?: string;
  /**
   * "Sobrescribir" tras un conflicto: se fusiona igual (las bases por fila,
   * lo que no choca de los dos lados) y en lo que choca gana lo que llega.
   */
  merge?: 'ours';
}

/** La página cambió desde el `base_updated_at` que mandó el cliente. */
export class DocsConflictError extends Error {
  constructor() {
    super('docs_conflict');
    this.name = 'DocsConflictError';
  }
}

/** Opciones del guardado: quién edita (autor de filas) y dónde dejar las automatizaciones disparadas. */
export interface UpdateDocPageOptions {
  /** Quién guarda (autor de filas, bloques sincronizados y recordatorios). */
  actorId?: string | null;
  effects?: DbEffect[];
  /** Idioma y zona horaria de quien guarda (recordatorios). */
  locale?: string | null;
  timezone?: string | null;
  /**
   * Qué pasó con la base del guardado: `merged` = la página había cambiado y
   * se fusionó (la respuesta trae el contenido fusionado); `staleBase` = un
   * cambio sin contenido sobre una versión vieja (el editor no adelanta su base).
   */
  outcome?: { merged?: boolean; staleBase?: boolean };
}

export async function updateDocPage(
  ownerId: string,
  pageId: string,
  input: UpdateDocPageInput,
  opts: UpdateDocPageOptions = {},
): Promise<DocsPage | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ?')
    .get(pageId)) as DocsPageRow | undefined;
  if (!row || row.user_id !== ownerId) return null;
  let base = input.base_updated_at;
  let incoming = input.content !== undefined ? cleanContent(input.content) : undefined;
  const fields: { title?: string; icon?: string | null; cover_url?: string | null } = {
    title: input.title?.trim(),
    icon: input.icon,
    cover_url: input.cover_url,
  };
  if (base !== undefined && row.updated_at !== base) {
    // La página cambió desde la versión que vio el editor (otra pestaña, otra
    // persona, una automatización o una operación del servidor sobre una base):
    // se fusiona contra esa versión; solo es conflicto si chocan.
    const prefer = input.merge === 'ours' ? 'ours' : 'conflict';
    const rev = await getRevision(pageId, base);
    const touchesText = incoming !== undefined || fields.title !== undefined || fields.icon !== undefined || fields.cover_url !== undefined;
    if (touchesText) {
      if (!rev) {
        if (prefer !== 'ours') throw new DocsConflictError();
      } else {
        if (incoming !== undefined) {
          const merged = mergeBlocks(parseBlocks(rev.content), parseBlocks(row.content), incoming, prefer);
          if (!merged) throw new DocsConflictError();
          incoming = merged;
        }
        for (const k of ['title', 'icon', 'cover_url'] as const) {
          if (fields[k] === undefined) continue;
          const m = mergeField<string | null>(k === 'title' ? rev.title.trim() : (rev[k] ?? null), k === 'title' ? row.title : (row[k] ?? null), fields[k] ?? null, prefer);
          if (!m) throw new DocsConflictError();
          (fields as Record<string, string | null>)[k] = k === 'title' ? (m.value ?? '') : m.value;
        }
        if (opts.outcome) opts.outcome.merged = true;
      }
    } else if (opts.outcome) {
      opts.outcome.staleBase = true;
    }
    // Lo fusionado se guarda sobre la versión actual (si otro guardado se cuela, 409).
    base = row.updated_at;
  }

  // Re-parentar: el nuevo padre tiene que ser del mismo workspace y no puede
  // ser la propia página ni una de sus descendientes (armaría un ciclo y el
  // subárbol desaparecería del árbol y del centro de ayuda).
  if (input.parent_id != null && input.parent_id !== row.parent_id) {
    if (input.parent_id === pageId) return null;
    const parent = (await getDb()
      .prepare('SELECT user_id FROM docs_pages WHERE id = ?')
      .get(input.parent_id)) as { user_id: string } | undefined;
    if (!parent || parent.user_id !== ownerId) return null;
    if ((await collectDescendants(ownerId, pageId)).includes(input.parent_id)) return null;
  }

  const updates: string[] = [];
  const args: (string | number | null)[] = [];

  if (fields.title !== undefined) {
    updates.push('title = ?');
    args.push(fields.title);
  }
  if (fields.icon !== undefined) {
    updates.push('icon = ?');
    args.push(fields.icon);
  }
  if (fields.cover_url !== undefined) {
    updates.push('cover_url = ?');
    args.push(fields.cover_url);
  }
  let savedContent: DocsBlock[] | null = null;
  if (incoming !== undefined) {
    // Bases: autor de cada fila y automatizaciones contra lo guardado.
    const saved = prepareDatabaseSave(pageId, parseBlocks(row.content), incoming, opts.actorId ?? null);
    // "Agregar fila" hacia otra base de esta página: en el mismo guardado (y
    // sus automatizaciones, hasta tres vueltas). La respuesta trae las filas.
    let blocksOut = saved.blocks;
    let pending = saved.effects;
    for (let round = 0; round < 3 && pending.length; round++) {
      const local = applySamePageRows(pageId, blocksOut, pending);
      opts.effects?.push(...local.effects);
      pending = [];
      if (!local.changed) break;
      if (opts.outcome) opts.outcome.merged = true;
      const again = prepareDatabaseSave(pageId, blocksOut, local.blocks, opts.actorId ?? null);
      blocksOut = again.blocks;
      pending = again.effects;
    }
    opts.effects?.push(...pending);
    // Bloques sincronizados: lo editado adentro se escribe en su tabla.
    savedContent = await persistSyncedBlocks({
      workspaceId: ownerId,
      pageId,
      actorId: opts.actorId ?? null,
      previous: parseBlocks(row.content),
      next: blocksOut,
    });
    updates.push('content = ?');
    args.push(stringifyBlocks(savedContent));
  }
  if (input.cover_position !== undefined) {
    updates.push('cover_position = ?');
    args.push(Math.max(0, Math.min(100, Math.round(input.cover_position))));
  }
  if (input.parent_id !== undefined) {
    updates.push('parent_id = ?');
    args.push(input.parent_id);
    // Cambiar de padre descarta el orden manual del grupo anterior.
    if (input.parent_id !== row.parent_id) updates.push('position = NULL');
  }
  if (input.small_text !== undefined) {
    updates.push('small_text = ?');
    args.push(input.small_text ? 1 : 0);
  }
  if (input.full_width !== undefined) {
    updates.push('full_width = ?');
    args.push(input.full_width ? 1 : 0);
  }
  if (input.inherit_shares !== undefined) {
    updates.push('inherit_shares = ?');
    args.push(input.inherit_shares ? 1 : 0);
  }
  if (input.is_public !== undefined) {
    updates.push('is_public = ?');
    args.push(input.is_public ? 1 : 0);
  }
  if (input.published !== undefined) {
    updates.push('published = ?');
    args.push(input.published ? 1 : 0);
    if (input.published && row.published !== 1) {
      // El slug se fija al publicar por primera vez y queda estable (los
      // links del centro de ayuda no se rompen al renombrar la página).
      if (!row.slug) {
        updates.push('slug = ?');
        args.push(await uniqueSlug(ownerId, pageId, input.title ?? row.title));
      }
      updates.push('published_at = ?');
      args.push(new Date().toISOString());
    }
  }
  if (input.archived !== undefined) {
    // Archivada o restaurada a mano: ya no depende de la cascada de un ancestro.
    updates.push('archived = ?', 'archived_by_parent = 0');
    args.push(input.archived ? 1 : 0);
    // Restaurar una subpágina cuyo padre sigue en la papelera: pasa a la raíz.
    // Si no, quedaba colgando de un padre archivado y el borrado definitivo
    // del padre se la llevaba aunque estuviera activa.
    if (!input.archived && row.archived === 1 && row.parent_id && input.parent_id === undefined) {
      const parent = (await getDb()
        .prepare('SELECT archived FROM docs_pages WHERE id = ?')
        .get(row.parent_id)) as { archived: number } | undefined;
      if (parent?.archived === 1) updates.push('parent_id = NULL', 'position = NULL');
    }
  }

  if (updates.length === 0) return toDocPage(row);

  const updatedAt = new Date().toISOString();
  updates.push('updated_at = ?');
  args.push(updatedAt);
  args.push(pageId);
  if (base !== undefined) args.push(base);

  const result = await getDb()
    .prepare(`UPDATE docs_pages SET ${updates.join(', ')} WHERE id = ?${base !== undefined ? ' AND updated_at = ?' : ''}`)
    .run(...args);
  // Otro guardado se coló entre el SELECT y el UPDATE.
  if (base !== undefined && result.changes === 0) throw new DocsConflictError();
  await recordRevisions(row, {
    updated_at: updatedAt,
    title: fields.title ?? row.title,
    icon: fields.icon !== undefined ? fields.icon : row.icon,
    cover_url: fields.cover_url !== undefined ? fields.cover_url : row.cover_url,
    content: savedContent ? stringifyBlocks(savedContent) : row.content,
  }).catch(() => undefined);

  // Recordatorios de las menciones de fecha: la tabla queda igual al contenido.
  if (savedContent && opts.actorId) {
    await syncDocReminders({
      pageId,
      workspaceId: ownerId,
      actorId: opts.actorId,
      blocks: savedContent,
      locale: opts.locale,
      timezone: opts.timezone,
    }).catch(() => undefined);
  }

  // Papelera: archivar/restaurar arrastra a las subpáginas (si no, quedaban
  // huérfanas en la raíz del árbol al mandar el padre a la papelera).
  // Se marca cuáles archivó la cascada: al restaurar vuelven solo esas, no las
  // que ya estaban en la papelera por su cuenta (podían estar publicadas).
  if (input.archived !== undefined && (row.archived === 1) !== input.archived) {
    if (input.archived) {
      const ids = (await collectDescendants(ownerId, pageId)).filter((x) => x !== pageId);
      if (ids.length > 0) {
        await getDb()
          .prepare(
            `UPDATE docs_pages SET archived = 1, archived_by_parent = 1
             WHERE archived = 0 AND id IN (${ids.map(() => '?').join(',')})`,
          )
          .run(...ids);
      }
    } else {
      const ids = await collectCascadeArchived(ownerId, pageId);
      if (ids.length > 0) {
        await getDb()
          .prepare(
            `UPDATE docs_pages SET archived = 0, archived_by_parent = 0
             WHERE id IN (${ids.map(() => '?').join(',')})`,
          )
          .run(...ids);
      }
    }
  }

  const updated = (await getDb().prepare('SELECT * FROM docs_pages WHERE id = ?').get(pageId)) as DocsPageRow;
  return toDocPage(updated);
}

/** Recupera la cadena de ancestros de una página (más cercano primero). */
export async function getDocPageAncestors(
  ownerId: string,
  pageId: string,
): Promise<DocsPage[]> {
  const ancestors: DocsPage[] = [];
  let currentId: string | null = pageId;
  const seen = new Set<string>();
  while (currentId) {
    const row = (await getDb()
      .prepare('SELECT * FROM docs_pages WHERE id = ? AND user_id = ?')
      .get(currentId, ownerId)) as DocsPageRow | undefined;
    if (!row || seen.has(row.id)) break;
    seen.add(row.id);
    ancestors.unshift(toDocPage(row));
    currentId = row.parent_id;
  }
  return ancestors;
}

/** Duplica una página y todos sus descendientes. */
export async function duplicateDocPage(
  ownerId: string,
  pageId: string,
): Promise<DocsPage | null> {
  const source = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ? AND user_id = ?')
    .get(pageId, ownerId)) as DocsPageRow | undefined;
  if (!source) return null;

  const idMap = new Map<string, string>();

  async function clone(currentId: string, newParentId: string | null): Promise<void> {
    const row = (await getDb()
      .prepare('SELECT * FROM docs_pages WHERE id = ? AND user_id = ?')
      .get(currentId, ownerId)) as DocsPageRow | undefined;
    if (!row) return;

    const newId = crypto.randomUUID();
    idMap.set(currentId, newId);
    const now = new Date().toISOString();
    await getDb()
      .prepare(
        `INSERT INTO docs_pages
         (id, user_id, parent_id, title, icon, cover_url, content, is_public, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId,
        ownerId,
        newParentId,
        `${row.title || 'Untitled'} (Copy)`,
        row.icon,
        row.cover_url,
        row.content,
        0,
        0,
        now,
        now,
      );

    const children = (await getDb()
      // Las subpáginas en la papelera no se copian (revivirían como activas).
      .prepare('SELECT id FROM docs_pages WHERE parent_id = ? AND user_id = ? AND archived = 0')
      .all(currentId, ownerId)) as Array<{ id: string }>;
    for (const child of children) {
      await clone(child.id, newId);
    }
  }

  await clone(pageId, source.parent_id);
  const newRootId = idMap.get(pageId);
  if (!newRootId) return null;
  return getDocPage(ownerId, newRootId);
}

/** Lista IDs descendientes de un árbol de páginas (incluye la raíz). */
export async function collectDescendants(ownerId: string, rootId: string): Promise<string[]> {
  const ids: string[] = [rootId];
  const queue: string[] = [rootId];
  // Defensa ante datos con ciclos de parent_id (no recorrer para siempre).
  const seen = new Set<string>([rootId]);
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const rows = (await getDb()
      .prepare('SELECT id FROM docs_pages WHERE user_id = ? AND parent_id = ?')
      .all(ownerId, parentId)) as Array<{ id: string }>;
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      ids.push(row.id);
      queue.push(row.id);
    }
  }
  return ids;
}

/**
 * Descendientes que mandó a la papelera la cascada de `rootId`: baja solo por
 * hijos con archived_by_parent = 1 (lo archivado por su cuenta, y lo que cuelga
 * de eso, se queda en la papelera).
 */
async function collectCascadeArchived(ownerId: string, rootId: string): Promise<string[]> {
  const ids: string[] = [];
  const queue: string[] = [rootId];
  const seen = new Set<string>([rootId]);
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const rows = (await getDb()
      .prepare(
        'SELECT id FROM docs_pages WHERE user_id = ? AND parent_id = ? AND archived = 1 AND archived_by_parent = 1',
      )
      .all(ownerId, parentId)) as Array<{ id: string }>;
    for (const child of rows) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      ids.push(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

/**
 * Subárbol archivado de una página archivada: baja solo por hijos archivados
 * y despega (parent_id = NULL) a los hijos activos que encuentra.
 */
async function collectArchivedSubtree(ownerId: string, rootId: string): Promise<string[]> {
  const ids: string[] = [rootId];
  const queue: string[] = [rootId];
  const seen = new Set<string>([rootId]);
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const rows = (await getDb()
      .prepare('SELECT id, archived FROM docs_pages WHERE user_id = ? AND parent_id = ?')
      .all(ownerId, parentId)) as Array<{ id: string; archived: number }>;
    for (const child of rows) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      if (child.archived !== 1) {
        await getDb()
          .prepare('UPDATE docs_pages SET parent_id = NULL, position = NULL WHERE id = ? AND user_id = ?')
          .run(child.id, ownerId);
        continue;
      }
      ids.push(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

export async function deleteDocPage(ownerId: string, pageId: string): Promise<boolean> {
  const row = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ?')
    .get(pageId)) as DocsPageRow | undefined;
  if (!row || row.user_id !== ownerId) return false;

  // Borrar para siempre desde la papelera solo se lleva lo que está en la
  // papelera: una subpágina ya restaurada (activa) se despega a la raíz junto
  // con su subárbol, si no el DELETE (y el ON DELETE CASCADE) la borraba.
  const ids = row.archived === 1 ? await collectArchivedSubtree(ownerId, pageId) : await collectDescendants(ownerId, pageId);
  const placeholders = ids.map(() => '?').join(',');
  await getDb()
    .prepare(`DELETE FROM docs_pages WHERE id IN (${placeholders})`)
    .run(...ids);
  return true;
}

export async function moveDocPage(
  ownerId: string,
  pageId: string,
  parentId: string | null,
): Promise<DocsPage | null> {
  return updateDocPage(ownerId, pageId, { parent_id: parentId });
}

export type DocDropPlacement = 'before' | 'after';

/**
 * Reordena una página entre sus hermanos: la ubica antes/después de `targetId`
 * (y pasa a ser hermana de target si tenía otro padre). Reescribe `position`
 * de todo el grupo. No toca updated_at (no es una edición de contenido).
 */
export async function reorderDocPage(
  ownerId: string,
  pageId: string,
  targetId: string,
  placement: DocDropPlacement,
): Promise<boolean> {
  if (pageId === targetId) return false;
  const db = getDb();
  const page = (await db.prepare('SELECT * FROM docs_pages WHERE id = ?').get(pageId)) as DocsPageRow | undefined;
  const target = (await db.prepare('SELECT * FROM docs_pages WHERE id = ?').get(targetId)) as DocsPageRow | undefined;
  if (!page || !target || page.user_id !== ownerId || target.user_id !== ownerId) return false;
  // No se puede colgar una página dentro de su propio subárbol.
  const descendants = await collectDescendants(ownerId, pageId);
  if (descendants.includes(targetId)) return false;

  const parentId = target.parent_id;
  const siblings = (await db
    .prepare(
      `SELECT id FROM docs_pages
       WHERE user_id = ? AND archived = ? AND ${parentId ? 'parent_id = ?' : 'parent_id IS NULL'} AND id != ?
       ORDER BY (position IS NULL) ASC, position ASC, updated_at DESC`,
    )
    .all(...[ownerId, target.archived, ...(parentId ? [parentId] : []), pageId])) as Array<{ id: string }>;
  const order = siblings.map((r) => r.id);
  const at = order.indexOf(targetId);
  order.splice(placement === 'before' ? at : at + 1, 0, pageId);

  if (page.parent_id !== parentId) {
    await db.prepare('UPDATE docs_pages SET parent_id = ? WHERE id = ? AND user_id = ?').run(parentId, pageId, ownerId);
  }
  for (const [i, id] of order.entries()) {
    await db.prepare('UPDATE docs_pages SET position = ? WHERE id = ? AND user_id = ?').run(i, id, ownerId);
  }
  return true;
}

/** "Move up / Move down": intercambia la página con su hermana anterior/siguiente. */
export async function moveDocPageStep(ownerId: string, pageId: string, dir: -1 | 1): Promise<boolean> {
  const db = getDb();
  const page = (await db.prepare('SELECT * FROM docs_pages WHERE id = ?').get(pageId)) as DocsPageRow | undefined;
  if (!page || page.user_id !== ownerId) return false;
  const siblings = (await db
    .prepare(
      `SELECT id FROM docs_pages
       WHERE user_id = ? AND archived = ? AND ${page.parent_id ? 'parent_id = ?' : 'parent_id IS NULL'}
       ORDER BY (position IS NULL) ASC, position ASC, updated_at DESC`,
    )
    .all(...[ownerId, page.archived, ...(page.parent_id ? [page.parent_id] : [])])) as Array<{ id: string }>;
  const idx = siblings.findIndex((r) => r.id === pageId);
  const neighbor = siblings[idx + dir];
  if (idx === -1 || !neighbor) return false;
  return reorderDocPage(ownerId, pageId, neighbor.id, dir === -1 ? 'before' : 'after');
}

// ---------- Shares ----------

export async function listDocShares(pageId: string): Promise<DocsPageShare[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM docs_shares WHERE page_id = ? ORDER BY created_at DESC')
    .all(pageId)) as DocsShareRow[];
  return rows.map(toShare);
}

/**
 * Cadena de herencia de shares: la página y sus ancestros (más cercano
 * primero) mientras cada eslabón herede. Una página con inherit_shares = 0
 * corta la cadena: cuentan sus shares pero no los de arriba.
 */
async function shareChain(page: DocsPageRow): Promise<DocsPageRow[]> {
  const chain: DocsPageRow[] = [page];
  const seen = new Set<string>([page.id]);
  let cur = page;
  while (cur.parent_id && cur.inherit_shares !== 0) {
    const parent = (await getDb()
      .prepare('SELECT * FROM docs_pages WHERE id = ? AND user_id = ?')
      .get(cur.parent_id, page.user_id)) as DocsPageRow | undefined;
    // Defensa ante ciclos de parent_id.
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    chain.push(parent);
    cur = parent;
  }
  return chain;
}

/**
 * Shares efectivos de una página: los propios y los heredados de sus
 * ancestros, con `inherited_from` diciendo de dónde viene cada uno. Para un
 * mismo destino gana el share más cercano (un share propio pisa al heredado,
 * así una subpágina puede bajar o subir el rol que da el padre).
 */
export async function listEffectiveDocShares(page: DocsPageRow): Promise<DocsPageShare[]> {
  const chain = await shareChain(page);
  const levels: Array<{ page: { id: string; title: string }; shares: DocsPageShare[] }> = [];
  for (const p of chain) {
    const rows = (await getDb()
      .prepare('SELECT * FROM docs_shares WHERE page_id = ? ORDER BY created_at DESC')
      .all(p.id)) as DocsShareRow[];
    levels.push({ page: { id: p.id, title: p.title }, shares: rows.map(toShare) });
  }
  return mergeInheritedShares(levels);
}

/**
 * Subpáginas activas que el actor puede abrir: para que un invitado navegue
 * el subárbol que le compartieron (no tiene el árbol del workspace ajeno).
 */
export async function listAccessibleSubpages(
  actor: DocsActor,
  pageId: string,
): Promise<Array<Pick<DocsPageSummary, 'id' | 'title' | 'icon'>>> {
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM docs_pages WHERE parent_id = ? AND archived = 0
       ORDER BY (position IS NULL) ASC, position ASC, updated_at DESC LIMIT 100`,
    )
    .all(pageId)) as DocsPageRow[];
  const out: Array<Pick<DocsPageSummary, 'id' | 'title' | 'icon'>> = [];
  for (const row of rows) {
    if (await getDocAccess(row, actor)) out.push({ id: row.id, title: row.title, icon: row.icon ?? null });
  }
  return out;
}

export async function createDocShare(
  ownerId: string,
  pageId: string,
  kind: 'public' | 'team' | 'user',
  targetId?: string | null,
  role: DocsShareRole = 'view',
): Promise<DocsPageShare | null> {
  const page = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ?')
    .get(pageId)) as DocsPageRow | undefined;
  if (!page || page.user_id !== ownerId) return null;
  const effectiveRole: DocsShareRole = kind === 'public' ? 'view' : role;

  // Compartir de nuevo con el mismo destino actualiza el rol (sin duplicar).
  const existing = (await getDb()
    .prepare('SELECT * FROM docs_shares WHERE page_id = ? AND kind = ? AND target_id IS ?')
    .get(pageId, kind, targetId ?? null)) as DocsShareRow | undefined;
  if (existing) {
    await getDb().prepare('UPDATE docs_shares SET role = ? WHERE id = ?').run(effectiveRole, existing.id);
    return toShare({ ...existing, role: effectiveRole });
  }

  const id = crypto.randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO docs_shares (id, page_id, kind, target_id, role) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, pageId, kind, targetId ?? null, effectiveRole);

  const row = (await getDb().prepare('SELECT * FROM docs_shares WHERE id = ?').get(id)) as DocsShareRow;
  return toShare(row);
}

export async function updateDocShareRole(
  ownerId: string,
  pageId: string,
  shareId: string,
  role: DocsShareRole,
): Promise<DocsPageShare | null> {
  const page = await getDocPageRow(pageId);
  if (!page || page.user_id !== ownerId) return null;
  const share = (await getDb()
    .prepare('SELECT * FROM docs_shares WHERE id = ? AND page_id = ?')
    .get(shareId, pageId)) as DocsShareRow | undefined;
  if (!share || share.kind === 'public') return null;
  await getDb().prepare('UPDATE docs_shares SET role = ? WHERE id = ?').run(role, shareId);
  return toShare({ ...share, role });
}

export interface SharedDocPage {
  id: string;
  title: string;
  icon: string | null;
  role: DocsShareRole;
  owner_name: string | null;
  owner_email: string;
  updated_at: string;
}

/**
 * Páginas de OTROS workspaces compartidas con la persona (directo o vía un
 * team del que es miembro). Las del workspace activo no se repiten.
 */
export async function listSharedWithMe(realUserId: string, workspaceId: string): Promise<SharedDocPage[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT p.id, p.title, p.icon, p.updated_at, s.role, u.name AS owner_name, u.email AS owner_email
       FROM docs_shares s
       JOIN docs_pages p ON p.id = s.page_id
       JOIN users u ON u.id = p.user_id
       WHERE p.archived = 0 AND p.user_id != ?
         AND ((s.kind = 'user' AND s.target_id = ?)
           OR (s.kind = 'team' AND s.target_id IN (
                 SELECT team_id FROM team_members WHERE user_id = ?
                 UNION SELECT id FROM teams WHERE owner_id = ?)))
       ORDER BY p.updated_at DESC
       LIMIT 200`,
    )
    .all(workspaceId, realUserId, realUserId, realUserId)) as Array<SharedDocPage & { role: string }>;
  const byId = new Map<string, SharedDocPage>();
  for (const r of rows) {
    const role: DocsShareRole = r.role === 'edit' ? 'edit' : 'view';
    const prev = byId.get(r.id);
    if (!prev || (prev.role === 'view' && role === 'edit')) byId.set(r.id, { ...r, role });
  }
  return [...byId.values()];
}

export async function deleteDocShare(
  ownerId: string,
  pageId: string,
  shareId: string,
): Promise<boolean> {
  const page = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ?')
    .get(pageId)) as DocsPageRow | undefined;
  if (!page || page.user_id !== ownerId) return false;

  const res = await getDb()
    .prepare('DELETE FROM docs_shares WHERE id = ? AND page_id = ?')
    .run(shareId, pageId);
  return res.changes > 0;
}

// ---------- Comments ----------

type DocsCommentJoinedRow = DocsCommentRow & {
  user_name: string | null;
  user_email: string;
  user_image: string | null;
};

function toComment(row: DocsCommentJoinedRow): DocsComment {
  return {
    id: row.id,
    page_id: row.page_id,
    user_id: row.user_id,
    block_id: row.block_id,
    parent_id: row.parent_id ?? null,
    body: row.body,
    resolved: row.resolved === 1,
    created_at: row.created_at,
    user_name: row.user_name,
    user_email: row.user_email,
    user_image: row.user_image,
  };
}

/** Fila cruda de una página (sin chequeo de owner) para permisos canRead/canEdit. */
export async function getDocPageRow(pageId: string): Promise<DocsPageRow | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ?')
    .get(pageId)) as DocsPageRow | undefined;
  return row ?? null;
}

export async function getDocComment(commentId: string): Promise<DocsComment | null> {
  const row = (await getDb()
    .prepare(
      `SELECT c.*, u.name AS user_name, u.email AS user_email, u.image AS user_image
       FROM docs_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = ?`,
    )
    .get(commentId)) as DocsCommentJoinedRow | undefined;
  return row ? toComment(row) : null;
}

export async function listDocComments(pageId: string): Promise<DocsComment[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT c.*, u.name AS user_name, u.email AS user_email, u.image AS user_image
       FROM docs_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.page_id = ?
       ORDER BY c.resolved ASC, c.created_at ASC`,
    )
    .all(pageId)) as DocsCommentJoinedRow[];
  return rows.map(toComment);
}

export async function createDocComment(
  pageId: string,
  userId: string,
  input: { body: string; block_id?: string | null; parent_id?: string | null },
): Promise<DocsComment> {
  const id = crypto.randomUUID();
  // Una respuesta cuelga siempre de la raíz del hilo (responder a una
  // respuesta no anida más) y hereda su bloque.
  let parentId: string | null = null;
  let blockId = input.block_id ?? null;
  if (input.parent_id) {
    const parent = await getDocComment(input.parent_id);
    if (!parent || parent.page_id !== pageId) throw new DocsCommentParentError();
    parentId = parent.parent_id ?? parent.id;
    const root = parentId === parent.id ? parent : await getDocComment(parentId);
    blockId = root?.block_id ?? null;
  }
  await getDb()
    .prepare(
      `INSERT INTO docs_comments (id, page_id, user_id, block_id, parent_id, body, resolved, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(id, pageId, userId, blockId, parentId, input.body.trim(), new Date().toISOString());
  // Responder reabre un hilo resuelto (como en Notion).
  if (parentId) {
    await getDb().prepare('UPDATE docs_comments SET resolved = 0 WHERE id = ? OR parent_id = ?').run(parentId, parentId);
  }
  return (await getDocComment(id))!;
}

/** parent_id de otra página o inexistente. */
export class DocsCommentParentError extends Error {
  constructor() {
    super('invalid_parent');
  }
}

/** Autores del hilo (raíz y respuestas), para avisar de una respuesta nueva. */
export async function listDocThreadParticipants(rootId: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare('SELECT DISTINCT user_id FROM docs_comments WHERE id = ? OR parent_id = ?')
    .all(rootId, rootId)) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

export async function setDocCommentResolved(
  commentId: string,
  resolved: boolean,
): Promise<DocsComment | null> {
  // Resolver una respuesta resuelve el hilo entero (el estado vive en la raíz).
  const comment = await getDocComment(commentId);
  if (!comment) return null;
  const rootId = comment.parent_id ?? comment.id;
  await getDb()
    .prepare('UPDATE docs_comments SET resolved = ? WHERE id = ? OR parent_id = ?')
    .run(resolved ? 1 : 0, rootId, rootId);
  return getDocComment(commentId);
}

export async function deleteDocComment(commentId: string): Promise<boolean> {
  // Borrar la raíz se lleva las respuestas (también sin FKs prendidas).
  await getDb().prepare('DELETE FROM docs_comments WHERE parent_id = ?').run(commentId);
  const res = await getDb().prepare('DELETE FROM docs_comments WHERE id = ?').run(commentId);
  return res.changes > 0;
}

// ---------- Plantillas del workspace ----------

function toWorkspaceTemplate(row: DocsTemplateRow): DocsWorkspaceTemplate {
  return {
    id: row.id,
    title: row.title,
    icon: row.icon,
    description: row.description,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

/** Tope de plantillas por workspace. */
export const DOCS_TEMPLATES_MAX = 100;

export class DocsTemplateLimitError extends Error {
  constructor() {
    super('template_limit');
  }
}

export async function listDocWorkspaceTemplates(workspaceId: string): Promise<DocsWorkspaceTemplate[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM docs_templates WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(workspaceId, DOCS_TEMPLATES_MAX)) as DocsTemplateRow[];
  return rows.map(toWorkspaceTemplate);
}

/**
 * Guarda una página del workspace como plantilla: copia título, ícono y
 * bloques tal como están ahora (cambios posteriores a la página no la tocan).
 * null si la página no es del workspace; DocsTemplateLimitError si se llegó al tope.
 */
export async function createDocWorkspaceTemplate(
  workspaceId: string,
  createdBy: string,
  input: { page_id: string; title?: string; description?: string },
): Promise<DocsWorkspaceTemplate | null> {
  const page = (await getDb()
    .prepare('SELECT * FROM docs_pages WHERE id = ? AND user_id = ?')
    .get(input.page_id, workspaceId)) as DocsPageRow | undefined;
  if (!page) return null;
  const count = (await getDb()
    .prepare('SELECT COUNT(*) AS c FROM docs_templates WHERE workspace_id = ?')
    .get(workspaceId)) as { c: number };
  if (Number(count.c) >= DOCS_TEMPLATES_MAX) throw new DocsTemplateLimitError();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = (input.title ?? '').trim() || page.title;
  await getDb()
    .prepare(
      `INSERT INTO docs_templates (id, workspace_id, created_by, title, icon, description, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      workspaceId,
      createdBy,
      title,
      page.icon,
      (input.description ?? '').trim(),
      stringifyBlocks(sanitizeBlocks(parseBlocks(page.content))),
      now,
      now,
    );
  const row = (await getDb().prepare('SELECT * FROM docs_templates WHERE id = ?').get(id)) as DocsTemplateRow;
  return toWorkspaceTemplate(row);
}

export async function deleteDocWorkspaceTemplate(workspaceId: string, templateId: string): Promise<boolean> {
  const res = await getDb()
    .prepare('DELETE FROM docs_templates WHERE id = ? AND workspace_id = ?')
    .run(templateId, workspaceId);
  return res.changes > 0;
}

/** Renombra una plantilla del workspace (el título vacío no se acepta). */
export async function renameDocWorkspaceTemplate(
  workspaceId: string,
  templateId: string,
  title: string,
): Promise<boolean> {
  const clean = title.trim().slice(0, 200);
  if (!clean) return false;
  const res = await getDb()
    .prepare('UPDATE docs_templates SET title = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
    .run(clean, new Date().toISOString(), templateId, workspaceId);
  return res.changes > 0;
}

/** Página nueva a partir de una plantilla del workspace (bloques con ids nuevos). */
export async function createDocPageFromWorkspaceTemplate(
  workspaceId: string,
  templateId: string,
): Promise<DocsPage | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM docs_templates WHERE id = ? AND workspace_id = ?')
    .get(templateId, workspaceId)) as DocsTemplateRow | undefined;
  if (!row) return null;
  const content = parseBlocks(row.content).map((b) => ({ ...b, id: crypto.randomUUID() }));
  return createDocPage(workspaceId, { title: row.title, icon: row.icon, content });
}

// ---------- Search / mentions ----------

export async function searchDocPages(
  ownerId: string,
  query: string,
): Promise<DocsPage[]> {
  const q = `%${query.trim().replace(/[%_]/g, '\\$&')}%`;
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM docs_pages
       WHERE user_id = ? AND archived = 0 AND title LIKE ? ESCAPE '\\'
       ORDER BY updated_at DESC
       LIMIT 20`,
    )
    .all(ownerId, q)) as DocsPageRow[];
  return rows.map(toDocPage);
}

/**
 * Búsqueda por título y por el texto de los bloques (párrafos, listas,
 * tablas, nombres de archivo). Prefiltro barato en SQL (LIKE sobre título o
 * content con la palabra más "buscable", ver prefilterTerm) y confirmación en
 * JS con todas las palabras, sin tildes ni mayúsculas. Título primero.
 */
export async function searchDocPagesContent(
  ownerId: string,
  query: string,
  limit = 20,
): Promise<DocsSearchHit[]> {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  const like = (v: string) => `%${v.replace(/[\\%_]/g, '\\$&')}%`;
  const term = prefilterTerm(query);
  type Row = Pick<DocsPageRow, 'id' | 'parent_id' | 'title' | 'icon' | 'content' | 'updated_at'>;
  const rows = (term
    ? await getDb()
        .prepare(
          `SELECT id, parent_id, title, icon, content, updated_at FROM docs_pages
           WHERE user_id = ? AND archived = 0 AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
           ORDER BY updated_at DESC LIMIT 300`,
        )
        .all(ownerId, like(term), like(term))
    : await getDb()
        .prepare(
          `SELECT id, parent_id, title, icon, content, updated_at FROM docs_pages
           WHERE user_id = ? AND archived = 0 AND title LIKE ? ESCAPE '\\'
           ORDER BY updated_at DESC LIMIT 300`,
        )
        .all(ownerId, like(query.trim()))) as Row[];

  const hits: DocsSearchHit[] = [];
  for (const r of rows) {
    const base = { id: r.id, parent_id: r.parent_id ?? null, title: r.title, icon: r.icon ?? null, updated_at: r.updated_at };
    const blocks = parseBlocks(r.content);
    // Filas de bases cuyo título matchea: se abren como página (?row=).
    if (r.content.includes('"database"')) {
      for (const e of databaseRowEntries(blocks)) {
        if (!matchesAll(e.title, tokens)) continue;
        hits.push({ ...base, icon: null, title: e.title, row_id: e.rowId, page_title: r.title, match: 'title', snippet: r.title || null });
      }
    }
    if (matchesAll(r.title, tokens)) {
      hits.push({ ...base, match: 'title', snippet: null });
      continue;
    }
    const text = pageSearchText(blocks);
    if (matchesAll(`${r.title} ${text}`, tokens)) {
      hits.push({ ...base, match: 'content', snippet: buildSnippet(text, tokens) });
    }
  }
  return rankHits(hits, limit);
}

/**
 * Filas de bases por título (popover `[[`): links a una fila. Prefiltro LIKE
 * sobre el content y confirmación con todas las palabras.
 */
export async function searchDocRows(ownerId: string, query: string, limit = 10): Promise<PageLinkCandidate[]> {
  const tokens = searchTokens(query);
  const term = prefilterTerm(query);
  if (tokens.length === 0 || !term) return [];
  const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = (await getDb()
    .prepare(
      `SELECT id, title, content FROM docs_pages
       WHERE user_id = ? AND archived = 0 AND content LIKE '%"database"%' AND content LIKE ? ESCAPE '\\'
       ORDER BY updated_at DESC LIMIT 100`,
    )
    .all(ownerId, like)) as Array<Pick<DocsPageRow, 'id' | 'title' | 'content'>>;
  const out: PageLinkCandidate[] = [];
  for (const r of rows) {
    for (const e of databaseRowEntries(parseBlocks(r.content))) {
      if (!matchesAll(e.title, tokens)) continue;
      out.push({ id: r.id, row_id: e.rowId, title: e.title, page_title: r.title, icon: null });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// ---------- Re-export tree helpers (pure, live in docs-types) ----------

export { buildPageTree, flattenPageTree } from './docs-types';
