import { createServer, type Server } from 'http';
import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Talk, ronda 2: pestañas de Canvas y Listas, secciones del sidebar, perfil,
 * horario de no molestar, IA (modelo falso; con talk_ai_fake=off se ve
 * ai_disabled), slash commands de una app (receptor local), huddle entre dos
 * pestañas (WebRTC con dispositivos falsos) e invitado en otro workspace.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const PORT = Number(process.env.E2E_PORT) || 3210;

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

async function newChannel(request: APIRequestContext, name = `p2-${uid()}`) {
  return ok<{ id: string; name: string }>(request.post('/api/talk/channels', { data: { name, kind: 'public' } }));
}

async function openChannel(page: Page, id: string, qs = '') {
  await page.goto(`/en/app/talk/${id}${qs}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.talk-channel')).toBeVisible();
}

// Huddles: micrófono falso del navegador (sin diálogo de permiso).
test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('canvas del canal: crear, escribir, recargar y encontrarlo con ⌘K', async ({ page, request }) => {
  const ch = await newChannel(request);
  await openChannel(page, ch.id);
  await page.getByRole('tab', { name: 'Canvas' }).click();
  await expect(page.getByText('No canvas yet')).toBeVisible();
  await page.getByTestId('talk-canvas-create').click();
  const title = page.locator('.talk-canvas .docs-title');
  await expect(title).toBeVisible();
  const word = `Roadmap${uid()}`;
  await title.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(word);
  await page.locator('.talk-canvas .docs-editable').first().click();
  await page.keyboard.type('Ship the beta on Friday');
  await expect(page.locator('.talk-canvas-bar')).toContainText(/Edited by|Saving/);
  await expect.poll(async () => (await ok<{ canvas: { title: string } | null }>(request.get(`/api/talk/canvas?channelId=${ch.id}`))).canvas?.title, { timeout: 8000 }).toBe(word);
  await page.goto(`/en/app/talk/${ch.id}?tab=canvas`, { waitUntil: 'networkidle' });
  await expect(page.locator('.talk-canvas .docs-title')).toHaveText(word);
  await expect(page.locator('.talk-canvas')).toContainText('Ship the beta on Friday');
  const found = await ok<{ items: Array<{ group: string; href: string }> }>(request.get(`/api/search?q=${word}`));
  expect(found.items.some((i) => i.group === 'talkCanvases' && i.href.includes(ch.id))).toBe(true);
});

test('listas: crear, agregar ítems, cambiar estado y verlos en el tablero', async ({ page, request }) => {
  const ch = await newChannel(request);
  await openChannel(page, ch.id);
  await page.getByRole('tab', { name: 'Lists' }).click();
  await expect(page.getByText('No lists yet')).toBeVisible();
  await page.getByTestId('talk-list-new').click();
  const dialog = page.getByRole('dialog', { name: 'New list' });
  await dialog.getByLabel('Name').fill('Launch tasks');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Launch tasks' })).toBeVisible();
  await page.getByTestId('talk-list-add').fill('Write the landing');
  await page.keyboard.press('Enter');
  await page.getByTestId('talk-list-add').fill('Record the demo');
  await page.keyboard.press('Enter');
  const table = page.locator('.talk-table');
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await table.getByLabel('Status: Write the landing').selectOption('Done');
  await page.getByRole('tab', { name: 'Board' }).click();
  const done = page.getByRole('listitem', { name: 'Done' });
  await expect(done).toContainText('Write the landing');
  await expect(page.getByRole('listitem', { name: 'None' })).toContainText('Record the demo');
  // Comentarios del ítem (hilo por ítem).
  await done.getByRole('button', { name: 'Write the landing' }).click();
  const item = page.getByRole('dialog', { name: 'Write the landing' });
  await item.getByLabel('Write a comment').fill('Copy is ready');
  await item.getByRole('button', { name: 'Send' }).click();
  await expect(item.locator('.talk-item-comment')).toContainText('Copy is ready');
  await item.press('Escape');
  // Se recarga y sigue igual.
  await page.goto(`/en/app/talk/${ch.id}?tab=lists`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Launch tasks' })).toBeVisible();
});

test('secciones propias: crear, mover un canal, renombrar y borrar sin recargar', async ({ page, request }) => {
  const ch = await newChannel(request);
  await openChannel(page, ch.id);
  await page.getByRole('button', { name: `Options for ${ch.name}` }).click();
  await page.getByRole('menuitem', { name: 'New section…' }).click();
  const d = page.getByRole('dialog', { name: 'New section' });
  const name = `Projects ${uid()}`;
  await d.getByLabel('Name').fill(name);
  await d.getByRole('button', { name: 'Create' }).click();
  const section = page.locator('.talk-side-section', { has: page.getByRole('button', { name: name, exact: false }) });
  await expect(section.getByRole('link', { name: ch.name })).toBeVisible();
  await page.getByRole('button', { name: `Options for section ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const r = page.getByRole('dialog', { name: 'Rename section' });
  await r.getByLabel('Name').fill(`${name} 2`);
  await r.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: `Options for section ${name} 2` })).toBeVisible();
  await page.getByRole('button', { name: `Options for section ${name} 2` }).click();
  await page.getByRole('menuitem', { name: 'Delete section' }).click();
  await expect(page.getByRole('button', { name: `Options for section ${name} 2` })).toHaveCount(0);
  await expect(page.locator('[data-section="channels"]').getByRole('link', { name: ch.name })).toBeVisible();
});

