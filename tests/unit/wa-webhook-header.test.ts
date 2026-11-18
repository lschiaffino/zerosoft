/**
 * Webhooks de WhatsApp (Inbox y Lines): el secreto va en un header y no en la
 * ruta (la ruta queda en los logs de requests). La ruta vieja se sigue
 * aceptando mientras haya instancias registradas con ella. Datos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getNumberRowById, readConfig, webhookTargetFor } from '@/lib/groups';
import { connectWhatsapp, webhookTargetFor as inboxTarget } from '@/lib/inbox/whatsapp';
import { managedProvider } from '@/lib/groups-provider-managed';
import { syncEvolutionWebhook } from '@/lib/groups-provider-bridge';
import type { FetchLike } from '@/lib/groups-provider';
import { isLegacyWebhookUrl, WEBHOOK_SECRET_HEADER } from '@/lib/wa-webhook-secret';
import { newWebhookMigrateState, webhookMigrateStep } from '@/lib/wa-webhook-migrate';
import { parseMaintenanceJobs, runMaintenanceJobs } from '@/lib/maintenance-jobs';
import { getClient } from '@/lib/db';
import { makeUser } from './helpers';

const inboxNew = await import('@/app/api/inbox/webhook/[id]/route');
const inboxOld = await import('@/app/api/inbox/webhook/[id]/[secret]/route');
const linesNew = await import('@/app/api/groups/webhook/[id]/route');
const linesOld = await import('@/app/api/groups/webhook/[id]/[secret]/route');

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const message = (id: string) => ({
  events: [{ type: 'message', chatId: '5491100007001@c.us', isGroup: false, fromMe: false, senderPhone: '5491100007001', senderName: 'Prueba', providerMessageId: id, body: 'hola' }],
});

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
}

describe('Inbox: secreto del webhook en un header', () => {
  it('la ruta nueva pide el header; sin él o con otro, el mismo 404; la vieja sigue andando', async () => {
    const user = await makeUser('wh-inbox');
    const { account } = await connectWhatsapp(user.id);
    const secret = account.webhook_secret;
    const id = account.id;
    const params = Promise.resolve({ id });
    const url = `http://localhost/api/inbox/webhook/${id}`;
    expect((await inboxNew.POST(post(url, message('WH-I-0')), { params })).status).toBe(404);
    expect((await inboxNew.POST(post(url, message('WH-I-1'), { [WEBHOOK_SECRET_HEADER]: 'x'.repeat(secret.length) }), { params })).status).toBe(404);
    const ok = await inboxNew.POST(post(url, message('WH-I-2'), { [WEBHOOK_SECRET_HEADER]: secret }), { params });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true });
    // Un id que no existe da lo mismo que un secreto equivocado.
    expect((await inboxNew.POST(post(url, message('WH-I-3'), { [WEBHOOK_SECRET_HEADER]: secret }), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(404);
    const old = await inboxOld.POST(post(`${url}/${secret}`, message('WH-I-4')), { params: Promise.resolve({ id, secret }) });
    expect(old.status).toBe(200);
    // Un secreto vacío en la ruta vieja no pasa.
    expect((await inboxOld.POST(post(`${url}/`, message('WH-I-5')), { params: Promise.resolve({ id, secret: '' }) })).status).toBe(404);
  });

  it('lo que se registra no lleva el secreto en la URL', async () => {
    const t = inboxTarget({ id: 'acc-1', webhook_secret: 'f'.repeat(48) });
    expect(t.url).toMatch(/\/api\/inbox\/webhook\/acc-1$/);
    expect(t.url).not.toContain('f'.repeat(48));
    expect(t.headers[WEBHOOK_SECRET_HEADER]).toBe('f'.repeat(48));
    expect(isLegacyWebhookUrl(t.url, 'f'.repeat(48))).toBe(false);
    expect(isLegacyWebhookUrl(`https://x.test/api/inbox/webhook/acc-1/${'f'.repeat(48)}`, 'f'.repeat(48))).toBe(true);
  });
});

describe('Lines: secreto del webhook en un header', () => {
  it('la ruta nueva pide el header y la vieja sigue andando', async () => {
    const user = await makeUser('wh-lines');
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    const row = (await getNumberRowById(n.id))!;
    const params = Promise.resolve({ id: row.id });
    const url = `http://localhost/api/groups/webhook/${row.id}`;
    expect((await linesNew.POST(post(url, message('WH-L-0')), { params })).status).toBe(404);
    expect((await linesNew.POST(post(url, message('WH-L-1'), { [WEBHOOK_SECRET_HEADER]: 'nope' }), { params })).status).toBe(404);
    expect((await linesNew.POST(post(url, message('WH-L-2'), { [WEBHOOK_SECRET_HEADER]: row.webhook_secret }), { params })).status).toBe(200);
    expect((await linesOld.POST(post(`${url}/${row.webhook_secret}`, message('WH-L-3')), { params: Promise.resolve({ id: row.id, secret: row.webhook_secret }) })).status).toBe(200);
    const n2 = Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM groups_messages WHERE user_id = ?').get(user.id)) as { n: number }).n);
    expect(n2).toBe(2);
  });

  it('la Cloud API de Meta sigue con la ruta (no deja mandar headers propios)', () => {
    const secret = 'a'.repeat(48);
    expect(webhookTargetFor({ id: 'n1', webhook_secret: secret, provider: 'cloud' }, 'https://x.test')).toEqual({ url: `https://x.test/api/groups/webhook/n1/${secret}`, headers: {} });
    const t = webhookTargetFor({ id: 'n1', webhook_secret: secret, provider: 'managed' }, 'https://x.test');
    expect(t.url).not.toContain(secret);
    expect(t.headers).toEqual({ [WEBHOOK_SECRET_HEADER]: secret });
  });
});

describe('Evolution: el header se registra con el webhook', () => {
  function mock() {
    const calls: Array<{ path: string; body: Record<string, unknown> | undefined }> = [];
    const f: FetchLike = async (input, init = {}) => {
      const path = new URL(String(input)).pathname;
      calls.push({ path, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
      let out: unknown = {};
      if (path.startsWith('/instance/connectionState')) out = { instance: { state: 'open' } };
      return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return { calls, f };
  }

  it('connect y setWebhook mandan los headers; sin headers no va el campo', async () => {
    const m = mock();
    const p = managedProvider({ session: 'zs-0123456789abcdef0123', instanceToken: 'a'.repeat(48) }, { fetch: m.f, env: { baseUrl: 'https://bridge.test', globalKey: 'g' } });
    await p.connect('https://z.test/api/groups/webhook/n1', { [WEBHOOK_SECRET_HEADER]: 's'.repeat(48) });
    const sets = m.calls.filter((c) => c.path.startsWith('/webhook/set/'));
    expect(sets.length).toBeGreaterThan(0);
    for (const s of sets) expect((s.body?.webhook as { headers?: unknown }).headers).toEqual({ [WEBHOOK_SECRET_HEADER]: 's'.repeat(48) });
    m.calls.length = 0;
    await p.setWebhook!('https://z.test/api/groups/webhook/n1', { [WEBHOOK_SECRET_HEADER]: 't'.repeat(48) });
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0].body?.webhook).toMatchObject({ url: 'https://z.test/api/groups/webhook/n1', headers: { [WEBHOOK_SECRET_HEADER]: 't'.repeat(48) }, enabled: true });
    m.calls.length = 0;
    await p.connect('https://z.test/api/groups/webhook/n1/old');
    for (const s of m.calls.filter((c) => c.path.startsWith('/webhook/set/'))) expect(s.body?.webhook).not.toHaveProperty('headers');
  });

  it('sumar eventos al webhook no le saca los headers', async () => {
    const sent: unknown[] = [];
    const call = async (path: string, method: string, body?: unknown) => {
      if (method === 'GET') return { url: 'https://z.test/api/groups/webhook/n1', events: ['MESSAGES_UPSERT'], enabled: true, headers: { [WEBHOOK_SECRET_HEADER]: 'k' } };
      sent.push(body);
      return {};
    };
    expect(await syncEvolutionWebhook(call, 'inst')).toBe(true);
    expect((sent[0] as { webhook: { headers: unknown } }).webhook.headers).toEqual({ [WEBHOOK_SECRET_HEADER]: 'k' });
  });
});

describe('trabajo de mantenimiento wa-webhook-header', () => {
  it('dry cuenta sin llamar; apply registra cada línea conectada una vez y sigue con las demás si una falla', async () => {
    expect(parseMaintenanceJobs('wa-webhook-header:dry,wa-webhook-header:apply').jobs).toHaveLength(2);
    const user = await makeUser('wh-migrate');
    const { account } = await connectWhatsapp(user.id);
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected', provider = 'managed' WHERE id = ?").run(n.id);
    const set = vi.fn(async (url: string) => {
      if (url.includes('fail')) throw new Error('unreachable');
    });
    const mine = new Set([account.id, n.id]);
    const deps = {
      inbox: async (id: string) => (mine.has(id) ? { setWebhook: set, url: `https://z.test/api/inbox/webhook/${id}`, headers: { [WEBHOOK_SECRET_HEADER]: 's' } } : null),
      lines: async (id: string) => (mine.has(id) ? { setWebhook: set, url: `https://z.test/fail/${id}`, headers: { [WEBHOOK_SECRET_HEADER]: 's' } } : null),
    };
    const dry = newWebhookMigrateState();
    expect(await webhookMigrateStep(dry, { apply: false, deadline: Date.now() + 10_000, deps })).toBe(true);
    expect(set).not.toHaveBeenCalled();
    expect(dry.inbox.eligible).toBeGreaterThanOrEqual(1);
    expect(dry.lines.eligible).toBeGreaterThanOrEqual(1);

    const apply = newWebhookMigrateState();
    expect(await webhookMigrateStep(apply, { apply: true, deadline: Date.now() + 10_000, deps })).toBe(true);
    expect(set).toHaveBeenCalledWith(`https://z.test/api/inbox/webhook/${account.id}`, { [WEBHOOK_SECRET_HEADER]: 's' });
    expect(apply.inbox.migrated).toBeGreaterThanOrEqual(1);
    expect(apply.lines.failed).toBeGreaterThanOrEqual(1);

    // Por el cron: apply espera al dry, y el informe es solo de cuentas.
    const lines: string[] = [];
    const tick = async (env: string) => runMaintenanceJobs({ env, client: getClient(), log: (l) => lines.push(l), webhookDeps: deps, budgetMs: 10_000 });
    expect((await tick('wa-webhook-header:apply'))?.[0].status).toBe('waiting');
    expect((await tick('wa-webhook-header:dry'))?.[0].status).toBe('done');
    expect((await tick('wa-webhook-header:apply'))?.[0].status).toBe('done');
    expect(lines.join('\n')).not.toMatch(/z\.test|webhook\//);
    // La config de la línea no cambia.
    expect(readConfig((await getNumberRowById(n.id))!)).toBeTruthy();
  });
});
