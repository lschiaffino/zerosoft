/**
 * "Mis pedidos": los pedidos de funciones de una persona (lo que le pidió al
 * asistente o mandó como idea), con un link que puede abrir.
 *
 * - Si el ítem está publicado en el board, el link es su página pública.
 * - Si no (lo normal: un pedido puede tener datos del cliente o internos), es
 *   /app/settings/requests/<id>, que solo ven quienes lo pidieron (una señal
 *   de feedback suya vinculada al ítem) y los admins. El resto recibe el
 *   mismo 404 que un id que no existe.
 *
 * Privacidad: la página muestra las palabras de quien mira, nunca las de otra
 * persona; tampoco quién más lo pidió, sus workspaces, la descripción del ítem
 * (que puede ser el texto de otra persona) ni las notas internas de los
 * cambios de estado. Si el ítem es privado, el título que se ve es el de la
 * propia persona (el del ítem pudo escribirlo otra).
 */
import { getDb } from './db';
import type { RoadmapItemRow } from './db';
import { absoluteBoardUrl, absoluteItemUrl } from './board-urls';
import { isPublicStatus } from './roadmap-constants';
import { isAdminEmail } from './feedback';
import type { SessionUser } from './session';

export const REQUESTS_PATH = '/app/settings/requests';
const TITLE_MAX = 140;
const WORDS_MAX = 2000;

/** Estados en lenguaje común (claves de settings.requests.status). */
export type RequestStage = 'received' | 'considering' | 'planned' | 'in_progress' | 'shipped' | 'declined';

export function requestStage(status: string): RequestStage {
  if (status === 'done') return 'shipped';
  if (status === 'declined') return 'declined';
  if (status === 'planned') return 'planned';
  if (status === 'in_progress') return 'in_progress';
  if (status === 'idea' || status === 'considering') return 'considering';
  return 'received';
}

/** Path de la página privada del pedido, sin locale (para Link y notificaciones in-app). */
export function requestPath(itemId: string): string {
  return `${REQUESTS_PATH}/${encodeURIComponent(itemId)}`;
}

export function isPublishedItem(item: Pick<RoadmapItemRow, 'is_public' | 'status'>): boolean {
  return Number(item.is_public) === 1 && isPublicStatus(item.status);
}

/**
 * El link que se comparte por un pedido: la página pública si el ítem está
 * publicado (absoluta, en el board), si no la página privada dentro de la app
 * (relativa, con locale: abre en la misma pestaña desde el asistente).
 */
export function requestLink(
  item: Pick<RoadmapItemRow, 'id' | 'title' | 'is_public' | 'status'>,
  locale: string,
): { url: string; published: boolean } {
  if (isPublishedItem(item)) return { url: absoluteItemUrl(locale, item.id, item.title), published: true };
  return { url: `/${locale}${requestPath(item.id)}`, published: false };
}

/** El changelog del board con el ancla de la entrada (o null). */
export function changelogUrl(locale: string, changelogId: string | null | undefined): string | null {
  return changelogId ? `${absoluteBoardUrl(locale, '/changelog')}#${changelogId}` : null;
}

export interface RequestPerson {
  id: string;
  email?: string | null;
}

function clean(text: string, max: number): string {
  const c = text.replace(/\s+/g, ' ').trim();
  return c.length > max ? `${c.slice(0, max - 1).trimEnd()}…` : c;
}

/** Primera línea del mensaje (el título que escribió la persona o el asistente por ella). */
function firstLine(message: string): string {
  return clean(message.split('\n')[0] ?? message, TITLE_MAX);
}

/** Lo que la persona escribió debajo del título (sin el título repetido). */
function ownWords(message: string): string {
  const [, ...rest] = message.split('\n');
  const body = rest.join('\n').trim();
  return (body || message).slice(0, WORDS_MAX).trim();
}

/** Feedback de la persona vinculado como señal (por user_id, o por email si lo mandó sin sesión). */
const MINE_SQL = `(f.user_id = ? OR (f.user_id IS NULL AND ? != '' AND lower(f.email) = ?))`;
function mineArgs(person: RequestPerson): string[] {
  const email = (person.email ?? '').trim().toLowerCase();
  return [person.id, email, email];
}

export interface MyRequestRow {
  id: string;
  title: string;
  stage: RequestStage;
  status: string;
  statusChangedAt: string | null;
  askedAt: string;
  published: boolean;
  /** Link para compartir (público si está publicado, si no la página privada). */
  url: string;
  /** Página del pedido en la app (siempre la privada). */
  path: string;
}

type JoinedRow = Pick<RoadmapItemRow, 'id' | 'title' | 'status' | 'is_public' | 'status_changed_at' | 'created_at' | 'shipped_changelog_id' | 'declined_reason'> & {
  message: string;
  asked_at: string;
};

