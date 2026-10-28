/**
 * Groups: notificaciones push web (PWA). Cada persona suscribe su navegador
 * (groups_push_subscriptions); cuando entra un mensaje en un chat que tiene
 * asignado, o le asignan uno, se guarda el aviso (groups_notifications) y se
 * manda un push sin contenido con firma VAPID (RFC 8292). El service worker
 * (public/sw.js, el service worker de la suite) lo recibe, pide los avisos pendientes a
 * /api/groups/push/pending con la sesión y los muestra. Así no hace falta
 * cifrar el contenido del push y el texto nunca pasa por el servicio de push.
 *
 * Configuración: VAPID_PUBLIC_KEY (punto P-256 sin comprimir, base64url),
 * VAPID_PRIVATE_KEY (32 bytes, base64url) y VAPID_SUBJECT (mailto: o https:).
 * Con GROUPS_PUSH_FAKE=1 (tests) el envío se guarda en memoria y no sale.
 * Server-only.
 */
import { createPrivateKey, randomUUID, sign } from 'crypto';
import { getDb } from './db';
import { safeFetch } from './safe-fetch';
import { maskPhoneText } from './groups-mask';

const b64url = (buf: Buffer) => buf.toString('base64url');

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function vapidKeys(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return pushFake() ? FAKE_KEYS : null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT?.trim() || 'mailto:support@zerosoft.ai' };
}

function pushFake(): boolean {
  return process.env.GROUPS_PUSH_FAKE === '1' || (process.env.GROUPS_FAKE === '1' && (process.env.NODE_ENV === 'test' || process.env.DEMO_MODE === 'true'));
}

// Par de claves solo para tests (no firma nada real).
const FAKE_KEYS: VapidKeys = {
  publicKey: 'BC6AB-A4YpUlBKGXo-AbZ_SigdpRlwX1jQ507eJ6qIf2eymFLG1Euid-iy0XZChQnyfpoOzsJT9iSdATfGFfamA',
  privateKey: 'CusOx7eQEfwBqr0UwpWFrOYePNLaRuyDl337GZ3HwZE',
  subject: 'mailto:test@zerosoft.ai',
};

/** JWT ES256 de VAPID para el origen del servicio de push. */
export function vapidJwt(keys: VapidKeys, audience: string, now = Math.floor(Date.now() / 1000)): string {
  const pub = Buffer.from(keys.publicKey, 'base64url');
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('invalid_vapid_public_key');
  const key = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) },
    format: 'jwk',
  });
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(Buffer.from(JSON.stringify({ aud: audience, exp: now + 12 * 3600, sub: keys.subject })));
  const data = `${header}.${claims}`;
  const sig = sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return `${data}.${b64url(sig)}`;
}

interface FakePush {
  endpoint: string;
  authorization: string;
  at: number;
}
const fakeLog = ((globalThis as unknown as { __groupsPush?: FakePush[] }).__groupsPush ??= []);

export function fakePushes(): FakePush[] {
  return fakeLog;
}

/** Manda un push sin contenido. 'gone' si la suscripción ya no existe (404/410). */
export async function sendPush(endpoint: string, keys: VapidKeys): Promise<'ok' | 'gone' | 'error'> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return 'gone';
  }
  const authorization = `vapid t=${vapidJwt(keys, url.origin)}, k=${keys.publicKey}`;
  if (pushFake()) {
    fakeLog.push({ endpoint, authorization, at: Date.now() });
    if (fakeLog.length > 200) fakeLog.splice(0, fakeLog.length - 200);
    return 'ok';
  }
  try {
    const res = await safeFetch(endpoint, { method: 'POST', headers: { ttl: '3600', urgency: 'high', authorization, 'content-length': '0' } }, 10_000);
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

// ---------- Suscripciones ----------

export interface PushSubscriptionInput {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
}

export function validEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 2000) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' || (pushFake() && u.protocol === 'http:');
  } catch {
    return false;
  }
}

export async function saveSubscription(ws: string, personId: string, sub: PushSubscriptionInput, userAgent = ''): Promise<void> {
  if (!validEndpoint(sub.endpoint)) throw new Error('invalid_subscription');
  await getDb()
    .prepare(
      `INSERT INTO groups_push_subscriptions (id, user_id, person_id, endpoint, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, person_id = excluded.person_id, p256dh = excluded.p256dh,
         auth = excluded.auth, user_agent = excluded.user_agent, last_error = ''`,
    )
    .run(
      randomUUID(),
      ws,
      personId,
      sub.endpoint,
      String(sub.keys?.p256dh ?? '').slice(0, 200),
      String(sub.keys?.auth ?? '').slice(0, 100),
      userAgent.slice(0, 200),
      new Date().toISOString(),
    );
}

export async function deleteSubscription(personId: string, endpoint: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM groups_push_subscriptions WHERE endpoint = ? AND person_id = ?').run(endpoint, personId)).changes > 0;
}

