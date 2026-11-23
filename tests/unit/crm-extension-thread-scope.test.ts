/**
 * Extensión de Gmail ("Registrar" y "Registrar y trackear"): el id de thread
 * que manda la extensión solo se usa si quien registra ve los emails que ya
 * están en ese thread; si no, el email va a un thread propio. Y un email ya
 * registrado que la persona no ve no se confirma ni se da su id. Miradas:
 * anónimo, otro workspace, miembro con visibilidad "mine", owner y admin.
 * Datos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createContact } from '@/lib/crm';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { logExtensionEmail, trackExtensionEmail, type ExtensionActor } from '@/lib/crm-extension';
import { createApiKey } from '@/lib/api-auth';
import { threadReplyInfo } from '@/lib/crm-email';
import { addMember } from '@/lib/teams';
import { getDb } from '@/lib/db';
import { workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const logRoute = await import('@/app/api/v1/crm/extension/log-email/route');
const trackRoute = await import('@/app/api/v1/crm/extension/track/route');

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const adminPerson = await makeUser(`${label}-admin`);
  await addMember(w.team.id, adminPerson.id, 'admin');
  await setMemberVisibility(ws, 'mine');
  const hidden = await createContact(ws, { firstName: 'Hidden', email: `hidden-${label}@client.test`, ownerId: ws });
  const mine = await createContact(ws, { firstName: 'Mine', email: `mine-${label}@client.test`, ownerId: w.member.id });
  // Un email del owner con el contacto que el miembro no ve, en un thread de Gmail.
  const hiddenThread = `thr-hidden-${label}`;
  const hiddenGmail = `aa${Date.now().toString(16)}${Math.floor(Math.random() * 1e6).toString(16)}`.slice(0, 16);
  const hiddenEmailId = crypto.randomUUID();
  await getDb()
    .prepare(
      "INSERT INTO crm_emails (id, user_id, contact_id, gmail_id, thread_id, direction, subject, sent_at, person_id) VALUES (?, ?, ?, ?, ?, 'in', 'Private', datetime('now'), ?)",
    )
    .run(hiddenEmailId, ws, hidden.id, hiddenGmail, hiddenThread, ws);
  await getDb().prepare('INSERT INTO crm_email_contacts (email_id, contact_id, user_id) VALUES (?, ?, ?)').run(hiddenEmailId, hidden.id, ws);
  return { w, ws, adminPerson, hidden, mine, hiddenThread, hiddenGmail, hiddenEmailId };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const actor = (s: Setup, personId: string, scope: string[] | null): ExtensionActor => ({ workspaceId: s.ws, personId, scope });
const memberActor = (s: Setup) => actor(s, s.w.member.id, [s.w.member.id]);
const threadOf = async (emailId: string) =>
  ((await getDb().prepare('SELECT thread_id FROM crm_emails WHERE id = ?').get(emailId)) as { thread_id: string }).thread_id;
let seq = 0;
const msgId = () => `${(Date.now() + ++seq).toString(16)}`.padStart(16, 'b').slice(0, 16);

describe('extensión: threads y emails que la persona no ve', () => {
  it('un miembro no mete su email en un thread con emails que no ve; uno nuevo o suyo sí', async () => {
    const s = await setup('ext-thr-mem');
    const from = `mine-ext-thr-mem@client.test`;
    const intoHidden = await logExtensionEmail(memberActor(s), { messageId: msgId(), threadId: s.hiddenThread, from, subject: 'Hi' });
    expect(intoHidden.ok).toBe(true);
    if (!intoHidden.ok) return;
    expect(await threadOf(intoHidden.emailId)).not.toBe(s.hiddenThread);
    const fresh = await logExtensionEmail(memberActor(s), { messageId: msgId(), threadId: 'thr-new-ext', from, subject: 'Hi' });
    if (!fresh.ok) throw new Error('log');
    expect(await threadOf(fresh.emailId)).toBe('thr-new-ext');
    // Otro email en ese mismo thread (ya es suyo y lo ve): queda en el thread.
    const again = await logExtensionEmail(memberActor(s), { messageId: msgId(), threadId: 'thr-new-ext', from, subject: 'Re: Hi' });
    if (!again.ok) throw new Error('log');
    expect(await threadOf(again.emailId)).toBe('thr-new-ext');
    // Trackear un envío: lo mismo.
    const tracked = await trackExtensionEmail(memberActor(s), { to: from, subject: 'Out', threadId: s.hiddenThread });
    if (!tracked.ok) throw new Error('track');
    expect(await threadOf(tracked.emailId)).not.toBe(s.hiddenThread);
  });

  it('owner y admin usan el thread que manda la extensión', async () => {
    const s = await setup('ext-thr-own');
    for (const personId of [s.ws, s.adminPerson.id]) {
      const res = await logExtensionEmail(actor(s, personId, null), { messageId: msgId(), threadId: s.hiddenThread, from: `mine-ext-thr-own@client.test` });
      if (!res.ok) throw new Error('log');
      expect(await threadOf(res.emailId)).toBe(s.hiddenThread);
    }
  });

  it('un email ya registrado que el miembro no ve no se confirma ni se da su id', async () => {
    const s = await setup('ext-dup');
    const res = await logExtensionEmail(memberActor(s), { messageId: s.hiddenGmail, from: `mine-ext-dup@client.test` });
    expect(res).toEqual({ ok: false, error: 'no_contact' });
    expect(JSON.stringify(res)).not.toContain(s.hiddenEmailId);
    // El owner sí ve que ya estaba.
    expect(await logExtensionEmail(actor(s, s.ws, null), { messageId: s.hiddenGmail, from: `mine-ext-dup@client.test` })).toMatchObject({
      ok: true,
      emailId: s.hiddenEmailId,
      duplicate: true,
    });
    // Uno propio repetido: duplicado, con su id.
    const id = msgId();
    const first = await logExtensionEmail(memberActor(s), { messageId: id, from: `mine-ext-dup@client.test` });
    if (!first.ok) throw new Error('log');
    expect(await logExtensionEmail(memberActor(s), { messageId: id, from: `mine-ext-dup@client.test` })).toMatchObject({ ok: true, emailId: first.emailId, duplicate: true });
  });

  it('un thread con un email propio (de su buzón) cuenta como visible aunque el contacto no lo vea', async () => {
    const s = await setup('ext-own');
    const ownThread = 'thr-own-ext';
    const id = crypto.randomUUID();
    await getDb()
      .prepare("INSERT INTO crm_emails (id, user_id, contact_id, gmail_id, thread_id, direction, subject, sent_at, person_id) VALUES (?, ?, ?, ?, ?, 'in', 'Mine', datetime('now'), ?)")
      .run(id, s.ws, s.hidden.id, `own-${id}`, ownThread, s.w.member.id);
    const res = await logExtensionEmail(memberActor(s), { messageId: msgId(), threadId: ownThread, from: `mine-ext-own@client.test` });
    if (!res.ok) throw new Error('log');
    expect(await threadOf(res.emailId)).toBe(ownThread);
  });

  it('responder desde el CRM: un thread con un email que no ve no se usa (ni su Message-ID); el owner sí', async () => {
    const s = await setup('ext-reply');
    // El miembro registra un email suyo en un thread nuevo, y después entra uno ajeno en el mismo thread.
    const mixed = 'thr-mixed-ext';
    const mine = await logExtensionEmail(memberActor(s), { messageId: msgId(), threadId: mixed, from: `mine-ext-reply@client.test` });
    if (!mine.ok) throw new Error('log');
    expect(await threadReplyInfo(s.ws, mixed, [s.w.member.id], s.w.member.id)).toMatchObject({ threadId: mixed });
    const other = crypto.randomUUID();
    await getDb()
      .prepare("INSERT INTO crm_emails (id, user_id, contact_id, gmail_id, thread_id, message_id, direction, subject, sent_at, person_id) VALUES (?, ?, ?, ?, ?, ?, 'in', 'Private', datetime('now', '+1 minute'), ?)")
      .run(other, s.ws, s.hidden.id, `oth-${other}`, mixed, `<hidden-${other}@mail.test>`, s.ws);
    expect(await threadReplyInfo(s.ws, mixed, [s.w.member.id], s.w.member.id)).toBeNull();
    expect(await threadReplyInfo(s.ws, mixed, undefined, s.ws)).toMatchObject({ threadId: mixed, inReplyTo: `<hidden-${other}@mail.test>` });
  });

  it('rutas: sin key 401; la key de otro workspace no registra en este; la del miembro no confirma el ajeno', async () => {
    const s = await setup('ext-route');
    const post = (route: typeof logRoute, url: string, body: unknown, key?: string) =>
      route.POST(
        new NextRequest(`http://localhost${url}`, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        }),
      );
    const body = { messageId: s.hiddenGmail, threadId: s.hiddenThread, from: `mine-ext-route@client.test` };
    expect((await post(logRoute, '/api/v1/crm/extension/log-email', body)).status).toBe(401);
    expect((await post(trackRoute as unknown as typeof logRoute, '/api/v1/crm/extension/track', { to: 'x@client.test' })).status).toBe(401);
    const strangerKey = await createApiKey(s.w.stranger.id, 'k', s.w.stranger.id, ['crm:read', 'crm:write']);
    const other = await post(logRoute, '/api/v1/crm/extension/log-email', body, strangerKey.key);
    expect(other.status).toBe(404);
    expect(await other.text()).not.toContain(s.hiddenEmailId);
    const memberKey = await createApiKey(s.ws, 'k', s.w.member.id, ['crm:read', 'crm:write']);
    const mem = await post(logRoute, '/api/v1/crm/extension/log-email', body, memberKey.key);
    expect(mem.status).toBe(404);
    expect(await mem.text()).not.toContain(s.hiddenEmailId);
    // La key de un admin ve todo: el email ya registrado sale como duplicado, con su id.
    const adminKey = await createApiKey(s.ws, 'k', s.adminPerson.id, ['crm:read', 'crm:write']);
    const adm = await post(logRoute, '/api/v1/crm/extension/log-email', body, adminKey.key);
    expect(adm.status).toBe(200);
    expect(await adm.json()).toMatchObject({ emailId: s.hiddenEmailId, duplicate: true });
  });
});
