/**
 * Social: bandeja unificada (comentarios, menciones y mensajes directos de
 * las cuentas que la persona ve), respuestas, asignación y "hecho". También
 * el webhook de Meta (páginas e Instagram), con la firma verificada con el
 * app secret. Server-only.
 */
import { localized } from './notification-copy';
import { createHmac, timingSafeEqual } from 'crypto';
import { getDb } from './db';
import { createNotification } from './notifications';
import { credsOf, personMayPublish, providerFor, SocialError, visibleAccountIds, type SocialActor } from './social';
import { storeInboxItems } from './social-cron';
import { NETWORK_SPECS, type InboxKind, type SocialNetwork } from './social-networks';
import { SocialApiError } from './social-providers';

const db = () => getDb();
const now = () => new Date().toISOString();

export interface InboxReply {
  id: string;
  personName: string | null;
  text: string;
  status: 'sent' | 'failed';
  error: string | null;
  createdAt: string;
}

export interface InboxItemDto {
  id: string;
  kind: InboxKind;
  account: { id: string; name: string; network: SocialNetwork; networkName: string; handle: string | null };
  authorName: string;
  authorHandle: string | null;
  text: string;
  receivedAt: string;
  status: 'open' | 'done';
  assignedTo: string | null;
  assignedName: string | null;
  postId: string | null;
  postUrl: string | null;
  replies: InboxReply[];
  canReply: boolean;
}

interface Row {
  id: string;
  kind: string;
  account_id: string;
  author_name: string;
  author_handle: string | null;
  text: string;
  received_at: string;
  status: string;
  assigned_to: string | null;
  assigned_name: string | null;
  account_name: string;
  network: string;
  handle: string | null;
  post_id: string | null;
  post_url: string | null;
}

export interface InboxFilter {
  status?: 'open' | 'done' | 'all';
  kind?: InboxKind;
  accountId?: string;
  assigned?: 'me' | 'none';
  q?: string;
}

