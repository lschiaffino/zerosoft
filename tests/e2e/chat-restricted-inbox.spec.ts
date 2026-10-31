import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type APIResponse, type Browser, type BrowserContext } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(q: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    // La app escribe en la misma base: un lock momentáneo se reintenta.
    for (let i = 0; ; i++) {
      try {
        return (await db.execute({ sql: q, args })).rows;
      } catch (err) {
        if (i >= 20 || !String(err).includes('SQLITE_BUSY')) throw err;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  } finally {
    db.close();
  }
}

async function ok<T = Record<string, unknown>>(res: Promise<APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

async function demoTeam(): Promise<string> {
  let team = (await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0]?.id as string | undefined;
  if (!team) {
    team = `team-${uid()}`;
    await sql("INSERT INTO teams (id, name, owner_id) VALUES (?, 'Demo team', 'demo')", [team]);
  }
  return team;
}

async function person(browser: Browser, baseURL: string, team: string, role: 'member' | 'admin'): Promise<{ ctx: BrowserContext; id: string }> {
  const email = `inbox-${role}-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const p = await ctx.newPage();
  await p.goto('/en/app', { waitUntil: 'domcontentloaded' });
  await p.close();
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now'), active_team_id = ? WHERE id = ?", [team, id]);
  await sql('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)', [team, id, role, '["chat","agents"]']);
  return { ctx, id };
}

interface Setup {
  team: string;
  widget: { id: string; name: string };
  conversationId: string;
  visitorId: string;
  visitorKey: string;
  body: string;
  visitorName: string;
  visitorEmail: string;
}

async function setup(request: APIRequestContext, team: string): Promise<Setup> {
  const name = `Restricted ${uid()}`;
  const widget = await ok<{ id: string; name: string }>(request.post('/api/chat/widgets', { data: { name } }));
  await sql('UPDATE chat_widgets SET team_id = ? WHERE id = ?', [team, widget.id]);
  const visitorKey = `e2e-${uid()}`;
  const body = `SECRETBODY${uid()}`;
  const visitorName = `SECRETNAME${uid()}`;
  const visitorEmail = `secret${uid()}@x.io`;
  const m = await ok<{ conversation: { id: string }; visitor: { id: string } }>(
    request.post('/api/chat/messages', { data: { widgetId: widget.id, visitorId: visitorKey, body, name: visitorName, email: visitorEmail } }),
  );
  return { team, widget: { id: widget.id, name }, conversationId: m.conversation.id, visitorId: m.visitor.id, visitorKey, body, visitorName, visitorEmail };
}

const restrict = (request: APIRequestContext, widgetId: string, memberIds: string[]) =>
  ok(request.put(`/api/chat/widgets/${widgetId}/access`, { data: { restricted: true, memberIds } }));

async function apiKey(ctx: BrowserContext): Promise<string> {
  const data = await ok<{ key: string }>(ctx.request.post('/api/keys', { data: { name: `chat ${uid()}`, scopes: ['chat:read', 'chat:write'] } }));
  return data.key;
}

test('página de la conversación: quien no está en la lista no recibe nada en el HTML ni en el payload RSC', async ({ request, browser, baseURL }) => {
  const team = await demoTeam();
  const s = await setup(request, team);
  const out = await person(browser, baseURL!, team, 'member');
  const inside = await person(browser, baseURL!, team, 'member');
  await restrict(request, s.widget.id, [inside.id]);

  const secrets = [s.body, s.visitorName, s.visitorEmail, s.widget.name];
  for (const headers of [{} as Record<string, string>, { RSC: '1' }]) {
    const res = await out.ctx.request.get(`/en/app/chat/inbox/${s.conversationId}`, { headers });
    const html = await res.text();
    for (const secret of secrets) expect(html, `se filtró ${secret}`).not.toContain(secret);
  }
  // Las demás páginas con datos de esa bandeja.
  for (const url of [`/en/app/chat/widgets/${s.widget.id}`, `/en/app/chat/widgets/${s.widget.id}/access`, `/en/app/chat/people/${s.visitorId}`, '/en/app/chat/inbox', '/en/app/chat/people', '/en/app/chat/widgets', '/en/app/chat/reports']) {
    const html = await (await out.ctx.request.get(url)).text();
    for (const secret of secrets) expect(html, `${url}: ${secret}`).not.toContain(secret);
  }

  // Positivo: quien está en la lista la abre.
  const page = await inside.ctx.newPage();
  await page.goto(`/en/app/chat/inbox/${s.conversationId}`);
  await expect(page.locator('.chat-message-text', { hasText: s.body })).toBeVisible();
  const html = await (await inside.ctx.request.get(`/en/app/chat/inbox/${s.conversationId}`)).text();
  expect(html).toContain(s.body);

  // Y al sumarlo a la lista, el que estaba afuera entra.
  await restrict(request, s.widget.id, [inside.id, out.id]);
  expect((await (await out.ctx.request.get(`/en/app/chat/inbox/${s.conversationId}`)).text()).includes(s.body)).toBe(true);
  await out.ctx.close();
  await inside.ctx.close();
});

test('API key de un miembro: respeta la lista en todas las rutas v1; la de admin ve todo', async ({ request, browser, baseURL }) => {
  const team = await demoTeam();
  const s = await setup(request, team);
  const out = await person(browser, baseURL!, team, 'member');
  const inside = await person(browser, baseURL!, team, 'member');
  const admin = await person(browser, baseURL!, team, 'admin');
  await ok(request.post(`/api/chat/conversations/${s.conversationId}/messages`, { data: { body: 'NOTA SECRETA', note: true } }));
  await restrict(request, s.widget.id, [inside.id]);
  const auth = (key: string) => ({ Authorization: `Bearer ${key}` });
  const c = `/api/v1/chat/conversations/${s.conversationId}`;

  const outKey = auth(await apiKey(out.ctx));
  const list = await out.ctx.request.get('/api/v1/chat/conversations?limit=200', { headers: outKey });
  expect(list.status()).toBe(200);
  expect(await list.text()).not.toContain(s.conversationId);
  expect((await out.ctx.request.get(c, { headers: outKey })).status()).toBe(404);
  expect((await out.ctx.request.post(`${c}/messages`, { headers: outKey, data: { body: 'hola' } })).status()).toBe(404);
  expect((await out.ctx.request.post(`${c}/assign`, { headers: outKey, data: { assignedTo: null } })).status()).toBe(404);
  expect((await out.ctx.request.post(`${c}/resolve`, { headers: outKey })).status()).toBe(404);
  expect((await out.ctx.request.post(`${c}/reopen`, { headers: outKey })).status()).toBe(404);

  // Positivo: la key de quien está en la lista y la de un admin.
  for (const who of [inside, admin]) {
    const key = auth(await apiKey(who.ctx));
    const got = await who.ctx.request.get(c, { headers: key });
    expect(got.status()).toBe(200);
    expect(await got.text()).toContain('NOTA SECRETA');
    expect(await (await who.ctx.request.get('/api/v1/chat/conversations?limit=200', { headers: key })).text()).toContain(s.conversationId);
  }

  // Asignar por v1: a alguien afuera no; a un admin que no está en la lista, sí.
  const adminKey = auth(await apiKey(admin.ctx));
  expect((await admin.ctx.request.post(`${c}/assign`, { headers: adminKey, data: { assignedTo: out.id } })).status()).toBe(400);
  expect((await admin.ctx.request.post(`${c}/assign`, { headers: adminKey, data: { assignedTo: admin.id } })).status()).toBe(200);
  for (const x of [out, inside, admin]) await x.ctx.close();
});

test('notificaciones: mención, seguidor y asignado viejo que quedan afuera no reciben texto', async ({ request, browser, baseURL }) => {
  const team = await demoTeam();
  const s = await setup(request, team);
  const out = await person(browser, baseURL!, team, 'member');
  const inside = await person(browser, baseURL!, team, 'member');
  await ok(out.ctx.request.post(`/api/chat/conversations/${s.conversationId}/follow`, { data: { follow: true } }));
  await sql('UPDATE chat_conversations SET assigned_to = ? WHERE id = ?', [out.id, s.conversationId]);
  await ok(request.post('/api/chat/messages', { data: { widgetId: s.widget.id, visitorId: s.visitorKey, body: 'antes de restringir' } }));
  expect((await sql('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND source_id = ?', [out.id, s.conversationId]))[0].n).not.toBe(0);

  await restrict(request, s.widget.id, [inside.id]);
  // Al quedar afuera se limpian asignación, seguimiento y sus avisos viejos.
  expect((await sql('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND source_id = ?', [out.id, s.conversationId]))[0].n).toBe(0);
  expect((await sql('SELECT assigned_to FROM chat_conversations WHERE id = ?', [s.conversationId]))[0].assigned_to).toBeNull();
  // Un seguidor o asignado que reaparece igual no recibe.
  await sql('INSERT OR IGNORE INTO chat_conversation_followers (conversation_id, user_id) VALUES (?, ?)', [s.conversationId, out.id]);
  await sql('UPDATE chat_conversations SET assigned_to = ? WHERE id = ?', [out.id, s.conversationId]);
  await ok(request.post('/api/chat/messages', { data: { widgetId: s.widget.id, visitorId: s.visitorKey, body: 'DESPUES SECRETO' } }));
  await ok(
    request.post(`/api/chat/conversations/${s.conversationId}/messages`, { data: { body: 'nota con mención', note: true, mentions: [out.id, inside.id] } }),
  );
  const res = await out.ctx.request.get('/api/notifications');
  const text = await res.text();
  expect(text).not.toContain('DESPUES SECRETO');
  expect(text).not.toContain('nota con mención');
  expect(text).not.toContain(s.visitorName);
  // Positivo: quien está en la lista sí recibe la mención.
  expect(await (await inside.ctx.request.get('/api/notifications')).text()).toContain('nota con mención');
  await out.ctx.close();
  await inside.ctx.close();
});

test('asignación: lote, macro y ausente respetan la lista; un admin afuera de la lista se puede asignar', async ({ request, browser, baseURL }) => {
  const team = await demoTeam();
  const s = await setup(request, team);
  const out = await person(browser, baseURL!, team, 'member');
  const inside = await person(browser, baseURL!, team, 'member');
  const admin = await person(browser, baseURL!, team, 'admin');
  await restrict(request, s.widget.id, [inside.id]);
  const assignee = async () => (await sql('SELECT assigned_to FROM chat_conversations WHERE id = ?', [s.conversationId]))[0].assigned_to;

  const bulk = await ok<{ updated: number; skipped: number }>(
    request.post('/api/chat/conversations/bulk', { data: { ids: [s.conversationId], action: { type: 'assign', assignedTo: out.id } } }),
  );
  expect(bulk.skipped).toBe(1);
  expect(await assignee()).toBeNull();

  const canned = await ok<{ id: string }>(request.post(`/api/chat/widgets/${s.widget.id}/canned`, { data: { title: 'M', shortcut: `m${uid()}`, body: 'x', actions: { assignTo: out.id } } }));
  await sql('UPDATE chat_canned_responses SET actions = ? WHERE id = ?', [JSON.stringify({ assignTo: out.id }), canned.id]);
  await ok(request.post(`/api/chat/conversations/${s.conversationId}/macro`, { data: { cannedId: canned.id } }));
  expect(await assignee()).toBeNull();

  // Un admin siempre ve la bandeja: asignarlo funciona aunque no esté en la lista.
  expect((await request.patch(`/api/chat/conversations/${s.conversationId}`, { data: { assignedTo: out.id } })).status()).toBe(400);
  expect((await request.patch(`/api/chat/conversations/${s.conversationId}`, { data: { assignedTo: admin.id } })).status()).toBe(200);

  // Ausente con reasignar: el reparto no cae en quien está afuera.
  await sql('UPDATE chat_conversations SET assigned_to = ? WHERE id = ?', [inside.id, s.conversationId]);
  await ok(inside.ctx.request.put('/api/chat/agent-status', { data: { away: true, reassign: true } }));
  expect(await assignee()).not.toBe(out.id);
  await ok(inside.ctx.request.put('/api/chat/agent-status', { data: { away: false } }));
  for (const x of [out, inside, admin]) await x.ctx.close();
});

test('reportes propios: el atado a una bandeja restringida no se ve; solo creador o admin editan', async ({ request, browser, baseURL }) => {
  const team = await demoTeam();
  const s = await setup(request, team);
  const out = await person(browser, baseURL!, team, 'member');
  const inside = await person(browser, baseURL!, team, 'member');
  const name = `SECRETREPORT${uid()}`;
  const report = await ok<{ id: string }>(request.post('/api/chat/custom-reports', { data: { name, metric: 'conversations', group_by: 'widget', widget_id: s.widget.id } }));
  await restrict(request, s.widget.id, [inside.id]);

  expect(await (await out.ctx.request.get('/api/chat/custom-reports')).text()).not.toContain(name);
  expect((await out.ctx.request.get(`/api/chat/custom-reports/${report.id}`)).status()).toBe(404);
  expect(await (await out.ctx.request.get(`/api/search?q=${name}`)).json().then((d: { items?: unknown[] }) => d.items ?? [])).toEqual([]);
  expect((await out.ctx.request.delete(`/api/chat/custom-reports/${report.id}`)).status()).toBe(404);

  // Quien está en la lista lo ve pero no lo cambia; lo suyo sí.
  expect((await inside.ctx.request.get(`/api/chat/custom-reports/${report.id}`)).status()).toBe(200);
  expect((await inside.ctx.request.patch(`/api/chat/custom-reports/${report.id}`, { data: { name: 'x' } })).status()).toBe(403);
  expect((await inside.ctx.request.delete(`/api/chat/custom-reports/${report.id}`)).status()).toBe(403);
  const mine = await ok<{ id: string }>(inside.ctx.request.post('/api/chat/custom-reports', { data: { name: `Mío ${uid()}`, metric: 'conversations', group_by: 'day' } }));
  await ok(inside.ctx.request.patch(`/api/chat/custom-reports/${mine.id}`, { data: { name: `Mío ${uid()}` } }));
  await ok(inside.ctx.request.delete(`/api/chat/custom-reports/${mine.id}`));
  await out.ctx.close();
  await inside.ctx.close();
});

test('Agents y Flow: una conversación de bandeja restringida no sale por ahí', async ({ request, browser, baseURL }) => {
  const team = await demoTeam();
  const s = await setup(request, team);
  const out = await person(browser, baseURL!, team, 'member');
  const agent = await ok<{ id: string }>(request.post('/api/agents', { data: { name: `Bot ${uid()}` } }));
  const cid = `ac-${uid()}`;
  await sql(
    "INSERT INTO agent_conversations (id, agent_id, user_id, channel, chat_conversation_id, visitor_key, title, created_at, updated_at) VALUES (?, ?, 'demo', 'chat', ?, ?, ?, datetime('now'), datetime('now'))",
    [cid, agent.id, s.conversationId, s.visitorKey, 'SECRETTITLE'],
  );
  await restrict(request, s.widget.id, []);
  const can = await out.ctx.request.get(`/api/agents/${agent.id}/conversations`);
  if (can.status() === 200) {
    expect(await can.text()).not.toContain(cid);
    expect((await out.ctx.request.get(`/api/agents/${agent.id}/conversations/${cid}`)).status()).toBe(404);
    expect(await (await out.ctx.request.get(`/api/agents/${agent.id}/export`)).text()).not.toContain(s.body);
  }
  // El admin sí ve el listado.
  expect(await (await request.get(`/api/agents/${agent.id}/conversations`)).text()).toContain(cid);

  // Sin eventos de Flow: ni message.received ni conversation.created para esta bandeja.
  const before = (await sql("SELECT COUNT(*) AS n FROM flow_events WHERE data LIKE ?", [`%${s.conversationId}%`]).catch(() => [{ n: 0 }]))[0].n;
  await ok(request.post('/api/chat/messages', { data: { widgetId: s.widget.id, visitorId: s.visitorKey, body: 'sin flow' } }));
  await new Promise((r) => setTimeout(r, 500));
  const after = (await sql("SELECT COUNT(*) AS n FROM flow_events WHERE data LIKE ?", [`%${s.conversationId}%`]).catch(() => [{ n: 0 }]))[0].n;
  expect(after).toBe(before);
  await out.ctx.close();
});

test('stream: solo avisa de bandejas visibles y al reconectar recupera lo perdido', async ({ request, browser, baseURL }) => {
  const team = await demoTeam();
  const s = await setup(request, team);
  const out = await person(browser, baseURL!, team, 'member');
  const inside = await person(browser, baseURL!, team, 'member');
  await restrict(request, s.widget.id, [inside.id]);

  const read = async (ctx: BrowserContext, cursor: number) => {
    const page = await ctx.newPage();
    await page.goto('/en/app');
    const text = await page.evaluate(async (c) => {
      const ctl = new AbortController();
      const res = await fetch(`/api/chat/stream?cursor=${c}`, { signal: ctl.signal });
      const reader = res.body!.getReader();
      let out = '';
      const end = Date.now() + 2500;
      while (Date.now() < end) {
        const part = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), 500))]);
        if (part && 'value' in part && part.value) out += new TextDecoder().decode(part.value);
      }
      ctl.abort();
      return out;
    }, cursor);
    await page.close();
    return text;
  };
  const last = Number((await sql('SELECT MAX(id) AS id FROM chat_events'))[0].id);
  await ok(request.post('/api/chat/messages', { data: { widgetId: s.widget.id, visitorId: s.visitorKey, body: 'mientras no estaba' } }));
  expect(await read(inside.ctx, last)).toContain(s.conversationId);
  expect(await read(out.ctx, last)).not.toContain(s.conversationId);
  await out.ctx.close();
  await inside.ctx.close();
});
