/**
 * Talk: vistas previas de links.
 *  - Links de afuera: título, descripción e imagen leídos con safeFetch (el
 *    mismo lector de los bookmarks de Docs). Se guardan con el mensaje.
 *  - Links de la suite (un issue de Track, un deal del CRM, una página de
 *    Docs): tarjeta rica que se arma cada vez para quien mira, con su propio
 *    acceso. Si esa persona no puede ver el registro, no hay tarjeta (y no se
 *    revela nada).
 */
import { getDb } from './db';
import { unfurlLink } from './docs-unfurl';
import { extractUrls } from './talk-markdown';
import type { TalkActor, TalkUnfurl } from './talk';

export type TalkRefCard =
  | { kind: 'issue'; url: string; id: string; identifier: string; title: string; status: string | null; statusColor: string | null; assignee: string | null; priority: string }
  | { kind: 'deal'; url: string; id: string; name: string; amount: number; currency: string; stage: string | null; closeDate: string | null }
  | { kind: 'doc'; url: string; id: string; title: string; icon: string | null };

const REF_RE = /^\/(?:(?:en|es|pt)\/)?app\/(track\/issues|crm\/deals|docs)\/([A-Za-z0-9_-]{6,64})\/?$/;
/** Links nuevos de Track: /app/track/issue/WEB-12/titulo (identificador y slug opcional). */
const ISSUE_REF_RE = /^\/(?:(?:en|es|pt)\/)?app\/track\/issue\/([A-Za-z0-9_-]{1,64})(?:\/[^/]*)?\/?$/;

/** Link de la suite → tipo e id (sin mirar el host: el acceso se chequea al resolver). */
export function parseSuiteRef(url: string): { kind: 'issue' | 'deal' | 'doc'; id: string } | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const byRef = ISSUE_REF_RE.exec(path);
  if (byRef) return { kind: 'issue', id: byRef[1] };
  const m = REF_RE.exec(path);
  if (!m) return null;
  return { kind: m[1] === 'track/issues' ? 'issue' : m[1] === 'crm/deals' ? 'deal' : 'doc', id: m[2] };
}

/** Vista previa de links de afuera (los de la suite se resuelven aparte). */
export async function unfurlExternal(urls: string[]): Promise<TalkUnfurl[]> {
  const out: TalkUnfurl[] = [];
  for (const url of urls.slice(0, 3)) {
    if (parseSuiteRef(url)) continue;
    const meta = await unfurlLink(url).catch(() => null);
    if (!meta || (!meta.title && !meta.description)) continue;
    out.push({ url: meta.url, title: meta.title, description: meta.description, image: meta.image, site: meta.site });
  }
  return out;
}

async function issueCard(actor: TalkActor, id: string, url: string): Promise<TalkRefCard | null> {
  const { getAccessibleIssue, resolveIssueRef } = await import('./track-data');
  // El id puede ser un identificador (WEB-12) de los links nuevos de Track.
  const issueId = (await resolveIssueRef(id, actor.teamId, actor.workspaceId).catch(() => null)) ?? id;
  const found = await getAccessibleIssue(issueId, actor.teamId, actor.workspaceId).catch(() => null);
  if (!found) return null;
  const i = found.issue;
  return { kind: 'issue', url, id: i.id, identifier: i.identifier, title: i.title, status: i.status_name, statusColor: i.status_color, assignee: i.assignee_name ?? i.assignee_email, priority: i.priority };
}

async function dealCard(actor: TalkActor, id: string, url: string): Promise<TalkRefCard | null> {
  const { ownerScopeFor, canSeeEntity } = await import('./crm-visibility');
  const scope = await ownerScopeFor({ workspaceId: actor.workspaceId, personId: actor.personId, role: actor.role }).catch(() => undefined);
  if (scope === undefined || !(await canSeeEntity(actor.workspaceId, 'deal', id, scope))) return null;
  const row = (await getDb()
    .prepare('SELECT d.id, d.name, d.amount, d.currency, d.close_date, s.name AS stage FROM crm_deals d LEFT JOIN crm_stages s ON s.id = d.stage_id WHERE d.id = ? AND d.user_id = ?')
    .get(id, actor.workspaceId)) as { id: string; name: string; amount: number; currency: string; close_date: string | null; stage: string | null } | undefined;
  if (!row) return null;
  return { kind: 'deal', url, id: row.id, name: row.name, amount: Number(row.amount) || 0, currency: row.currency, stage: row.stage, closeDate: row.close_date };
}

async function docCard(actor: TalkActor, id: string, url: string): Promise<TalkRefCard | null> {
  const { resolveDocAccess } = await import('./docs');
  const { getUserById } = await import('./db');
  const acting = actor.personId !== actor.workspaceId ? await getUserById(actor.personId) : undefined;
  const team = actor.teamId ? ({ id: actor.teamId } as import('./db').TeamRow) : null;
  const found = await resolveDocAccess({ id: actor.workspaceId, actingUser: acting, team }, id, { includePublished: false }).catch(() => null);
  if (!found || found.row.archived) return null;
  return { kind: 'doc', url, id: found.row.id, title: found.row.title || 'Untitled', icon: found.row.icon ?? null };
}

/** Tarjetas de la suite por mensaje, para esta persona. */
export async function resolveRefs(actor: TalkActor, messages: Array<{ id: string; body: string }>): Promise<Map<string, TalkRefCard[]>> {
  const out = new Map<string, TalkRefCard[]>();
  const cache = new Map<string, TalkRefCard | null>();
  // Un invitado no ve nada de las otras apps del workspace (Track, CRM, Docs): sin tarjetas.
  if (actor.guest) return out;
  for (const m of messages) {
    if (!m.body.includes('/app/')) continue;
    const cards: TalkRefCard[] = [];
    for (const url of extractUrls(m.body, 5)) {
      const ref = parseSuiteRef(url);
      if (!ref) continue;
      const key = `${ref.kind}:${ref.id}`;
      if (!cache.has(key)) {
        const card = ref.kind === 'issue' ? await issueCard(actor, ref.id, url) : ref.kind === 'deal' ? await dealCard(actor, ref.id, url) : await docCard(actor, ref.id, url);
        cache.set(key, card);
      }
      const card = cache.get(key);
      if (card && !cards.some((c) => c.kind === card.kind && c.id === card.id)) cards.push(card);
    }
    if (cards.length) out.set(m.id, cards);
  }
  return out;
}
