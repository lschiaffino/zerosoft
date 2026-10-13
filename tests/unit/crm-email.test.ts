import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContact } from '@/lib/crm';
import { getDb, type CrmEmailRow, type CrmSequenceEnrollmentRow } from '@/lib/db';
import { upsertIntegration } from '@/lib/integrations';
import { GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE } from '@/lib/gmail';
import {
  canManageOwned,
  classifyTrackingHit,
  clickUrl,
  createEmailTemplate,
  getEmailTemplate,
  listEmailThreads,
  recordTrackingHit,
  recordUnsubscribe,
  renderEmailTemplate,
  resolveClickTarget,
  sendCrmEmail,
  signTracking,
  unsubscribeUrl,
} from '@/lib/crm-email';
import { getMailboxSync, syncMailbox } from '@/lib/crm-email-sync';
import {
  addWaitDays,
  createSequence,
  enrollContacts,
  getEnrollment,
  listEnrollments,
  nextSendSlot,
  processSequences,
  sequenceStepStats,
  setEnrollmentState,
} from '@/lib/crm-sequences';
import { createWorkflow, listWorkflowRuns } from '@/lib/crm-workflows';
import { createTeam, addMember } from '@/lib/teams';
import { makeUser } from './helpers';

// ---------- Gmail falso (fetch mockeado: nada sale a la red) ----------

interface FakeMsg {
  id: string;
  threadId: string;
  labelIds: string[];
  internalDate: number;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  messageId: string;
  inReplyTo?: string;
  text: string;
  html?: string;
}

class FakeGmail {
  messages = new Map<string, FakeMsg>();
  history: Array<{ id: string; messageId: string }> = [];
  historyId = 1000;
  expiredHistory = false;
  sent: Array<{ raw: string; threadId?: string; id: string }> = [];
  historyCalls: string[] = [];
  listCalls = 0;

  add(msg: Omit<FakeMsg, 'labelIds' | 'internalDate'> & { labelIds?: string[]; internalDate?: number }): FakeMsg {
    const full: FakeMsg = { labelIds: ['INBOX'], internalDate: Date.now(), ...msg };
    this.messages.set(full.id, full);
    this.historyId += 1;
    this.history.push({ id: String(this.historyId), messageId: full.id });
    return full;
  }

  private payload(m: FakeMsg) {
    const headers = [
      { name: 'From', value: m.from },
      { name: 'To', value: m.to },
      { name: 'Subject', value: m.subject },
      { name: 'Message-ID', value: m.messageId },
    ];
    if (m.cc) headers.push({ name: 'Cc', value: m.cc });
    if (m.inReplyTo) headers.push({ name: 'In-Reply-To', value: m.inReplyTo });
    const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
    return {
      mimeType: 'multipart/alternative',
      headers,
      parts: [
        { mimeType: 'text/plain', body: { data: b64(m.text) } },
        ...(m.html ? [{ mimeType: 'text/html', body: { data: b64(m.html) } }] : []),
      ],
    };
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    const path = url.pathname.replace('/gmail/v1/users/me', '');
    if (path === '/profile') return json({ emailAddress: 'me@acme.test', historyId: String(this.historyId) });
    if (path === '/history') {
      const start = Number(url.searchParams.get('startHistoryId'));
      this.historyCalls.push(String(start));
      if (this.expiredHistory) return json({ error: { code: 404 } }, 404);
      const items = this.history.filter((h) => Number(h.id) > start);
      return json({
        historyId: String(this.historyId),
        history: items.map((h) => ({
          id: h.id,
          messagesAdded: [{ message: { id: h.messageId, threadId: this.messages.get(h.messageId)?.threadId } }],
        })),
      });
    }
    if (path === '/messages' && (!init?.method || init.method === 'GET')) {
      this.listCalls += 1;
      const all = [...this.messages.values()].sort((a, b) => b.internalDate - a.internalDate);
      return json({ messages: all.map((m) => ({ id: m.id, threadId: m.threadId })) });
    }
    if (path === '/messages/send') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { raw: string; threadId?: string };
      const id = `sent-${this.sent.length + 1}`;
      const threadId = body.threadId ?? `thr-${id}`;
      this.sent.push({ raw: Buffer.from(body.raw, 'base64url').toString('utf8'), threadId: body.threadId, id });
      const mime = Buffer.from(body.raw, 'base64url').toString('utf8');
      const header = (n: string) => new RegExp(`^${n}: (.*)$`, 'mi').exec(mime)?.[1] ?? '';
      this.add({
        id,
        threadId,
        labelIds: ['SENT'],
        from: 'me@acme.test',
        to: header('To'),
        subject: header('Subject'),
        messageId: `<${id}@mail.gmail.com>`,
        text: 'sent',
      });
      return json({ id, threadId });
    }
    const m = /^\/messages\/([^/]+)$/.exec(path);
    if (m) {
      const msg = this.messages.get(decodeURIComponent(m[1]));
      if (!msg) return json({ error: 'not found' }, 404);
      return json({
        id: msg.id,
        threadId: msg.threadId,
        labelIds: msg.labelIds,
        snippet: msg.text.slice(0, 80),
        internalDate: String(msg.internalDate),
        payload: this.payload(msg),
      });
    }
    return json({ error: 'unexpected' }, 500);
  };
}

