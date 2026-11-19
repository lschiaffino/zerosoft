/**
 * Pedidos de funciones que toma el asistente (herramienta request_feature).
 *
 * Cuando alguien le pide al asistente algo que el producto todavía no hace,
 * el pedido entra al backlog interno en vez de quedar en un "no puedo":
 * - Se guarda como feedback (source 'assistant', con la persona y su
 *   workspace) y queda como señal de un ítem del roadmap. Así lo ven el admin
 *   del roadmap y del feedback (/app/settings/roadmap, /app/settings/feedback)
 *   y la persona en "Tus pedidos en revisión", como cualquier feedback.
 * - Si ya hay un ítem abierto que pide lo mismo (de esta persona o de otra),
 *   se suma una señal a ese ítem; si no, se crea uno nuevo en 'proposed', que
 *   es privado: nunca aparece en el board público hasta que un admin lo
 *   publica. Otro workspace no ve el texto de nadie.
 * - Si quien pide está en FEATURE_PRIORITY_EMAILS, el ítem queda con
 *   priority = 1 y aceptado ('planned', sigue privado si lo era).
 * - Con BACKLOG_GITHUB_REPO y BACKLOG_GITHUB_TOKEN, además se copia como
 *   issue (lib/feature-requests-github.ts) después de responder.
 */
import { getDb } from './db';
import type { RoadmapItemRow } from './db';
import { createFeedback, notifyFeedback, type FeedbackRow } from './feedback';
import { PRODUCT_KEYS, type ProductKey } from './product-taxonomy';
import { attachFeedbackToItem, getRoadmapItem, ingestFeedback, recordStatusEvent, roadmapTitleKey, runAfterResponse, updateRoadmapItem } from './roadmap';
import { ROADMAP_OPEN_STATUSES } from './roadmap-constants';
import { searchTerms, subscribe } from './board';
import { requestLink } from './my-requests';
import { syncBacklogIssue } from './feature-requests-github';

export const FEATURE_TITLE_MAX = 120;
export const FEATURE_DETAILS_MAX = 2000;
/** Parecido mínimo entre títulos (palabras en común / palabras de los dos) para sumar al mismo ítem. */
export const DUPLICATE_MIN_SIMILARITY = 0.6;

/** Emails (coma) cuyos pedidos van primero y siempre se construyen. Solo servidor. */
export function priorityEmails(): string[] {
  return (process.env.FEATURE_PRIORITY_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isPriorityEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return priorityEmails().includes(email.trim().toLowerCase());
}

function nowIso(): string {
  return new Date().toISOString();
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** Palabras de un título, con un plural simple recortado ("fields" = "field"). */
function stems(text: string): Set<string> {
  return new Set(searchTerms(text).map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)));
}