test('perfil con cargo y zona horaria, y horario de no molestar', async ({ page }) => {
  await page.goto('/en/app/talk', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Talk preferences' }).click();
  const prefs = page.getByRole('dialog', { name: 'Talk preferences' });
  await prefs.getByRole('button', { name: 'My profile' }).click();
  await page.getByTestId('talk-edit-profile').click();
  const edit = page.getByRole('dialog', { name: 'Your profile' });
  await edit.getByLabel('Title').fill('Head of Ops');
  await edit.getByLabel('Time zone').selectOption('Europe/Madrid');
  await edit.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Talk preferences' }).click();
  await page.getByRole('dialog', { name: 'Talk preferences' }).getByRole('button', { name: 'My profile' }).click();
  const card = page.getByTestId('talk-profile');
  await expect(card).toContainText('Head of Ops');
  await expect(page.getByRole('dialog').getByText('Europe/Madrid')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Talk preferences' }).click();
  const p2 = page.getByRole('dialog', { name: 'Talk preferences' });
  await p2.getByTestId('talk-dnd-schedule').check();
  await p2.getByLabel('From').fill('21:00');
  await p2.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  const boot = await ok<{ prefs: { dnd: { enabled: boolean; start: string } } }>(page.request.get('/api/talk/bootstrap'));
  expect(boot.prefs.dnd).toMatchObject({ enabled: true, start: '21:00' });
});

test('IA: resumen del canal con el modelo falso y error claro sin IA', async ({ page, request, context }) => {
  const ch = await newChannel(request);
  for (const body of ['We agreed to launch on Monday', 'Lucia owns the pricing page']) {
    await ok(request.post(`/api/talk/channels/${ch.id}/messages`, { data: { body } }));
  }
  await openChannel(page, ch.id);
  await page.getByTestId('talk-summarize').click();
  const d = page.getByRole('dialog', { name: `Summary of #${ch.name}` });
  await d.getByLabel('What to summarize').selectOption('day');
  await d.getByTestId('talk-ai-run').click();
  await expect(d.getByTestId('talk-ai-summary')).toContainText('2 messages');
  await d.press('Escape');
  await context.addCookies([{ name: 'talk_ai_fake', value: 'off', url: `http://localhost:${PORT}` }]);
  await page.getByTestId('talk-summarize').click();
  const d2 = page.getByRole('dialog', { name: `Summary of #${ch.name}` });
  await d2.getByLabel('What to summarize').selectOption('day');
  await d2.getByTestId('talk-ai-run').click();
  await expect(d2.getByRole('alert')).toHaveText("AI isn't available in this workspace right now.");
  await context.clearCookies({ name: 'talk_ai_fake' });
});

test.describe('slash command de una app', () => {
  let server: Server;
  const port = PORT + 7;
  test.beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const text = new URLSearchParams(body).get('text') ?? '';
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(text === 'public' ? { text: 'Deployed to prod', response_type: 'in_channel' } : { text: `Only you: ${text}` }));
      });
    });
    await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()));
  });
  test.afterAll(() => server.close());

  test('el comando aparece en el editor, responde solo a mí o en el canal', async ({ page, request }) => {
    const name = `deploy${uid()}`;
    const created = await ok<{ secret: string }>(request.post('/api/talk/commands', { data: { command: `/${name}`, url: `http://127.0.0.1:${port}/hook`, description: 'Deploy the app' } }));
    expect(created.secret).toHaveLength(48);
    const ch = await newChannel(request);
    await openChannel(page, ch.id);
    const input = page.locator('.talk-channel .talk-input').last();
    await input.fill(`/${name.slice(0, 4)}`);
    await expect(page.getByRole('option', { name: new RegExp(`/${name}`) })).toBeVisible();
    await input.fill(`/${name} staging`);
    await input.press('Enter');
    await expect(page.getByTestId('talk-ephemeral')).toContainText('Only you: staging');
    await expect(page.getByTestId('talk-ephemeral')).toContainText('Only visible to you');
    await input.fill(`/${name} public`);
    await input.press('Enter');
    await expect(page.locator('[data-testid="talk-message"]', { hasText: 'Deployed to prod' })).toBeVisible();
  });
});

