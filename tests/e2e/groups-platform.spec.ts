import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Groups, tanda de plataforma (G3) contra el proveedor falso: mensajes
 * recurrentes, encuestas con votos por webhook, filtros de reportes,
 * integraciones (Slack, Freshdesk falso, webhooks con log y reenvío), MCP con
 * API key, acceso por etiqueta y teléfonos ocultos para un miembro, log de
 * auditoría y la app instalable. Nada sale a WhatsApp ni a internet.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

interface NumberInfo {
  id: string;
  webhookUrl: string;
}

async function fakeNumber(request: APIRequestContext): Promise<NumberInfo> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `G3 ${uid()}` } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookUrl: info.webhookUrl };
}

async function events(request: APIRequestContext, n: NumberInfo, list: unknown[]) {
  const res = await request.post(new URL(n.webhookUrl).pathname, { data: { events: list } });
  expect(res.ok(), await res.text()).toBe(true);
}

const message = (chatId: string, body: string, senderName = 'Ana', senderPhone = '5491155550000') => ({
  type: 'message',
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  chatName: chatId.endsWith('@g.us') ? `Cliente ${senderName}` : undefined,
  fromMe: false,
  senderPhone,
  senderName,
  providerMessageId: `g3-${uid()}`,
  body,
});

async function chatByName(request: APIRequestContext, q: string): Promise<{ id: string; name: string }> {
  const res = (await (await request.get(`/api/groups/chats?q=${encodeURIComponent(q)}`)).json()) as { rows: Array<{ id: string; name: string }> };
  expect(res.rows.length, `chat ${q}`).toBeGreaterThan(0);
  return res.rows[0];
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function noHorizontalScroll(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
}

test('mensaje recurrente: se arma en Envíos, muestra las próximas corridas, se pausa y edita', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const tag = uid();
  await events(request, n, [message(`1203639${Date.now()}@g.us`, 'hola', `Rec${tag}`)]);
  await page.goto('/en/app/groups/broadcasts/new?repeat=1', { waitUntil: 'networkidle' });
  await page.getByLabel('From number').selectOption(n.id).catch(() => null);
  await page.getByLabel('Name (only for you)').fill(`Weekly ${tag}`);
  await page.getByRole('textbox', { name: 'Message' }).fill('Hi {{name}}, weekly check-in');
  await expect(page.getByLabel('Repeat', { exact: true })).toBeChecked();
  await page.getByRole('combobox', { name: /^Repeats/ }).selectOption('weekly');
  await page.getByLabel('Time', { exact: true }).fill('09:30');
  await page.getByLabel('Wed').check();
  await expect(page.getByText(/^Next: /)).toBeVisible();
  await page.getByRole('searchbox').fill(`Rec${tag}`);
  await page.getByRole('checkbox', { name: new RegExp(`Rec${tag}`) }).check();
  await page.getByRole('button', { name: /Repeat to 1 chat/ }).click();
  await expect(page).toHaveURL(/\/broadcasts\/recurring\//);
  await expect(page.getByText(/Next run:/)).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText(/Next run:/)).toBeVisible();
  await page.getByRole('combobox', { name: /^Repeats/ }).selectOption('cron');
  await page.getByLabel('Cron expression').fill('0 9 * * 1-5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.goto('/en/app/groups/broadcasts', { waitUntil: 'networkidle' });
  const row = page.getByRole('row', { name: new RegExp(`Weekly ${tag}`) });
  await expect(row).toBeVisible();
  await expect(row.getByText(/Custom \(cron\): 0 9 \* \* 1-5/)).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('encuesta desde el chat con resultados que llegan por webhook', async ({ page, request }) => {
  const n = await fakeNumber(request);
  const gid = `1203638${Date.now()}@g.us`;
  const tag = uid();
  await events(request, n, [message(gid, 'hola', `Poll${tag}`)]);
  const chat = await chatByName(request, `Poll${tag}`);
  await page.goto(`/en/app/groups/inbox/${chat.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Poll', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New poll' });
  await dialog.getByLabel('Question').fill('Which day works?');
  await dialog.getByLabel('Option 1').fill('Monday');
  await dialog.getByLabel('Option 2').fill('Tuesday');
  await dialog.getByRole('button', { name: 'Send poll' }).click();
  await expect(dialog).toBeHidden();
  const poll = page.getByRole('group', { name: 'Poll: Which day works?' });
  await expect(poll).toBeVisible();
  await expect(poll.getByText('No votes yet')).toBeVisible();
  const msgs = (await (await request.get(`/api/groups/chats/${chat.id}/messages`)).json()) as { messages: Array<{ id: string; poll?: unknown }> };
  const pollMsg = msgs.messages.find((m) => m.poll)!;
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  const pid = String((await db.execute({ sql: 'SELECT provider_message_id FROM groups_messages WHERE id = ?', args: [pollMsg.id] })).rows[0].provider_message_id);
  await events(request, n, [
    { type: 'poll_vote', chatId: gid, pollProviderMessageId: pid, voterPhone: '5491100000001', voterName: 'Ana', options: ['Tuesday'] },
    { type: 'poll_vote', chatId: gid, pollProviderMessageId: pid, voterPhone: '5491100000002', voterName: 'Bo', options: ['Tuesday'] },
  ]);
  await expect(poll.getByText('2 people voted')).toBeVisible({ timeout: 10_000 });
});

test('reportes: rango propio y filtro por etiqueta', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const tag = uid();
  await events(request, n, [message(`5491166${Date.now().toString().slice(-6)}@c.us`, 'consulta', `Rep${tag}`)]);
  const chat = await chatByName(request, `Rep${tag}`);
  const label = (await (await request.post('/api/groups/labels', { data: { name: `L${tag}`, color: 'green' } })).json()) as { id: string };
  await request.patch(`/api/groups/chats/${chat.id}`, { data: { labelIds: [label.id] } });
  await page.goto('/en/app/groups/analytics', { waitUntil: 'networkidle' });
  const form = page.getByRole('form', { name: 'Report filters' });
  const today = new Date().toISOString().slice(0, 10);
  // exact: el nombre del select de etiquetas incluye las etiquetas (un uid puede contener "to").
  await form.getByLabel('From', { exact: true }).fill(today);
  await form.getByLabel('To', { exact: true }).fill(today);
  await form.getByLabel('Label').selectOption(label.id);
  await form.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/label=/);
  await expect(page.getByText(`Showing ${today} to ${today}`)).toBeVisible();
  await expect(page.getByRole('link', { name: `Rep${tag}` })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalScroll(page);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('integraciones: Freshdesk crea el ticket allá, webhooks con log y reenvío, Slack', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.goto('/en/app/groups/settings?tab=integrations', { waitUntil: 'networkidle' });
  // Freshdesk (servidor falso en memoria).
  const fd = page.locator('.gr-integration', { hasText: 'Freshdesk' });
  await fd.getByRole('button', { name: /Connect|Edit/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Freshdesk' });
  await dialog.getByLabel('Freshdesk domain').fill('acme');
  await dialog.getByLabel('API key').fill('fd-secret-key');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(fd.getByText('Connected')).toBeVisible();
  // El secreto no vuelve.
  expect(await (await request.get('/api/groups/integrations')).text()).not.toContain('fd-secret-key');
  // Slack con una URL inválida da un error claro.
  const slack = page.locator('.gr-integration', { hasText: 'Slack' });
  await slack.getByRole('button', { name: /Connect|Edit/ }).click();
  const sd = page.getByRole('dialog', { name: 'Slack' });
  await sd.getByLabel('Webhook URL').fill('ftp://nope');
  await sd.getByRole('button', { name: 'Save' }).click();
  await expect(sd.getByRole('alert')).toContainText('Slack');
  await sd.getByLabel('Webhook URL').fill('https://hooks.slack.com/services/T000/B000/XXXX');
  await sd.getByRole('button', { name: 'Save' }).click();
  await expect(sd).toBeHidden();
  await expect(slack.getByText('Connected')).toBeVisible();

  // Webhook saliente a un receptor que no existe: queda en el log como pendiente y se reenvía.
  const url = `http://127.0.0.1:9/g3-${uid()}`;
  await page.getByLabel('Endpoint URL').fill(url);
  await expect(page.getByLabel('Endpoint URL')).toHaveValue(url);
  await page.getByRole('checkbox', { name: 'Chat assigned' }).check();
  await page.getByRole('button', { name: 'Add webhook' }).click();
  await expect(page.getByText(/Signing secret, shown only once/)).toBeVisible();
  const item = page.locator('li', { hasText: url });
  await item.getByRole('button', { name: 'Send test' }).click();
  await item.getByRole('button', { name: 'Log' }).click();
  const log = page.getByRole('dialog', { name: 'Delivery log' });
  await expect(log.getByText('ping', { exact: true }).first()).toBeVisible();
  await log.getByRole('button', { name: 'Resend' }).first().click();
  await expect(page.getByText('Resent')).toBeVisible();
  await log.getByRole('button', { name: 'Close' }).click();

  // Un ticket nuevo aparece vinculado a Freshdesk.
  const n = await fakeNumber(request);
  const tag = uid();
  await events(request, n, [message(`5491177${Date.now().toString().slice(-6)}@c.us`, 'La factura no llegó', `Fd${tag}`)]);
  const chat = await chatByName(request, `Fd${tag}`);
  await request.post('/api/groups/tickets', { data: { chatId: chat.id, title: `Factura ${tag}` } });
  await page.goto('/en/app/groups/tickets', { waitUntil: 'networkidle' });
  await expect(page.getByRole('row', { name: new RegExp(`Factura ${tag}`) }).getByRole('link', { name: /Freshdesk #\d+/ })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('MCP: initialize, tools/list y list_chats con una API key', async ({ request }) => {
  const n = await fakeNumber(request);
  const tag = uid();
  await events(request, n, [message(`5491188${Date.now().toString().slice(-6)}@c.us`, `pedido ${tag}`, `Mcp${tag}`)]);
  const key = ((await (await request.post('/api/keys', { data: { name: `mcp ${tag}`, scopes: ['groups:read'] } })).json()) as { key: string }).key;
  const rpc = (body: unknown) => request.post('/api/v1/groups/mcp', { headers: { authorization: `Bearer ${key}` }, data: body });
  const init = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } })).json();
  expect(init.result.serverInfo.name).toBe('zerosoft-groups');
  expect((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status()).toBe(202);
  const tools = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
  expect(tools.result.tools.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(['list_chats', 'get_messages', 'send_message', 'create_ticket']));
  const call = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_chats', arguments: { q: tag } } })).json();
  expect(call.result.structuredContent.chats[0].name).toBe(`Mcp${tag}`);
  const denied = await (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'send_message', arguments: { chatId: call.result.structuredContent.chats[0].id, body: 'x' } } })).json();
  expect(denied.result.isError).toBe(true);
  expect((await request.post('/api/v1/groups/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status()).toBe(401);
  // API REST: chat, miembros y números.
  const chat = (await (await request.get(`/api/v1/groups/chats/${call.result.structuredContent.chats[0].id}`, { headers: { authorization: `Bearer ${key}` } })).json()) as { data: { name: string } };
  expect(chat.data.name).toBe(`Mcp${tag}`);
  expect((await request.get('/api/v1/groups/numbers', { headers: { authorization: `Bearer ${key}` } })).ok()).toBe(true);
});

test('un miembro ve solo sus etiquetas, con los teléfonos ocultos, y el log de auditoría', async ({ page, request }) => {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  const demo = String((await db.execute("SELECT id FROM users WHERE email = 'demo@zerosoft.ai'")).rows[0].id);
  const boss = `g3-boss-${uid()}`;
  const team = `g3-team-${uid()}`;
  await db.execute({ sql: 'INSERT INTO users (id, email, name) VALUES (?, ?, ?)', args: [boss, `${boss}@test.local`, 'Boss'] });
  await db.execute({ sql: 'INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)', args: [team, 'G3 team', boss] });
  await db.execute({ sql: 'INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)', args: [team, boss, 'owner'] });
  await db.execute({ sql: 'INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)', args: [team, demo, 'admin'] });
  await db.execute({ sql: 'UPDATE users SET active_team_id = ? WHERE id = ?', args: [team, demo] });
  try {
    // Como admin del workspace del jefe: número, chats, etiqueta y ajustes.
    const n = await fakeNumber(request);
    const tag = uid();
    await events(request, n, [
      message(`5491190${Date.now().toString().slice(-6)}@c.us`, 'hola', `Vip${tag}`, '5491199990001'),
      message(`5491191${Date.now().toString().slice(-6)}@c.us`, 'hola', `Otro${tag}`, '5491199990002'),
    ]);
    const vip = await chatByName(request, `Vip${tag}`);
    const label = (await (await request.post('/api/groups/labels', { data: { name: `Cuenta ${tag}`, color: 'blue' } })).json()) as { id: string };
    await page.goto(`/en/app/groups/inbox/${vip.id}`, { waitUntil: 'networkidle' });
    await request.patch(`/api/groups/chats/${vip.id}`, { data: { labelIds: [label.id], assignedTo: demo } });

    await page.goto('/en/app/groups/settings?tab=access', { waitUntil: 'networkidle' });
    await page.getByLabel('Members see only chats with their labels').check();
    await expect(page.getByText('Saved')).toBeVisible();
    await page.getByLabel('Hide for members').check();
    const row = page.locator('li', { hasText: `Cuenta ${tag}` });
    await row.getByRole('button', { name: 'Choose people' }).click();
    const dlg = page.getByRole('dialog', { name: new RegExp(`Cuenta ${tag}`) });
    for (const box of await dlg.getByRole('checkbox').all()) await box.check();
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByText('Nobody yet')).toHaveCount(0);

    // Pasa a miembro.
    await db.execute({ sql: "UPDATE team_members SET role = 'member' WHERE team_id = ? AND user_id = ?", args: [team, demo] });
    const list = (await (await request.get('/api/groups/chats')).json()) as { rows: Array<{ name: string; phone: string }> };
    expect(list.rows.map((r) => r.name)).toContain(`Vip${tag}`);
    expect(list.rows.map((r) => r.name)).not.toContain(`Otro${tag}`);
    expect(list.rows.find((r) => r.name === `Vip${tag}`)!.phone).toContain('•••');
    const other = await db.execute({ sql: "SELECT id FROM groups_chats WHERE name = ?", args: [`Otro${tag}`] });
    expect((await request.get(`/api/groups/chats/${String(other.rows[0].id)}`)).status()).toBe(404);
    const csv = await (await request.get(`/api/groups/export?type=messages&chat=${vip.id}`)).text();
    expect(csv).not.toContain('5491199990001');
    await page.goto(`/en/app/groups/inbox/${vip.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByText(/\+54 ••• /).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('5491199990001');
    // Log de auditoría del chat.
    await page.getByRole('button', { name: 'Details' }).click();
    await page.locator('summary', { hasText: 'Activity' }).click();
    await expect(page.getByText(/assigned the chat to/).first()).toBeVisible();
    await expect(page.getByText(/exported messages/).first()).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
    await noHorizontalScroll(page);
  } finally {
    await db.execute({ sql: 'UPDATE users SET active_team_id = NULL WHERE id = ?', args: [demo] });
  }
});

test('app instalable: manifiesto, service worker y panel de notificaciones en claro y oscuro', async ({ page, request, context, baseURL }) => {
  // Un solo manifest y un solo service worker para toda la suite (CRM offline + push de Groups).
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ short_name: 'zerosoft', display: 'standalone', start_url: '/app' });
  expect((manifest.shortcuts as Array<{ url: string }>).map((s) => s.url)).toContain('/app/groups/inbox');
  const icon = await request.get('/api/pwa-icon/512');
  expect(icon.headers()['content-type']).toContain('image/png');
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toContain("addEventListener('push'");
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    const errors = watchErrors(page);
    await page.goto('/en/app/groups/settings?tab=apps', { waitUntil: 'networkidle' });
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
    await expect(page.getByRole('heading', { name: 'Install the app' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on notifications' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/'))?.active?.scriptURL ?? ''))
      .toMatch(/\/sw\.js$/);
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalScroll(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(errors, errors.join('\n')).toEqual([]);
  }
});