export function titleSimilarity(a: string, b: string): number {
  const x = stems(a);
  const y = stems(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  if (shared < 2 && !(x.size === 1 && y.size === 1 && shared === 1)) return 0;
  return shared / (x.size + y.size - shared);
}

/**
 * Ítem abierto (público o privado) que ya pide lo mismo: mismo título
 * normalizado, o títulos con la mayor parte de las palabras en común.
 */
export async function findDuplicateItem(title: string): Promise<Pick<RoadmapItemRow, 'id' | 'title' | 'is_public' | 'status'> | null> {
  const open = ROADMAP_OPEN_STATUSES.map((s) => `'${s}'`).join(', ');
  const db = getDb();
  const key = roadmapTitleKey(title);
  const terms = searchTerms(title);
  const conds = terms.map(() => "lower(title) LIKE ? ESCAPE '\\'");
  const args = terms.map((t) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const rows = (await db
    .prepare(
      `SELECT id, title, is_public, status FROM roadmap_items
       WHERE kind = 'idea' AND status IN (${open})${conds.length ? ` AND (${conds.join(' OR ')})` : ''}
       ORDER BY votes DESC, created_at DESC LIMIT 200`,
    )
    .all(...args)) as Array<Pick<RoadmapItemRow, 'id' | 'title' | 'is_public' | 'status'>>;
  const exact = rows.find((r) => roadmapTitleKey(r.title) === key);
  if (exact) return exact;
  let best: { row: (typeof rows)[number]; score: number } | null = null;
  for (const r of rows) {
    const score = titleSimilarity(title, r.title);
    if (score >= DUPLICATE_MIN_SIMILARITY && (!best || score > best.score)) best = { row: r, score };
  }
  return best?.row ?? null;
}

export interface FeatureRequester {
  /** Persona real (no el owner del workspace). */
  personId: string;
  email: string | null;
  workspaceId: string;
  /** Idioma de los avisos por email (en si falta). */
  locale?: string | null;
}

export interface FeatureRequestInput {
  title: string;
  details: string;
  product: string | null | undefined;
}

export interface FeatureRequestResult {
  itemId: string;
  feedbackId: string;
  action: 'created' | 'attached';
  priority: boolean;
  /** Esta misma persona ya lo había pedido antes. */
  askedBefore: boolean;
  /** Personas distintas que lo pidieron (señales con sesión y votos). */
  people: number;
  /** Solo si el ítem es público: título y link al board. Nunca el texto de otro pedido privado. */
  publicItem: { title: string; href: string } | null;
  /** Link al pedido para la persona: la página pública si está publicado, si no la privada. */
  url: string;
  published: boolean;
}

function productOf(raw: string | null | undefined): ProductKey {
  return raw && (PRODUCT_KEYS as readonly string[]).includes(raw) ? (raw as ProductKey) : 'other';
}

/** La tabla feedback viene con un CHECK viejo de productos en algunas bases: si no acepta la app, va como 'other'. */
async function saveFeedback(input: Parameters<typeof createFeedback>[0], workspaceId: string): Promise<FeedbackRow> {
  let row: FeedbackRow;
  try {
    row = await createFeedback(input);
  } catch (err) {
    if (!/CHECK constraint/i.test(String(err))) throw err;
    row = await createFeedback({ ...input, product: 'other' });
  }
  await getDb().prepare("UPDATE feedback SET source = 'assistant', workspace_id = ? WHERE id = ?").run(workspaceId, row.id);
  return row;
}

/** Personas distintas detrás de un ítem: autores de feedback con sesión + votantes. */
export async function countRequesters(itemId: string): Promise<number> {
  const row = (await getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT f.user_id AS who FROM roadmap_signals s JOIN feedback f ON f.id = s.source_id
         WHERE s.item_id = ? AND s.source = 'feedback' AND f.user_id IS NOT NULL
         UNION
         SELECT v.user_id AS who FROM roadmap_votes v WHERE v.item_id = ? AND v.user_id IS NOT NULL
       )`,
    )
    .get(itemId, itemId)) as { n: number } | undefined;
  return Math.max(1, Number(row?.n ?? 0));
}

async function askedBefore(itemId: string, personId: string, exceptFeedbackId: string): Promise<boolean> {
  const row = await getDb()
    .prepare(
      `SELECT 1 AS x FROM roadmap_signals s JOIN feedback f ON f.id = s.source_id
       WHERE s.item_id = ? AND s.source = 'feedback' AND f.user_id = ? AND f.id != ? LIMIT 1`,
    )
    .get(itemId, personId, exceptFeedbackId);
  return Boolean(row);
}

/** Marca que hay algo para mandar al issue (lo manda after() o el tick). */
export async function markBacklogDirty(itemId: string): Promise<void> {
  await getDb().prepare('UPDATE roadmap_items SET github_dirty = github_dirty + 1 WHERE id = ?').run(itemId);
}

/**
 * Anota un pedido de función. Nunca crea nada público: un ítem nuevo nace en
 * 'proposed' (privado). Idempotente por feedback (cada llamada es un pedido).
 */
export async function recordFeatureRequest(who: FeatureRequester, input: FeatureRequestInput): Promise<FeatureRequestResult> {
  const title = clip(input.title, FEATURE_TITLE_MAX) || 'Untitled request';
  const details = clip(input.details ?? '', FEATURE_DETAILS_MAX);
  const product = productOf(input.product);
  const priority = isPriorityEmail(who.email);
  const message = details ? `${title}\n\n${details}` : title;
  const feedback = await saveFeedback({ kind: 'idea', product, message, email: who.email, userId: who.personId }, who.workspaceId);

  const db = getDb();
  const dup = await findDuplicateItem(title);
  let itemId: string;
  let action: FeatureRequestResult['action'];
  if (dup) {
    itemId = dup.id;
    action = 'attached';
  } else {
    itemId = crypto.randomUUID();
    action = 'created';
    const now = nowIso();
    // proposed = triage privado: nunca en el board público.
    await db
      .prepare(
        `INSERT INTO roadmap_items (id, title, description, product, kind, status, votes, is_public, status_changed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'idea', 'proposed', 0, 0, ?, ?, ?)`,
      )
      .run(itemId, title, details, product, now, now, now);
    await recordStatusEvent(itemId, null, 'proposed');
  }
  // La señal (recalcula los votos y suscribe a la persona si el ítem ya es público).
  await attachFeedbackToItem(feedback, itemId);
  await db.prepare('UPDATE feedback SET status = ? WHERE id = ?').run('read', feedback.id);
  // Quien pide sigue el ítem aunque sea privado: le llega el aviso cuando sale.
  // INSERT OR IGNORE: si se desuscribió antes, no se reactiva.
  await subscribe(itemId, who.personId, 'author', who.locale);

  if (priority) {
    await db.prepare('UPDATE roadmap_items SET priority = 1 WHERE id = ?').run(itemId);
    const item = await getRoadmapItem(itemId);
    // Aceptado para construir: pasa a planned (sin tocar la visibilidad). Nunca retrocede uno en curso.
    if (item && (item.status === 'proposed' || item.status === 'idea' || item.status === 'considering')) {
      await updateRoadmapItem(itemId, { status: 'planned' }, { note: 'Priority request' });
    }
  }
  await markBacklogDirty(itemId);
  await notifyFeedback(feedback).catch(() => {});
  await runAfterResponse(() => syncBacklogIssue(itemId));

  const item = await getRoadmapItem(itemId);
  const isPublic = item?.is_public === 1 && item.status !== 'proposed';
  const link = requestLink(item ?? { id: itemId, title, is_public: 0, status: 'proposed' }, who.locale ?? 'en');
  return {
    itemId,
    feedbackId: feedback.id,
    action,
    priority,
    askedBefore: await askedBefore(itemId, who.personId, feedback.id),
    people: await countRequesters(itemId),
    publicItem: isPublic && item ? { title: item.title, href: `/feedback-board/i/${item.id}` } : null,
    url: link.url,
    published: link.published,
  };
}

/**
 * Un problema (algo que anda mal) contado al asistente: va por el mismo
 * camino que el formulario de feedback (tipo bug, clasificación del roadmap,
 * privado). No va a GitHub.
 */
export async function recordProblemReport(who: FeatureRequester, input: FeatureRequestInput): Promise<{ feedbackId: string }> {
  const title = clip(input.title, FEATURE_TITLE_MAX);
  const details = clip(input.details ?? '', FEATURE_DETAILS_MAX);
  const message = details ? `${title}\n\n${details}` : title;
  const feedback = await saveFeedback({ kind: 'bug', product: productOf(input.product), message, email: who.email, userId: who.personId }, who.workspaceId);
  await notifyFeedback(feedback).catch(() => {});
  await runAfterResponse(() => ingestFeedback(feedback));
  return { feedbackId: feedback.id };
}

/** Lo que el admin ve de los pedidos del asistente (solo ADMIN_EMAILS; la página da 404 al resto). */
export async function listAssistantRequestItems(): Promise<Array<RoadmapItemRow & { people: number }>> {
  const rows = (await getDb()
    .prepare(
      `SELECT DISTINCT i.* FROM roadmap_items i
       JOIN roadmap_signals s ON s.item_id = i.id AND s.source = 'feedback'
       JOIN feedback f ON f.id = s.source_id AND f.source = 'assistant'
       ORDER BY i.priority DESC, i.votes DESC, i.created_at DESC LIMIT 500`,
    )
    .all()) as RoadmapItemRow[];
  return Promise.all(rows.map(async (r) => ({ ...r, people: await countRequesters(r.id) })));
}