test.describe('huddle', () => {
  test('dos pestañas se conectan por WebRTC y se ven en el huddle', async ({ browser, request }) => {
    const ch = await newChannel(request);
    const ctxA = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1280, height: 800 } });
    const ctxB = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1280, height: 800 } });
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    await openChannel(a, ch.id);
    await a.getByTestId('talk-huddle-button').click();
    await expect(a.getByTestId('talk-huddle')).toContainText("You're the only one here");
    await openChannel(b, ch.id);
    await expect(b.getByTestId('talk-huddle-button')).toHaveText(/Join huddle \(1\)/, { timeout: 15_000 });
    await b.getByTestId('talk-huddle-button').click();
    await expect(b.getByTestId('talk-huddle')).toContainText('2 people in the huddle', { timeout: 30_000 });
    await expect(a.getByTestId('talk-huddle')).toContainText('2 people in the huddle', { timeout: 30_000 });
    await b.getByRole('button', { name: 'Mute' }).click();
    await expect(b.getByRole('button', { name: 'Unmute' })).toBeVisible();
    await b.getByTestId('talk-huddle').getByRole('button', { name: 'Leave' }).click();
    await expect(b.getByTestId('talk-huddle')).toHaveCount(0);
    await expect(a.getByTestId('talk-huddle')).toContainText("You're the only one here", { timeout: 30_000 });
    // Cerrar la pestaña en medio del huddle avisa la salida (sendBeacon), sin esperar los 45 s del barrido.
    await b.getByTestId('talk-huddle-button').click();
    await expect(a.getByTestId('talk-huddle')).toContainText('2 people in the huddle', { timeout: 30_000 });
    await b.close({ runBeforeUnload: true });
    await expect(a.getByTestId('talk-huddle')).toContainText("You're the only one here", { timeout: 15_000 });
    // El hilo del huddle quedó en el canal.
    await expect(a.locator('[data-testid="talk-message"]', { hasText: 'started a huddle' })).toBeVisible();
    await ctxA.close();
    await ctxB.close();
  });
});

test('invitado en otro workspace: solo ve su canal, sin directorio ni crear canales', async ({ page, context, request }) => {
  const host = `host-${uid()}`;
  await sql('INSERT INTO users (id, email, name, handle) VALUES (?, ?, ?, ?)', [host, `${host}@example.com`, 'Acme Host', host]);
  await sql("INSERT INTO teams (id, name, owner_id) VALUES (?, 'Acme', ?)", [`t-${host}`, host]);
  const now = new Date().toISOString();
  const shared = `ch-${uid()}`;
  const secret = `ch-${uid()}`;
  for (const [id, name] of [
    [shared, `client-${uid()}`],
    [secret, `internal-${uid()}`],
  ]) {
    await sql("INSERT INTO talk_channels (id, workspace_id, kind, name, created_by, created_at, updated_at) VALUES (?, ?, 'public', ?, ?, ?, ?)", [id, host, name, host, now, now]);
    await sql("INSERT INTO talk_members (channel_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)", [id, host, now]);
  }
  await sql("INSERT INTO talk_messages (id, workspace_id, channel_id, user_id, body, created_at) VALUES (?, ?, ?, ?, 'internal numbers', ?)", [`m-${uid()}`, host, secret, host, now]);
  await sql('INSERT INTO talk_guests (workspace_id, user_id, created_at) VALUES (?, ?, ?)', [host, 'demo', now]);
  await sql("INSERT INTO talk_members (channel_id, user_id, role, joined_at) VALUES (?, 'demo', 'member', ?)", [shared, now]);

  await context.addCookies([{ name: 'zs_talk_ws', value: host, url: `http://localhost:${PORT}` }]);
  await page.goto(`/en/app/talk/${shared}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('note')).toHaveText(/You're a guest here/);
  await expect(page.getByTestId('talk-workspace-switch')).toHaveValue(host);
  await expect(page.getByRole('button', { name: 'Browse channels' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create a channel' })).toHaveCount(0);
  expect((await page.request.get(`/api/talk/channels/${secret}`)).status()).toBe(404);
  const search = await ok<{ results: unknown[] }>(page.request.get('/api/talk/search?q=internal'));
  expect(search.results).toHaveLength(0);
  expect((await page.request.post('/api/talk/channels', { data: { name: 'nope', kind: 'public' } })).status()).toBe(403);
  // Sacarlo del workspace le corta el acceso en la próxima pedida.
  await sql('DELETE FROM talk_guests WHERE workspace_id = ? AND user_id = ?', [host, 'demo']);
  expect((await page.request.get(`/api/talk/channels/${shared}`)).status()).toBe(404);
  await context.clearCookies({ name: 'zs_talk_ws' });
  void request;
});

test('390 px y oscuro: pestañas y huddle sin scroll horizontal', async ({ page, request }) => {
  const ch = await newChannel(request);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 800 });
  await openChannel(page, ch.id, '?tab=lists');
  await expect(page.getByText('No lists yet')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('tab', { name: 'Canvas' }).click();
  await expect(page.getByText('No canvas yet')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