let gmail: FakeGmail;

beforeEach(() => {
  gmail = new FakeGmail();
  vi.stubGlobal('fetch', vi.fn(gmail.fetch));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function connectGmail(personId: string, send = true) {
  await upsertIntegration({
    userId: personId,
    provider: 'gmail',
    email: 'me@acme.test',
    accessToken: 'tok',
    refreshToken: 'refresh',
    expiresAt: Date.now() + 3_600_000,
    scope: `openid email ${GMAIL_READ_SCOPE}${send ? ` ${GMAIL_SEND_SCOPE}` : ''}`,
  });
}

async function emailsOf(userId: string): Promise<CrmEmailRow[]> {
  return (await getDb().prepare('SELECT * FROM crm_emails WHERE user_id = ? ORDER BY sent_at ASC').all(userId)) as CrmEmailRow[];
}

// ---------- Sync de Gmail ----------

describe('Gmail sync', () => {
  it('primer sync completo: guarda solo mails con contactos, cuerpo y thread; después incremental', async () => {
    const u = await makeUser('sync');
    await connectGmail(u.id);
    const ana = await createContact(u.id, { firstName: 'Ana', email: 'ana@client.test' });
    const wf = await createWorkflow(u.id, {
      name: 'Respuesta',
      enabled: true,
      triggers: [{ type: 'email_received' }],
      actions: [{ type: 'notify_user', config: { message: 'Respondió {{contact.firstName}}' } }],
    });
    gmail.add({ id: 'm1', threadId: 't1', from: 'Ana <ana@client.test>', to: 'me@acme.test', subject: 'Hola', messageId: '<m1@x>', text: 'Primer mensaje', html: '<p>Primer <b>mensaje</b><img src="https://tracker.test/x.gif"><script>alert(1)</script></p>' });
    gmail.add({ id: 'm2', threadId: 'tx', from: 'news@spam.test', to: 'me@acme.test', subject: 'Promo', messageId: '<m2@x>', text: 'Nada que ver' });

    const first = await syncMailbox(u.id, u.id);
    expect(first).toMatchObject({ status: 'ok', mode: 'full', stored: 1 });
    const rows = await emailsOf(u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ contact_id: ana.id, thread_id: 't1', direction: 'in', body_text: 'Primer mensaje', message_id: '<m1@x>' });
    expect(rows[0].body_html).toContain('<b>mensaje</b>');
    expect(rows[0].body_html).not.toContain('<img');
    expect(rows[0].body_html).not.toContain('<script');
    expect((await getMailboxSync(u.id, u.id))?.history_id).toBe(String(gmail.historyId));
    expect((await listWorkflowRuns(u.id, wf.id)).length).toBe(1);

    gmail.add({ id: 'm3', threadId: 't1', from: 'me@acme.test', to: 'ana@client.test', subject: 'Re: Hola', messageId: '<m3@x>', inReplyTo: '<m1@x>', text: 'Respuesta', labelIds: ['SENT'] });
    const second = await syncMailbox(u.id, u.id);
    expect(second).toMatchObject({ status: 'ok', mode: 'incremental', stored: 1 });
    expect(gmail.listCalls).toBe(1); // no volvió a listar todo
    const out = (await emailsOf(u.id)).find((e) => e.gmail_id === 'm3');
    expect(out).toMatchObject({ direction: 'out', in_reply_to: '<m1@x>' });
    // Solo los entrantes disparan email_received.
    expect((await listWorkflowRuns(u.id, wf.id)).length).toBe(1);

    const { threads } = await listEmailThreads(u.id, { contactId: ana.id });
    expect(threads).toHaveLength(1);
    expect(threads[0].messages.map((m) => m.id)).toHaveLength(2);
  });

  it('historyId vencido (404) → sync completo', async () => {
    const u = await makeUser('sync404');
    await connectGmail(u.id);
    await createContact(u.id, { email: 'bob@client.test' });
    await syncMailbox(u.id, u.id);
    gmail.expiredHistory = true;
    gmail.add({ id: 'b1', threadId: 'tb', from: 'bob@client.test', to: 'me@acme.test', subject: 'Hey', messageId: '<b1@x>', text: 'hola' });
    const res = await syncMailbox(u.id, u.id);
    expect(gmail.historyCalls.length).toBe(1);
    expect(res).toMatchObject({ status: 'ok', mode: 'full', stored: 1 });
  });

  it('pasada acotada: el historyId avanza solo hasta lo procesado', async () => {
    const u = await makeUser('syncmax');
    await connectGmail(u.id);
    await createContact(u.id, { email: 'cy@client.test' });
    await syncMailbox(u.id, u.id);
    const start = gmail.historyId;
    gmail.add({ id: 'c1', threadId: 'tc', from: 'cy@client.test', to: 'me@acme.test', subject: '1', messageId: '<c1@x>', text: '1' });
    gmail.add({ id: 'c2', threadId: 'tc', from: 'cy@client.test', to: 'me@acme.test', subject: '2', messageId: '<c2@x>', text: '2' });
    const a = await syncMailbox(u.id, u.id, { maxMessages: 1 });
    expect(a).toMatchObject({ stored: 1, more: true });
    expect((await getMailboxSync(u.id, u.id))?.history_id).toBe(String(start + 1));
    const b = await syncMailbox(u.id, u.id, { maxMessages: 1 });
    expect(b).toMatchObject({ stored: 1, more: false });
    expect((await emailsOf(u.id)).map((e) => e.gmail_id).sort()).toEqual(['c1', 'c2']);
  });

  it('lock: dos pasadas a la vez no sincronizan el mismo buzón', async () => {
    const u = await makeUser('synclock');
    await connectGmail(u.id);
    await createContact(u.id, { email: 'dee@client.test' });
    gmail.add({ id: 'd1', threadId: 'td', from: 'dee@client.test', to: 'me@acme.test', subject: 'x', messageId: '<d1@x>', text: 'x' });
    const [r1, r2] = await Promise.all([syncMailbox(u.id, u.id), syncMailbox(u.id, u.id)]);
    expect([r1.status, r2.status].sort()).toEqual(['locked', 'ok']);
    expect(await emailsOf(u.id)).toHaveLength(1);
  });

  it('asociación: to+cc asocian varios contactos y nunca cruza workspaces', async () => {
    const a = await makeUser('wsA');
    const b = await makeUser('wsB');
    await connectGmail(a.id);
    const c1 = await createContact(a.id, { email: 'one@client.test' });
    const c2 = await createContact(a.id, { email: 'two@client.test' });
    const other = await createContact(b.id, { email: 'one@client.test' });
    gmail.add({ id: 'e1', threadId: 'te', from: 'me@acme.test', to: 'one@client.test', cc: 'Two <two@client.test>', subject: 'Propuesta', messageId: '<e1@x>', text: 'adjunto', labelIds: ['SENT'] });
    await syncMailbox(a.id, a.id);
    expect((await listEmailThreads(a.id, { contactId: c1.id })).threads).toHaveLength(1);
    expect((await listEmailThreads(a.id, { contactId: c2.id })).threads).toHaveLength(1);
    expect((await listEmailThreads(b.id, { contactId: other.id })).threads).toHaveLength(0);
    expect((await listEmailThreads(b.id, { contactId: c1.id })).threads).toHaveLength(0);
    expect(await emailsOf(b.id)).toHaveLength(0);
  });
});

// ---------- Templates ----------

describe('Templates', () => {
  it('render con variables, custom, fallback y faltantes', () => {
    const ctx = {
      contact: { first_name: 'Ana', last_name: 'Gómez', email: 'ana@x.test', custom: JSON.stringify({ plan: 'Pro' }) },
      company: { name: 'Acme' },
      deal: null,
      owner: { name: 'Lauta Schiaffino', email: 'l@z.test' },
    };
    const r = renderEmailTemplate(
      'Hola {{contact.first_name}} de {{ contact.company }}, plan {{contact.custom.plan}}. {{deal.name | tu proyecto}} {{contact.job_title}} {{nope.x}} — {{owner.first_name}}',
      ctx,
    );
    expect(r.text).toBe('Hola Ana de Acme, plan Pro. tu proyecto   — Lauta');
    expect(r.missing.sort()).toEqual(['contact.job_title', 'nope.x']);
  });

  it('permisos: admin o creador; aislado por workspace', async () => {
    const u = await makeUser('tpl');
    const other = await makeUser('tpl2');
    const t = await createEmailTemplate(u.id, 'member-1', { name: 'Intro', subject: 'Hola', body: 'Cuerpo' });
    expect(canManageOwned({ isAdmin: false, personId: 'member-1' }, t.created_by)).toBe(true);
    expect(canManageOwned({ isAdmin: false, personId: 'member-2' }, t.created_by)).toBe(false);
    expect(canManageOwned({ isAdmin: true, personId: 'member-2' }, t.created_by)).toBe(true);
    expect(await getEmailTemplate(other.id, t.id)).toBeNull();
  });
});

// ---------- Tracking ----------

describe('Tracking', () => {
  const token = 'a'.repeat(32);

  it('links firmados: válido redirige; alterado o sin firma no (no hay open redirect)', () => {
    const url = 'https://acme.test/pricing?x=1';
    const link = new URL(clickUrl(token, url, 'https://zerosoft.test'));
    expect(link.pathname).toBe(`/api/crm/t/c/${token}`);
    expect(resolveClickTarget(token, link.searchParams.get('u'), link.searchParams.get('s'))).toBe(url);
    expect(resolveClickTarget(token, 'https://evil.test', link.searchParams.get('s'))).toBeNull();
    expect(resolveClickTarget(token, url, null)).toBeNull();
    expect(resolveClickTarget(token, url, `${link.searchParams.get('s')!.slice(0, -1)}x`)).toBeNull();
    expect(resolveClickTarget('b'.repeat(32), url, link.searchParams.get('s'))).toBeNull();
    expect(resolveClickTarget(token, 'javascript:alert(1)', signTracking(token, 'javascript:alert(1)'))).toBeNull();
  });

  it('heurística: bots, precarga del proxy, scanner y duplicados', () => {
    const sentAt = new Date('2026-10-13T10:00:00Z');
    const base = { kind: 'open' as const, sentAt, lastSameAt: null, priorCounted: 0 };
    const at = (s: number) => new Date(sentAt.getTime() + s * 1000);
    expect(classifyTrackingHit({ ...base, userAgent: 'Googlebot/2.1', now: at(600) })).toBe('bot');
    expect(classifyTrackingHit({ ...base, userAgent: '', now: at(600) })).toBe('bot');
    expect(classifyTrackingHit({ ...base, userAgent: 'Mozilla/5.0', now: at(2) })).toBe('prefetch');
    const proxy = 'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)';
    expect(classifyTrackingHit({ ...base, userAgent: proxy, now: at(30) })).toBe('prefetch');
    expect(classifyTrackingHit({ ...base, userAgent: proxy, now: at(600) })).toBe('count');
    expect(classifyTrackingHit({ ...base, userAgent: proxy, now: at(30), priorCounted: 1 })).toBe('count');
    expect(classifyTrackingHit({ ...base, userAgent: 'Mozilla/5.0', now: at(600), lastSameAt: at(570) })).toBe('duplicate');
    expect(classifyTrackingHit({ ...base, userAgent: 'Mozilla/5.0', now: at(600), lastSameAt: at(530) })).toBe('count');
  });

  it('aperturas y clicks: dedupe 1 min, notificación, trigger email_opened', async () => {
    const u = await makeUser('track');
    const c = await createContact(u.id, { firstName: 'Eva', email: 'eva@client.test' });
    const wf = await createWorkflow(u.id, {
      name: 'Abrió',
      enabled: true,
      triggers: [{ type: 'email_opened' }],
      actions: [{ type: 'notify_user', config: { message: 'abrió' } }],
    });
    const sent = await sendCrmEmail(u.id, {
      senderId: u.id,
      senderEmail: u.email,
      contactId: c.id,
      to: 'eva@client.test',
      subject: 'Precios',
      body: 'Mirá https://acme.test/pricing.',
    });
    expect(sent.ok && sent.via).toBe('system'); // sin Gmail conectado → envío del sistema
    if (!sent.ok) throw new Error('send failed');
    const email = sent.email;
    expect(email.tracking_token).toMatch(/^[a-f0-9]{32}$/);
    expect(email.body_html).toContain(`/api/crm/t/c/${email.tracking_token}`);
    const t0 = new Date(Date.now() + 10 * 60_000);
    const ua = 'Mozilla/5.0 (Macintosh)';
    expect(await recordTrackingHit(email.tracking_token!, 'open', { userAgent: ua, now: t0 })).toBe('count');
    expect(await recordTrackingHit(email.tracking_token!, 'open', { userAgent: ua, now: new Date(t0.getTime() + 20_000) })).toBe('duplicate');
    expect(await recordTrackingHit(email.tracking_token!, 'open', { userAgent: 'Slackbot 1.0', now: new Date(t0.getTime() + 90_000) })).toBe('bot');
    expect(await recordTrackingHit(email.tracking_token!, 'open', { userAgent: ua, now: new Date(t0.getTime() + 90_000) })).toBe('count');
    expect(await recordTrackingHit(email.tracking_token!, 'click', { userAgent: ua, url: 'https://acme.test/pricing', now: t0 })).toBe('count');
    expect(await recordTrackingHit('f'.repeat(32), 'open', { userAgent: ua })).toBe('unknown');

    const row = (await getDb().prepare('SELECT * FROM crm_emails WHERE id = ?').get(email.id)) as CrmEmailRow;
    expect(row.open_count).toBe(2);
    expect(row.click_count).toBe(1);
    const thread = (await listEmailThreads(u.id, { contactId: c.id })).threads[0];
    expect(thread.messages[0].clicks).toEqual([{ url: 'https://acme.test/pricing', count: 1 }]);
    const notes = (await getDb().prepare("SELECT title FROM notifications WHERE user_id = ? AND type = 'email_activity'").all(u.id)) as Array<{ title: string }>;
    expect(notes).toHaveLength(2); // primera apertura + primer click a esa URL
    expect((await listWorkflowRuns(u.id, wf.id)).length).toBe(2);
  });

  it('sin tracking (setting o por email) no hay pixel ni links reescritos', async () => {
    const u = await makeUser('notrack');
    const c = await createContact(u.id, { email: 'x@client.test' });
    const res = await sendCrmEmail(u.id, { senderId: u.id, senderEmail: u.email, contactId: c.id, to: 'x@client.test', subject: 's', body: 'https://acme.test', tracking: false });
    expect(res.ok && res.email.tracking_token).toBeNull();
    expect(res.ok && res.email.body_html).not.toContain('/api/crm/t/');
  });
});

// ---------- Secuencias ----------

const BA = { timezone: 'America/Argentina/Buenos_Aires', windowStart: '09:00', windowEnd: '17:00', businessDays: true };

describe('Secuencias: scheduling', () => {
  it('ventana de envío en la zona horaria y días hábiles', () => {
    // Sábado 12:00 UTC → lunes 09:00 en Buenos Aires (12:00 UTC).
    expect(nextSendSlot(new Date('2026-10-17T12:00:00Z'), BA).toISOString()).toBe('2026-10-19T12:00:00.000Z');
    // Miércoles 18:00 local (fuera de ventana) → jueves 09:00 local.
    expect(nextSendSlot(new Date('2026-10-14T21:00:00Z'), BA).toISOString()).toBe('2026-10-15T12:00:00.000Z');
    // Dentro de la ventana: ahora.
    expect(nextSendSlot(new Date('2026-10-14T15:00:00Z'), BA).toISOString()).toBe('2026-10-14T15:00:00.000Z');
    // Antes de abrir: hoy a las 09:00.
    expect(nextSendSlot(new Date('2026-10-14T10:00:00Z'), BA).toISOString()).toBe('2026-10-14T12:00:00.000Z');
    // Sin días hábiles, el sábado vale.
    expect(nextSendSlot(new Date('2026-10-17T13:00:00Z'), { ...BA, businessDays: false }).toISOString()).toBe('2026-10-17T13:00:00.000Z');
  });

  it('esperas: días corridos o hábiles', () => {
    const friday = new Date('2026-10-16T15:00:00Z');
    expect(addWaitDays(friday, 1, BA).toISOString()).toBe('2026-10-19T15:00:00.000Z');
    expect(addWaitDays(friday, 3, BA).toISOString()).toBe('2026-10-21T15:00:00.000Z');
    expect(addWaitDays(friday, 1, { ...BA, businessDays: false }).toISOString()).toBe('2026-10-17T15:00:00.000Z');
    expect(addWaitDays(friday, 0, BA).toISOString()).toBe(friday.toISOString());
  });
});

async function setupSequence(label: string) {
  const u = await makeUser(label);
  await connectGmail(u.id);
  const c = await createContact(u.id, { firstName: 'Gabi', email: `gabi-${label}@client.test` });
  const tpl = await createEmailTemplate(u.id, u.id, { name: 'Intro', subject: 'Hola {{contact.first_name}}', body: 'Hola {{contact.first_name}}, ¿hablamos?' });
  const seq = await createSequence(u.id, u.id, {
    name: 'Outbound',
    timezone: 'UTC',
    windowStart: '09:00',
    windowEnd: '17:00',
    businessDays: true,
    steps: [
      { type: 'email', templateId: tpl.id },
      { type: 'task', subject: 'Llamar a {{contact.first_name}}' },
      { type: 'wait', waitDays: 2 },
      { type: 'email', body: 'Te escribo de nuevo, {{contact.first_name}}.' },
    ],
  });
  return { u, c, seq };
}

describe('Secuencias: ejecución', () => {
  it('envía por Gmail, crea la tarea, espera días hábiles y responde en el mismo thread', async () => {
    const { u, c, seq } = await setupSequence('seqrun');
    const res = await enrollContacts(u.id, { sequenceId: seq.id, contactIds: [c.id], senderId: u.id, enrolledBy: u.id });
    expect(res).toMatchObject({ ok: true, enrolled: [c.id] });

    const monday = new Date('2026-10-19T10:00:00Z');
    expect(await processSequences({ now: monday })).toMatchObject({ processed: 1, sent: 1 });
    expect(gmail.sent).toHaveLength(1);
    expect(gmail.sent[0].raw).toContain('Subject: Hola Gabi');
    expect(gmail.sent[0].raw).toContain('List-Unsubscribe:');
    let enr = (await listEnrollments(u.id, { sequenceId: seq.id }))[0];
    expect(enr).toMatchObject({ status: 'active', current_step: 3, thread_id: 'thr-sent-1' });
    expect(enr.next_run_at).toBe('2026-10-21 10:00:00');
    const tasks = (await getDb().prepare("SELECT subject FROM crm_activities WHERE user_id = ? AND type = 'task'").all(u.id)) as Array<{ subject: string }>;
    expect(tasks.map((t) => t.subject)).toEqual(['Llamar a Gabi']);

    // Antes de tiempo no pasa nada.
    expect(await processSequences({ now: new Date('2026-10-20T10:00:00Z') })).toMatchObject({ processed: 0 });
    // Vence el miércoles a las 19:00 UTC (fuera de ventana) → reprograma al jueves 09:00.
    expect(await processSequences({ now: new Date('2026-10-21T19:00:00Z') })).toMatchObject({ sent: 0 });
    enr = (await listEnrollments(u.id, { sequenceId: seq.id }))[0];
    expect(enr.next_run_at).toBe('2026-10-22 09:00:00');
    expect(await processSequences({ now: new Date('2026-10-22T09:30:00Z') })).toMatchObject({ sent: 1 });
    expect(gmail.sent[1].threadId).toBe('thr-sent-1');
    expect(gmail.sent[1].raw).toContain('In-Reply-To: <sent-1@mail.gmail.com>');
    expect(gmail.sent[1].raw).toContain('Subject: Re: Hola Gabi');
    enr = (await listEnrollments(u.id, { sequenceId: seq.id }))[0];
    expect(enr.status).toBe('finished');
    const stats = await sequenceStepStats(u.id, seq.id);
    expect(stats.reduce((n, s) => n + s.sent, 0)).toBe(2);
  });

  it('dos ticks concurrentes no envían dos veces', async () => {
    const { u, c, seq } = await setupSequence('seqlock');
    await enrollContacts(u.id, { sequenceId: seq.id, contactIds: [c.id], senderId: u.id, enrolledBy: u.id });
    const now = new Date('2026-10-19T10:00:00Z');
    const [a, b] = await Promise.all([processSequences({ now }), processSequences({ now })]);
    expect(a.sent + b.sent).toBe(1);
    expect(gmail.sent).toHaveLength(1);
  });

  it('sale sola cuando el contacto responde (detectado por el sync)', async () => {
    const { u, c, seq } = await setupSequence('seqreply');
    await enrollContacts(u.id, { sequenceId: seq.id, contactIds: [c.id], senderId: u.id, enrolledBy: u.id });
    await processSequences({ now: new Date('2026-10-19T10:00:00Z') });
    await syncMailbox(u.id, u.id); // trae el enviado (ya guardado: no duplica)
    gmail.add({ id: 'r1', threadId: 'thr-sent-1', from: `Gabi <${c.email}>`, to: 'me@acme.test', subject: 'Re: Hola Gabi', messageId: '<r1@x>', inReplyTo: '<sent-1@mail.gmail.com>', text: 'Sí, hablemos' });
    await syncMailbox(u.id, u.id);
    const enr = (await listEnrollments(u.id, { sequenceId: seq.id }))[0];
    expect(enr).toMatchObject({ status: 'exited', exit_reason: 'replied' });
    const stats = await sequenceStepStats(u.id, seq.id);
    expect(stats.reduce((n, s) => n + s.replied, 0)).toBe(1);
    expect((await emailsOf(u.id)).filter((e) => e.gmail_id === 'sent-1')).toHaveLength(1);
    const thread = (await listEmailThreads(u.id, { contactId: c.id })).threads;
    expect(thread).toHaveLength(1);
    expect(thread[0].messages).toHaveLength(2);
  });

  it('sale sola al agendar una reunión en Cal', async () => {
    const { u, c, seq } = await setupSequence('seqmeet');
    await enrollContacts(u.id, { sequenceId: seq.id, contactIds: [c.id], senderId: u.id, enrolledBy: u.id });
    const { recordBookingInCrm } = await import('@/lib/crm-integrations');
    await recordBookingInCrm(
      u.id,
      'created',
      {
        id: `bk-${crypto.randomUUID()}`,
        invitee_email: c.email,
        invitee_name: 'Gabi',
        starts_at: '2026-10-20T13:00:00.000Z',
        ends_at: '2026-10-20T13:30:00.000Z',
        answers: '{}',
        meeting_url: null,
        host_user_id: null,
        rescheduled_from: null,
      } as never,
      'Intro call',
    );
    const enr = (await listEnrollments(u.id, { sequenceId: seq.id }))[0];
    expect(enr).toMatchObject({ status: 'exited', exit_reason: 'meeting_booked' });
  });

  it('baja: link firmado saca de la secuencia y bloquea nuevas inscripciones', async () => {
    const { u, c, seq } = await setupSequence('sequnsub');
    await enrollContacts(u.id, { sequenceId: seq.id, contactIds: [c.id], senderId: u.id, enrolledBy: u.id });
    await processSequences({ now: new Date('2026-10-19T10:00:00Z') });
    const email = (await emailsOf(u.id)).find((e) => e.enrollment_id)!;
    const link = new URL(unsubscribeUrl(email.tracking_token!, 'https://z.test'));
    expect(await recordUnsubscribe(email.tracking_token!, 'bad')).toBe(false);
    expect(await recordUnsubscribe(email.tracking_token!, link.searchParams.get('s'))).toBe(true);
    const enr = (await listEnrollments(u.id, { sequenceId: seq.id }))[0];
    expect(enr).toMatchObject({ status: 'exited', exit_reason: 'unsubscribed' });
    const again = await enrollContacts(u.id, { sequenceId: seq.id, contactIds: [c.id], senderId: u.id, enrolledBy: u.id });
    expect(again).toMatchObject({ ok: true, enrolled: [], skipped: [{ contactId: c.id, reason: 'unsubscribed' }] });
  });

  it('permisos y aislamiento: Gmail con envío requerido, remitente del workspace, otro workspace no ve nada', async () => {
    const { u, c, seq } = await setupSequence('seqperm');
    const outsider = await makeUser('outsider');
    expect(await enrollContacts(u.id, { sequenceId: seq.id, contactIds: [c.id], senderId: outsider.id, enrolledBy: u.id })).toEqual({ ok: false, error: 'invalid_sender' });

    // Miembro del team sin Gmail → no puede inscribir; con Gmail de solo lectura tampoco.
    const member = await makeUser('member');
    const team = await createTeam(u.id, 'Ventas');
    await addMember(team.id, member.id, 'member');
    expect(await enrollContacts(u.id, { sequenceId: seq.id, contactIds: [c.id], senderId: member.id, enrolledBy: member.id })).toEqual({ ok: false, error: 'gmail_not_connected' });
    await connectGmail(member.id, false);
    expect(await enrollContacts(u.id, { sequenceId: seq.id, contactIds: [c.id], senderId: member.id, enrolledBy: member.id })).toEqual({ ok: false, error: 'gmail_not_connected' });

    // Otro workspace no puede inscribir en esta secuencia ni tocar sus inscripciones.
    await connectGmail(outsider.id);
    expect(await enrollContacts(outsider.id, { sequenceId: seq.id, contactIds: [c.id], senderId: outsider.id, enrolledBy: outsider.id })).toEqual({ ok: false, error: 'not_found' });
    const ok = await enrollContacts(u.id, { sequenceId: seq.id, contactIds: [c.id, 'nope'], senderId: u.id, enrolledBy: u.id });
    expect(ok).toMatchObject({ ok: true, enrolled: [c.id], skipped: [{ contactId: 'nope', reason: 'not_found' }] });
    const enr = (await listEnrollments(u.id, { sequenceId: seq.id }))[0] as CrmSequenceEnrollmentRow;
    expect(await setEnrollmentState(outsider.id, enr.id, 'exit')).toBeNull();
    expect(await listEnrollments(outsider.id, {})).toHaveLength(0);

    // Duplicado mientras está activa; pausar / reanudar / salir.
    const dup = await enrollContacts(u.id, { sequenceId: seq.id, contactIds: [c.id], senderId: u.id, enrolledBy: u.id });
    expect(dup).toMatchObject({ ok: true, skipped: [{ reason: 'already_enrolled' }] });
    expect((await setEnrollmentState(u.id, enr.id, 'pause'))?.status).toBe('paused');
    expect(await processSequences({ now: new Date('2026-10-19T10:00:00Z') })).toMatchObject({ processed: 0 });
    expect((await setEnrollmentState(u.id, enr.id, 'resume'))?.status).toBe('active');
    expect((await setEnrollmentState(u.id, enr.id, 'exit'))?.exit_reason).toBe('manual');
    expect((await getEnrollment(u.id, enr.id))?.status).toBe('exited');
  });

  it('acción de workflow enroll_in_sequence', async () => {
    const { u, c, seq } = await setupSequence('seqwf');
    await createWorkflow(u.id, {
      name: 'Nuevo lead → secuencia',
      enabled: true,
      triggers: [{ type: 'manual' }],
      actions: [{ type: 'enroll_in_sequence', config: { sequenceId: seq.id } }],
    });
    const { runWorkflowsForEvent } = await import('@/lib/crm-workflows');
    await runWorkflowsForEvent(u.id, { type: 'manual', entity: 'contact', entityId: c.id });
    expect((await listEnrollments(u.id, { contactId: c.id }))[0]).toMatchObject({ status: 'active', sender_id: u.id });
  });
});