/** Los pedidos de la persona, el más reciente primero. Nunca devuelve datos de otra persona. */
export async function listMyRequests(person: RequestPerson | null, locale: string, opts: { limit?: number } = {}): Promise<MyRequestRow[]> {
  if (!person?.id) return [];
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const rows = (await getDb()
    .prepare(
      `SELECT i.id, i.title, i.status, i.is_public, i.status_changed_at, i.created_at, i.shipped_changelog_id, i.declined_reason,
              f.message, f.created_at AS asked_at
       FROM roadmap_items i
       JOIN roadmap_signals s ON s.item_id = i.id AND s.source = 'feedback'
       JOIN feedback f ON f.id = s.source_id
       WHERE i.kind = 'idea' AND ${MINE_SQL}
       ORDER BY f.created_at ASC`,
    )
    .all(...mineArgs(person))) as JoinedRow[];
  // Una fila por ítem: el título del primer pedido propio, la fecha del último.
  const byItem = new Map<string, MyRequestRow>();
  for (const r of rows) {
    const existing = byItem.get(r.id);
    if (existing) {
      existing.askedAt = r.asked_at;
      continue;
    }
    const published = isPublishedItem(r);
    byItem.set(r.id, {
      id: r.id,
      title: published ? r.title : firstLine(r.message),
      stage: requestStage(r.status),
      status: r.status,
      statusChangedAt: r.status_changed_at,
      askedAt: r.asked_at,
      published,
      url: requestLink(r, locale).url,
      path: requestPath(r.id),
    });
  }
  return [...byItem.values()].sort((a, b) => b.askedAt.localeCompare(a.askedAt)).slice(0, limit);
}

export interface RequestView {
  id: string;
  title: string;
  stage: RequestStage;
  statusChangedAt: string | null;
  /** Palabras de quien mira (vacío si es un admin que no lo pidió). */
  words: Array<{ text: string; at: string }>;
  isRequester: boolean;
  /** Página pública si el ítem está publicado. */
  publicUrl: string | null;
  changelogUrl: string | null;
  /** Motivo del cierre: solo si el ítem es público (ya se ve en el board); en uno privado puede ser interno. */
  declinedReason: string | null;
  /** Solo admins: link al ítem en el admin del roadmap. */
  adminPath: string | null;
}

/**
 * La página de un pedido para quien mira: quien lo pidió o un admin. Para
 * cualquier otra persona (o un id que no existe) devuelve null y la página
 * responde 404, igual en los dos casos.
 */
export async function getRequestView(
  itemId: string,
  viewer: RequestPerson & { isAdmin: boolean },
  locale: string,
): Promise<RequestView | null> {
  if (!itemId || !viewer.id) return null;
  const db = getDb();
  const item = (await db.prepare('SELECT * FROM roadmap_items WHERE id = ?').get(itemId)) as RoadmapItemRow | undefined;
  if (!item) return null;
  const mine = (await db
    .prepare(
      `SELECT f.message, f.created_at FROM roadmap_signals s JOIN feedback f ON f.id = s.source_id
       WHERE s.item_id = ? AND s.source = 'feedback' AND ${MINE_SQL}
       ORDER BY f.created_at ASC`,
    )
    .all(itemId, ...mineArgs(viewer))) as Array<{ message: string; created_at: string }>;
  const isRequester = mine.length > 0;
  if (!isRequester && !viewer.isAdmin) return null;
  const published = isPublishedItem(item);
  return {
    id: item.id,
    title: published || !isRequester ? item.title : firstLine(mine[0].message),
    stage: requestStage(item.status),
    statusChangedAt: item.status_changed_at ?? item.created_at,
    words: mine.map((m) => ({ text: ownWords(m.message), at: m.created_at })),
    isRequester,
    publicUrl: published ? absoluteItemUrl(locale, item.id, item.title) : null,
    changelogUrl: item.status === 'done' ? changelogUrl(locale, item.shipped_changelog_id) : null,
    declinedReason: published && item.status === 'declined' ? item.declined_reason : null,
    adminPath: viewer.isAdmin ? `/app/settings/roadmap?item=${encodeURIComponent(item.id)}` : null,
  };
}

/**
 * Lo que usa la página /app/settings/requests/<id>: la persona real de la
 * sesión (en un workspace ajeno, actingUser) y si es admin. null = 404.
 */
export async function requestViewForSession(user: SessionUser, itemId: string, locale: string): Promise<RequestView | null> {
  const person = user.actingUser ?? user;
  return getRequestView(itemId, { id: person.id, email: person.email, isAdmin: isAdminEmail(person.email) }, locale);
}

/**
 * Quienes pidieron el ítem (con sesión) y siguen suscriptos: los destinatarios
 * del aviso de "ya salió" de un ítem privado. Cada uno con su propio título
 * (el de su primer pedido), nunca el de otra persona.
 */
export async function activeRequesterSubscribers(itemId: string): Promise<Array<{ user_id: string; email: string; locale: string; title: string }>> {
  const rows = (await getDb()
    .prepare(
      `SELECT sub.user_id, u.email, sub.locale, f.message, f.created_at
       FROM roadmap_subscriptions sub
       JOIN users u ON u.id = sub.user_id
       JOIN roadmap_signals s ON s.item_id = sub.item_id AND s.source = 'feedback'
       JOIN feedback f ON f.id = s.source_id AND f.user_id = sub.user_id
       WHERE sub.item_id = ? AND sub.active = 1
       ORDER BY f.created_at ASC`,
    )
    .all(itemId)) as Array<{ user_id: string; email: string; locale: string; message: string }>;
  const out = new Map<string, { user_id: string; email: string; locale: string; title: string }>();
  for (const r of rows) if (!out.has(r.user_id)) out.set(r.user_id, { user_id: r.user_id, email: r.email, locale: r.locale, title: firstLine(r.message) });
  return [...out.values()];
}