export async function countSubscriptions(ws: string, personId: string): Promise<number> {
  const r = (await getDb().prepare('SELECT COUNT(*) AS c FROM groups_push_subscriptions WHERE user_id = ? AND person_id = ?').get(ws, personId)) as {
    c: number;
  };
  return Number(r.c);
}

// ---------- Avisos ----------

export interface NotificationInput {
  chatId: string | null;
  title: string;
  body: string;
}

/** Guarda el aviso y despierta los navegadores suscriptos de la persona. Nunca lanza. */
export async function notifyPerson(ws: string, personId: string, n: NotificationInput): Promise<number> {
  try {
    const db = getDb();
    const subs = (await db.prepare('SELECT id, endpoint FROM groups_push_subscriptions WHERE user_id = ? AND person_id = ?').all(ws, personId)) as Array<{
      id: string;
      endpoint: string;
    }>;
    if (subs.length === 0) return 0;
    const keys = vapidKeys();
    if (!keys) return 0;
    // Si la persona tiene los teléfonos ocultos, el aviso tampoco los muestra.
    const { groupsViewer } = await import('./groups-access');
    const { workspaceRole } = await import('./api-auth');
    const viewer = await groupsViewer(ws, personId, await workspaceRole(ws, personId));
    const clean = (t: string) => (viewer.mask ? maskPhoneText(t) : t);
    await db
      .prepare('INSERT INTO groups_notifications (id, user_id, person_id, chat_id, title, body, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        randomUUID(),
        ws,
        personId,
        n.chatId,
        clean(n.title).slice(0, 120),
        clean(n.body).slice(0, 240),
        n.chatId ? `/app/groups/inbox/${n.chatId}` : '/app/groups/inbox',
        new Date().toISOString(),
      );
    let sent = 0;
    for (const s of subs) {
      const r = await sendPush(s.endpoint, keys);
      if (r === 'gone') await db.prepare('DELETE FROM groups_push_subscriptions WHERE id = ?').run(s.id);
      else if (r === 'error') await db.prepare("UPDATE groups_push_subscriptions SET last_error = 'push_failed' WHERE id = ?").run(s.id);
      else sent++;
    }
    return sent;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[groups] push failed', (err as Error)?.name ?? 'error');
    return 0;
  }
}

/**
 * Aviso push de otra app de la suite (Chat): mismo service worker y mismas
 * suscripciones de la persona, con su propio link. Nunca lanza.
 */
export async function notifyPersonLink(ws: string, personId: string, n: { title: string; body: string; url: string }): Promise<number> {
  try {
    const db = getDb();
    const subs = (await db.prepare('SELECT id, endpoint FROM groups_push_subscriptions WHERE user_id = ? AND person_id = ?').all(ws, personId)) as Array<{
      id: string;
      endpoint: string;
    }>;
    if (subs.length === 0) return 0;
    const keys = vapidKeys();
    if (!keys) return 0;
    // Solo links internos de la app (el service worker abre esta URL).
    const url = n.url.startsWith('/') && !n.url.startsWith('//') ? n.url : '/app';
    await db
      .prepare('INSERT INTO groups_notifications (id, user_id, person_id, chat_id, title, body, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), ws, personId, null, n.title.slice(0, 120), n.body.slice(0, 240), url, new Date().toISOString());
    let sent = 0;
    for (const s of subs) {
      const r = await sendPush(s.endpoint, keys);
      if (r === 'gone') await db.prepare('DELETE FROM groups_push_subscriptions WHERE id = ?').run(s.id);
      else if (r === 'error') await db.prepare("UPDATE groups_push_subscriptions SET last_error = 'push_failed' WHERE id = ?").run(s.id);
      else sent++;
    }
    return sent;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[push] failed', (err as Error)?.name ?? 'error');
    return 0;
  }
}

export interface PendingNotification {
  id: string;
  title: string;
  body: string;
  url: string;
  createdAt: string;
}

/** Avisos sin entregar de la persona (últimas 24 h). Los reclama: cada uno se entrega una vez. */
export async function takePending(ws: string, personId: string, limit = 5): Promise<PendingNotification[]> {
  const db = getDb();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const rows = (await db
    .prepare(
      `SELECT id, title, body, url, created_at FROM groups_notifications
       WHERE user_id = ? AND person_id = ? AND delivered_at IS NULL AND created_at >= ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(ws, personId, since, limit)) as Array<{ id: string; title: string; body: string; url: string; created_at: string }>;
  const out: PendingNotification[] = [];
  const now = new Date().toISOString();
  for (const r of rows) {
    const claim = await db.prepare('UPDATE groups_notifications SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL').run(now, r.id);
    if (claim.changes > 0) out.push({ id: r.id, title: r.title, body: r.body, url: r.url, createdAt: r.created_at });
  }
  return out;
}