export async function listInbox(actor: SocialActor, filter: InboxFilter = {}): Promise<InboxItemDto[]> {
  const ids = await visibleAccountIds(actor);
  if (!ids.length) return [];
  const where = ['i.workspace_id = ?', `i.account_id IN (${ids.map(() => '?').join(',')})`];
  const args: string[] = [actor.workspaceId, ...ids];
  if (filter.status !== 'all') {
    where.push('i.status = ?');
    args.push(filter.status ?? 'open');
  }
  if (filter.kind) {
    where.push('i.kind = ?');
    args.push(filter.kind);
  }
  if (filter.accountId) {
    where.push('i.account_id = ?');
    args.push(filter.accountId);
  }
  if (filter.assigned === 'me') {
    where.push('i.assigned_to = ?');
    args.push(actor.personId);
  } else if (filter.assigned === 'none') where.push('i.assigned_to IS NULL');
  if (filter.q?.trim()) {
    where.push("(i.text LIKE ? ESCAPE '\\' OR i.author_name LIKE ? ESCAPE '\\')");
    const like = `%${filter.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    args.push(like, like);
  }
  const rows = (await db()
    .prepare(
      `SELECT i.*, a.name AS account_name, a.network, a.handle, t.post_id, t.external_url AS post_url, COALESCE(u.name, u.email) AS assigned_name
       FROM social_inbox i JOIN social_accounts a ON a.id = i.account_id
       LEFT JOIN social_post_targets t ON t.id = i.target_id
       LEFT JOIN users u ON u.id = i.assigned_to
       WHERE ${where.join(' AND ')} ORDER BY i.received_at DESC LIMIT 300`,
    )
    .all(...args)) as Row[];
  const itemIds = rows.map((r) => r.id);
  const replies = itemIds.length
    ? ((await db()
        .prepare(
          `SELECT r.*, COALESCE(u.name, u.email) AS person_name FROM social_inbox_replies r LEFT JOIN users u ON u.id = r.person_id
           WHERE r.item_id IN (${itemIds.map(() => '?').join(',')}) ORDER BY r.created_at`,
        )
        .all(...itemIds)) as Array<{ id: string; item_id: string; person_name: string | null; text: string; status: string; error: string | null; created_at: string }>)
    : [];
  return rows.map((r) => {
    const network = r.network as SocialNetwork;
    return {
      id: r.id,
      kind: r.kind as InboxKind,
      account: { id: r.account_id, name: r.account_name, network, networkName: NETWORK_SPECS[network]?.name ?? r.network, handle: r.handle },
      authorName: r.author_name,
      authorHandle: r.author_handle,
      text: r.text,
      receivedAt: r.received_at,
      status: r.status === 'done' ? 'done' : 'open',
      assignedTo: r.assigned_to,
      assignedName: r.assigned_name,
      postId: r.post_id,
      postUrl: r.post_url,
      canReply: Boolean(providerFor(network).reply),
      replies: replies
        .filter((x) => x.item_id === r.id)
        .map((x) => ({ id: x.id, personName: x.person_name, text: x.text, status: x.status === 'failed' ? 'failed' : 'sent', error: x.error, createdAt: x.created_at })),
    };
  });
}

async function itemRow(actor: SocialActor, id: string) {
  const ids = await visibleAccountIds(actor);
  const row = (await db().prepare('SELECT * FROM social_inbox WHERE id = ? AND workspace_id = ?').get(id, actor.workspaceId)) as
    | { id: string; account_id: string; kind: string; external_id: string; thread_ref: string | null; author_id: string | null; text: string }
    | undefined;
  if (!row || !ids.includes(row.account_id)) throw new SocialError(404, 'not_found');
  return row;
}

async function getItem(actor: SocialActor, id: string): Promise<InboxItemDto> {
  const item = (await listInbox(actor, { status: 'all' })).find((i) => i.id === id);
  if (!item) throw new SocialError(404, 'not_found');
  return item;
}

/** Contesta en la red (comentario, mención o DM). Si la red falla, queda la respuesta con el error. */
export async function replyInbox(actor: SocialActor, id: string, text: string): Promise<InboxItemDto> {
  const body = text.trim().slice(0, 8000);
  if (!body) throw new SocialError(400, 'text_required');
  const row = await itemRow(actor, id);
  const acc = (await db().prepare('SELECT * FROM social_accounts WHERE id = ?').get(row.account_id)) as Parameters<typeof credsOf>[0] & { status: string };
  if (acc.status === 'expired') throw new SocialError(400, 'account_needs_reconnect');
  const creds = credsOf(acc);
  const provider = providerFor(creds.network);
  if (!provider.reply) throw new SocialError(400, 'reply_not_supported');
  let status = 'sent';
  let error: string | null = null;
  let externalId: string | null = null;
  try {
    externalId = (await provider.reply(creds, { kind: row.kind as InboxKind, externalId: row.external_id, threadRef: row.thread_ref, authorId: row.author_id }, body)).externalId;
  } catch (err) {
    status = 'failed';
    error = err instanceof SocialApiError ? err.message : 'Unexpected error';
    if (err instanceof SocialApiError && err.code === 'token_expired') {
      await db().prepare("UPDATE social_accounts SET status = 'expired', status_error = ? WHERE id = ?").run(err.message, acc.id);
    }
  }
  await db()
    .prepare('INSERT INTO social_inbox_replies (id, item_id, person_id, text, status, external_id, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), id, actor.personId, body, status, externalId, error, now());
  return getItem(actor, id);
}

export async function assignInbox(actor: SocialActor, id: string, personId: string | null): Promise<InboxItemDto> {
  const row = await itemRow(actor, id);
  // Solo a alguien que ve la cuenta de ese ítem (admin, o con la cuenta dada).
  if (personId && !(await personMayPublish(actor.workspaceId, personId, row.account_id))) throw new SocialError(400, 'person_not_found');
  await db().prepare('UPDATE social_inbox SET assigned_to = ? WHERE id = ?').run(personId, id);
  if (personId && personId !== actor.personId) {
    await createNotification({
      userId: personId,
      type: 'social_assigned',
      title: row.text.slice(0, 60) || localized('socialInbox'),
      href: `/app/social/inbox?item=${id}`,
      sourceType: 'social_inbox',
      sourceId: id,
      meta: { text: row.text.slice(0, 60) },
    }).catch(() => undefined);
  }
  return getItem(actor, id);
}

export async function setInboxStatus(actor: SocialActor, id: string, status: 'open' | 'done'): Promise<InboxItemDto> {
  await itemRow(actor, id);
  await db()
    .prepare('UPDATE social_inbox SET status = ?, done_at = ?, done_by = ? WHERE id = ?')
    .run(status, status === 'done' ? now() : null, status === 'done' ? actor.personId : null, id);
  return getItem(actor, id);
}

// ---------- Webhook de Meta ----------

/** X-Hub-Signature-256 = sha256=HMAC(app secret, cuerpo crudo). Comparación de tiempo constante. */
export function verifyMetaWebhook(rawBody: string, signature: string | null, appSecret = process.env.META_APP_SECRET ?? ''): boolean {
  if (!appSecret || !signature?.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`);
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function verifyMetaChallenge(params: URLSearchParams, verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN ?? ''): string | null {
  const token = params.get('hub.verify_token') ?? '';
  if (!verifyToken || params.get('hub.mode') !== 'subscribe') return null;
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return String(params.get('hub.challenge') ?? '').slice(0, 200);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

/** Eventos de páginas (comentarios y Messenger) e Instagram (comentarios y DMs) → bandeja. Devuelve cuántos ítems nuevos. */
export async function handleMetaWebhook(body: Json): Promise<number> {
  const object = body?.object;
  if (object !== 'page' && object !== 'instagram') return 0;
  const network: SocialNetwork = object === 'page' ? 'facebook' : 'instagram';
  let added = 0;
  for (const entry of ((body?.entry ?? []) as Json[]).slice(0, 50)) {
    const accounts = (await db().prepare('SELECT id, workspace_id, external_id FROM social_accounts WHERE network = ? AND external_id = ?').all(network, String(entry?.id ?? ''))) as Array<{
      id: string;
      workspace_id: string;
      external_id: string;
    }>;
    if (!accounts.length) continue;
    const items: Parameters<typeof storeInboxItems>[2] = [];
    for (const change of ((entry.changes ?? []) as Json[]).slice(0, 50)) {
      const v = change?.value ?? {};
      if (network === 'facebook' && change?.field === 'feed' && v.item === 'comment' && v.verb === 'add' && v.from?.id !== entry.id) {
        items.push({ kind: 'comment', externalId: String(v.comment_id), postExternalId: v.post_id ? String(v.post_id) : null, authorName: v.from?.name ?? 'Facebook user', authorId: v.from?.id ?? null, text: String(v.message ?? ''), receivedAt: v.created_time ? new Date(Number(v.created_time) * 1000).toISOString() : now() });
      }
      if (network === 'instagram' && change?.field === 'comments' && v.id) {
        items.push({ kind: 'comment', externalId: String(v.id), postExternalId: v.media?.id ? String(v.media.id) : null, authorName: v.from?.username ?? 'Instagram user', authorHandle: v.from?.username ?? null, authorId: v.from?.id ?? null, text: String(v.text ?? ''), receivedAt: now() });
      }
      if (network === 'instagram' && change?.field === 'mentions' && v.comment_id) {
        items.push({ kind: 'mention', externalId: String(v.comment_id), authorName: 'Instagram user', text: '', receivedAt: now() });
      }
    }
    for (const m of ((entry.messaging ?? []) as Json[]).slice(0, 50)) {
      if (!m?.message?.mid || m.message.is_echo || !m.message.text) continue;
      items.push({ kind: 'dm', externalId: String(m.message.mid), threadRef: String(m.sender?.id ?? ''), authorName: 'Contact', authorId: m.sender?.id ?? null, text: String(m.message.text), receivedAt: m.timestamp ? new Date(Number(m.timestamp)).toISOString() : now() });
    }
    for (const a of accounts) added += await storeInboxItems(a.workspace_id, a.id, items);
  }
  return added;
}

/** Un evento del webhook ya procesado (Meta reintenta): true si es nuevo. */
export async function claimWebhookEvent(key: string): Promise<boolean> {
  const res = await db().prepare('INSERT OR IGNORE INTO social_webhook_events (id, created_at) VALUES (?, ?)').run(key.slice(0, 200), now());
  return res.changes === 1;
}

/** Si procesar falló, el evento se libera: el reintento de Meta lo vuelve a procesar. */
export async function releaseWebhookEvent(key: string): Promise<void> {
  await db().prepare('DELETE FROM social_webhook_events WHERE id = ?').run(key.slice(0, 200));
}

export async function inboxPeople(actor: SocialActor) {
  const { listSocialPeople } = await import('./social');
  return (await listSocialPeople(actor)).map((p) => ({ id: p.id, name: p.name }));
}

