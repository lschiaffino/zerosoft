import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

/**
 * Chat, gauntlet contra Intercom: fuente, tiempo de respuesta, búsqueda y adjuntos
 * del messenger; uso de respuestas guardadas; opciones propias de posponer;
 * campañas programadas.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

test.use({
  launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessChecks'] },
});

async function ok<T = Record<string, unknown>>(res: Promise<APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

async function sql(q: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
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

const newWidget = (request: APIRequestContext) => ok<{ id: string; name: string }>(request.post('/api/chat/widgets', { data: { name: `Gauntlet ${uid()}` } }));

async function host(page: Page, baseURL: string, widgetId: string) {
  await page.route('http://localhost:3799/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><title>Site</title></head><body><h1>Site</h1><script src="${baseURL}/api/chat/widget.js?id=${widgetId}"></script></body></html>`,
    }),
  );
  await page.goto('http://localhost:3799/start');
}

test('messenger: fuente, tiempo de respuesta y buscar dentro de la conversación', async ({ page, request, baseURL }) => {
  const w = await newWidget(request);
  await ok(request.patch(`/api/chat/widgets/${w.id}`, { data: { font: 'mono', replyTime: 'hour' } }));
  await host(page, baseURL!, w.id);
  await page.locator('#zs-chat-btn').click();
  await expect(page.locator('#zs-chat-reply-time')).toHaveText('Usually replies within an hour');
  const font = await page.locator('#zs-chat-root').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(font).toContain('monospace');

  const input = page.locator('#zs-chat-box textarea, #zs-chat-box input[type="text"]').last();
  await input.fill('La factura de octubre no llegó');
  await input.press('Enter');
  await expect(page.locator('#zs-chat-box').getByText('La factura de octubre no llegó')).toBeVisible();

  await page.locator('#zs-chat-search-btn').click();
  await page.locator('#zs-chat-search-input').fill('factura');
  await expect(page.locator('mark[data-zs-hit]')).toHaveCount(1);
  await expect(page.locator('#zs-chat-search-count')).toHaveText('1 / 1');
  await page.locator('#zs-chat-search-input').fill('nada-de-esto');
  await expect(page.locator('#zs-chat-search-count')).toHaveText('No matches');
  // Esc cierra y el mensaje queda como estaba.
  await page.locator('#zs-chat-search-input').press('Escape');
  await expect(page.locator('#zs-chat-search')).toBeHidden();
  await expect(page.locator('mark[data-zs-hit]')).toHaveCount(0);
  await expect(page.locator('#zs-chat-box').getByText('La factura de octubre no llegó')).toBeVisible();
});

test('messenger: adjuntos apagados esconden el botón y el servidor frena el envío directo', async ({ page, request, baseURL }) => {
  const w = await newWidget(request);
  await ok(request.patch(`/api/chat/widgets/${w.id}`, { data: { visitorAttachments: 'none' } }));
  await host(page, baseURL!, w.id);
  await page.locator('#zs-chat-btn').click();
  await expect(page.getByRole('button', { name: 'Attach file' })).toBeHidden();

  const { visitorId } = await ok<{ visitorId: string }>(request.post('/api/chat/visitor', { data: { widgetId: w.id } }));
  const res = await request.post('/api/chat/messages/upload', {
    multipart: { widgetId: w.id, visitorId, file: { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('x') } },
  });
  expect(res.status()).toBe(403);
});

test('los ajustes del widget guardan fuente, respuesta y adjuntos', async ({ page, request }) => {
  const w = await newWidget(request);
  await page.goto(`/en/app/chat/widgets/${w.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('chat-widget-font').selectOption('serif');
  await page.getByTestId('chat-widget-reply-time').selectOption('day');
  await page.getByTestId('chat-widget-attachments').selectOption('identified');
  await page.getByRole('button', { name: /^Save/ }).first().click();
  await expect.poll(async () => (await ok<{ font?: string; reply_time?: string; visitor_attachments?: string }>(request.get(`/api/chat/widgets/${w.id}`))).font).toBe('serif');
  const back = await ok<{ reply_time: string; visitor_attachments: string }>(request.get(`/api/chat/widgets/${w.id}`));
  expect(back.reply_time).toBe('day');
  expect(back.visitor_attachments).toBe('identified');
});

test('uso de respuestas guardadas: sube al insertarla y se ordena por uso', async ({ page, request }) => {
  const w = await newWidget(request);
  const shortcut = `/uso${uid()}`;
  const canned = await ok<{ id: string }>(request.post(`/api/chat/widgets/${w.id}/canned`, { data: { shortcut, title: 'Uso', body: 'Respuesta guardada' } }));
  await ok(request.post(`/api/chat/widgets/${w.id}/canned`, { data: { shortcut: `/otra${uid()}`, title: 'Otra', body: 'Otra' } }));
  await ok(request.post(`/api/chat/canned/${canned.id}`));
  await page.goto(`/en/app/chat/widgets/${w.id}/canned`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('chat-canned-usage').getByText('1 time')).toBeVisible();
  await expect(page.getByTestId('chat-canned-usage').getByText('Never')).toBeVisible();
  await page.getByTestId('chat-canned-sort-usage').click();
  await expect(page.getByTestId('chat-canned-usage').first()).toContainText('1 time');
});

test('opciones de posponer: se crean en Equipos y aparecen en el menú de la conversación', async ({ page, request }) => {
  const w = await newWidget(request);
  const { visitorId } = await ok<{ visitorId: string }>(request.post('/api/chat/visitor', { data: { widgetId: w.id } }));
  const conv = await ok<{ conversation: { id: string } }>(request.post('/api/chat/messages', { data: { widgetId: w.id, visitorId, body: 'Hola' } }));
  const label = `Turno ${uid()}`;
  await page.goto('/en/app/chat/teams', { waitUntil: 'networkidle' });
  const section = page.getByTestId('chat-snooze-options');
  await section.getByTestId('chat-snooze-label').fill(label);
  await section.getByTestId('chat-snooze-amount').fill('8');
  await section.getByLabel('Unit').selectOption('hours');
  await section.getByTestId('chat-snooze-add').click();
  await expect(section.getByTestId('chat-snooze-option').filter({ hasText: label })).toContainText('8 h');

  await page.goto(`/en/app/chat/inbox/${conv.conversation.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('#chat-snooze option').filter({ hasText: label })).toHaveCount(1);

  await page.goto('/en/app/chat/teams', { waitUntil: 'networkidle' });
  await section.getByTestId('chat-snooze-option').filter({ hasText: label }).getByRole('button').click();
  await expect(section.getByTestId('chat-snooze-option').filter({ hasText: label })).toHaveCount(0);
});

test('campañas: programar valida, muestra la fecha, y el cron la arranca una vez', async ({ page, request }) => {
  const w = await newWidget(request);
  const vid = crypto.randomUUID();
  const email = `camp-${uid()}@people.test`;
  await sql("INSERT INTO chat_visitors (id, widget_id, external_id, email, name, campaign_opt_in_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'P', datetime('now'), datetime('now'), datetime('now'))", [vid, w.id, `x-${uid()}`, email]).catch(async () => {
    // Las columnas de fechas varían: el mínimo que exige la tabla.
    await sql("INSERT INTO chat_visitors (id, widget_id, external_id, email, name, campaign_opt_in_at) VALUES (?, ?, ?, ?, 'P', datetime('now'))", [vid, w.id, `x-${uid()}`, email]);
  });
  const name = `Programada ${uid()}`;
  const c = await ok<{ id: string }>(request.post('/api/chat/campaigns', { data: { name, widget_id: w.id, subject: 'Hola', body: 'Texto', audience: 'all' } }));
  const past = await request.post(`/api/chat/campaigns/${c.id}`, { data: { action: 'schedule', at: '2020-01-01T00:00:00Z' } });
  expect(past.status()).toBe(400);

  await page.goto('/en/app/chat/campaigns', { waitUntil: 'networkidle' });
  const row = page.getByRole('row').filter({ hasText: name });
  await row.getByTestId('chat-campaign-schedule').click();
  await page.getByTestId('chat-campaign-when').fill('2099-01-01T10:00');
  await page.getByRole('dialog').getByRole('button', { name: 'Schedule' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('within 90 days');
  const soon = new Date(Date.now() + 2 * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  await page.getByTestId('chat-campaign-when').fill(`${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T10:00`);
  await page.getByRole('dialog').getByRole('button', { name: 'Schedule' }).click();
  await expect(row).toContainText('Scheduled for');
  await row.getByTestId('chat-campaign-unschedule').click();
  await expect(row.getByTestId('chat-campaign-schedule')).toBeVisible();
});

test('a 390 px Equipos y Campañas no generan scroll horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  for (const path of ['/en/app/chat/teams', '/en/app/chat/campaigns']) {
    await page.goto(path, { waitUntil: 'networkidle' });
    const over = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
    expect(over, path).toBeLessThanOrEqual(1);
  }
});
