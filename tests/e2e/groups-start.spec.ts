import http from 'http';
import { createClient } from '@libsql/client';
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';

/**
 * Groups, primer ingreso: una persona nueva llega a la bandeja vacía y tiene
 * dos caminos. Datos de ejemplo (cargar, responder sin salir a WhatsApp,
 * borrar todo) y el QR administrado contra un Evolution API simulado por
 * HTTP en PORT + 31 (playwright.config.ts apunta GROUPS_BRIDGE_URL ahí).
 */

const PORT = Number(process.env.E2E_PORT) || 3210;
const GLOBAL_KEY = 'e2e-bridge-global-key';
const uid = () => Math.random().toString(36).slice(2, 8);
// 1x1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** Una persona nueva con su propio workspace (vacío). */
async function newPerson(browser: Browser, baseURL: string): Promise<{ ctx: BrowserContext; email: string }> {
  const email = `groups-start-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  // El primer pedido crea la persona; después se salta el onboarding.
  await ctx.request.get('/api/groups/numbers');
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", [email]);
  return { ctx, email };
}

test('datos de ejemplo: cargar, responder sin salir a WhatsApp y borrar todo', async ({ browser, baseURL }) => {
  const { ctx } = await newPerson(browser, baseURL!);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  try {
    await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Your WhatsApp inbox is empty' })).toBeVisible();
    // Con el QR administrado, escanear es la acción principal y el ejemplo la otra.
    await expect(page.getByRole('link', { name: 'Scan QR code' })).toBeVisible();
    await page.getByRole('button', { name: 'Try with sample data' }).click();

    const row = page.locator('.gr-row', { hasText: 'Lucía Fernández' });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Sample data: nothing you send goes out to WhatsApp.')).toBeVisible();
    await expect(page.locator('.gr-row')).toHaveCount(11);
    await expect(row.getByText(/Waiting/)).toBeVisible();

    await row.click();
    await expect(page.getByRole('heading', { level: 2, name: 'Lucía Fernández' })).toBeVisible();
    await expect(page.getByText(/Sample number: the message is saved as sent/)).toBeVisible();
    const composer = page.getByLabel('WhatsApp', { exact: true });
    await composer.fill('Hi Lucía, resending the confirmation now.');
    await composer.press('Enter');
    await expect(page.locator('.gr-msg-out', { hasText: 'resending the confirmation' }).getByText('Sent')).toBeVisible();
    await expect(page.locator('.gr-row', { hasText: 'Lucía Fernández' }).getByText(/Waiting/)).toHaveCount(0, { timeout: 10_000 });

    // Un grupo del ejemplo con su imagen y nota interna.
    await page.locator('.gr-row', { hasText: 'Acme · Rollout' }).click();
    await expect(page.locator('.gr-media img')).toBeVisible();
    await expect(page.locator('.gr-messages').getByText(/heads up, the CSV/)).toBeVisible();

    // Borrar el ejemplo deja la bandeja vacía otra vez.
    await page.getByRole('button', { name: 'Delete sample data' }).first().click();
    await page.getByRole('alertdialog', { name: 'Delete the sample data?' }).getByRole('button', { name: 'Delete sample data' }).click();
    await expect(page.getByRole('heading', { name: 'Your WhatsApp inbox is empty' })).toBeVisible({ timeout: 15_000 });
    const numbers = (await (await ctx.request.get('/api/groups/numbers')).json()) as { numbers: unknown[] };
    expect(numbers.numbers).toEqual([]);
    const tickets = (await (await ctx.request.get('/api/groups/tickets')).json()) as { tickets?: unknown[] };
    expect(tickets.tickets ?? []).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

interface Hit {
  method: string;
  path: string;
  apikey: string;
  body: Record<string, unknown> | null;
}

/** Evolution API v2 simulado: QR un par de veces, después conectado, con un grupo. */
function startEvolution() {
  const hits: Hit[] = [];
  let polls = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      hits.push({ method: req.method ?? 'GET', path: url.pathname, apikey: String(req.headers.apikey ?? ''), body: raw ? JSON.parse(raw) : null });
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const p = url.pathname;
      if (p === '/instance/create') return json(201, { instance: { instanceName: (JSON.parse(raw) as { instanceName: string }).instanceName }, hash: 'x' });
      if (p.startsWith('/webhook/set/')) return json(201, {});
      if (p.startsWith('/instance/connectionState/')) {
        polls++;
        return json(200, { instance: { state: polls > 2 ? 'open' : 'connecting' } });
      }
      if (p.startsWith('/instance/connect/')) return json(200, { base64: `data:image/png;base64,${PNG}` });
      if (p.startsWith('/instance/fetchInstances')) return json(200, [{ ownerJid: '5491100007777@s.whatsapp.net' }]);
      if (p.startsWith('/group/fetchAllGroups/')) return json(200, [{ id: '120363999000000001@g.us', subject: 'Clientes QR', announce: false, restrict: false }]);
      if (p.startsWith('/group/participants/'))
        return json(200, { participants: [{ id: '5491100007777@s.whatsapp.net', admin: 'superadmin' }, { id: '5491100001111@s.whatsapp.net', admin: null }] });
      if (p.startsWith('/message/sendText/')) return json(201, { key: { id: `OUT-${Date.now()}` } });
      if (p.startsWith('/instance/logout/') || p.startsWith('/instance/delete/')) return json(200, { status: 'SUCCESS' });
      return json(404, { error: 'not found' });
    });
  });
  return { server, hits };
}

test('QR administrado: escanear, traer grupos solo, recibir y responder, borrar la instancia', async ({ browser, baseURL }) => {
  const { server, hits } = startEvolution();
  await new Promise<void>((resolve) => server.listen(PORT + 31, '127.0.0.1', () => resolve()));
  const { ctx } = await newPerson(browser, baseURL!);
  const page = await ctx.newPage();
  try {
    await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: 'Scan QR code' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a WhatsApp number' });
    await expect(dialog.getByLabel(/Scan QR code/)).toBeChecked();
    await expect(dialog.getByText(/use a test number/)).toBeVisible();
    // Las credenciales propias quedan plegadas.
    await expect(dialog.getByLabel(/WhatsApp Cloud API/)).toBeHidden();
    await dialog.getByRole('button', { name: 'Show QR code' }).click();

    const connect = page.getByRole('dialog', { name: /^Connect / });
    await expect(connect.getByRole('img', { name: 'QR code to link WhatsApp' })).toBeVisible();
    await expect(connect.getByText(/Linked devices/)).toBeVisible();
    // El webhook lo registramos nosotros: no se muestra.
    await expect(connect.getByLabel('Webhook URL')).toHaveCount(0);
    await expect(connect.getByText(/^Connected/)).toBeVisible({ timeout: 20_000 });
    await expect(connect.getByText('We brought in 1 group.')).toBeVisible({ timeout: 15_000 });

    // Alta con la clave global; todo lo demás con el token de la instancia, nunca la global.
    const create = hits.find((h) => h.path === '/instance/create')!;
    expect(create.apikey).toBe(GLOBAL_KEY);
    const instance = String(create.body?.instanceName);
    const token = String(create.body?.token);
    expect(instance).toMatch(/^zs-[a-f0-9]{20}$/);
    const webhookUrl = String((create.body?.webhook as { url: string }).url);
    expect(webhookUrl).toMatch(/\/api\/groups\/webhook\/[^/]+\/[a-f0-9]{48}$/);
    for (const h of hits.filter((x) => x !== create)) expect(h.apikey).toBe(token);

    await connect.getByRole('button', { name: 'Go to inbox' }).click();
    await expect(page.locator('.gr-row', { hasText: 'Clientes QR' })).toBeVisible();

    // Llega un mensaje por el webhook (como lo manda Evolution) y aparece sin recargar.
    const hook = await ctx.request.post(new URL(webhookUrl).pathname, {
      data: {
        event: 'messages.upsert',
        instance,
        data: { key: { remoteJid: '5491100002222@s.whatsapp.net', fromMe: false, id: `IN-${uid()}` }, pushName: 'Rocío QR', message: { conversation: '¿Me confirman el turno?' } },
      },
    });
    expect(hook.ok()).toBe(true);
    const row = page.locator('.gr-row', { hasText: 'Rocío QR' });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    const composer = page.getByLabel('WhatsApp', { exact: true });
    await composer.fill('Sí, confirmado.');
    await composer.press('Enter');
    await expect(page.locator('.gr-msg-out', { hasText: 'Sí, confirmado.' }).getByText('Sent')).toBeVisible();
    const send = hits.find((h) => h.path === `/message/sendText/${instance}`)!;
    expect(send.apikey).toBe(token);
    expect(send.body).toMatchObject({ number: '5491100002222@s.whatsapp.net', text: 'Sí, confirmado.' });

    // Borrar el número cierra la sesión y borra la instancia del servidor.
    await page.goto('/en/app/groups/settings?tab=numbers', { waitUntil: 'networkidle' });
    await page.locator('.gr-line-row').getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => hits.some((h) => h.method === 'DELETE' && h.path === `/instance/delete/${instance}` && h.apikey === GLOBAL_KEY)).toBe(true);
    await expect(page.locator('.gr-line-row')).toHaveCount(0);
  } finally {
    await ctx.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

type Chat = { id: string; name: string; kind: string };
async function chatsOf(ctx: BrowserContext): Promise<Chat[]> {
  const res = await ctx.request.get('/api/groups/chats?limit=100');
  return ((await res.json()) as { rows: Chat[] }).rows;
}
async function bodiesOf(ctx: BrowserContext, chatId: string): Promise<string[]> {
  const res = await ctx.request.get(`/api/groups/chats/${chatId}/messages`);
  return ((await res.json()) as { messages: Array<{ body: string }> }).messages.map((m) => m.body);
}

test('cambiar de chat y mandar enseguida nunca manda al chat anterior', async ({ browser, baseURL }) => {
  const { ctx } = await newPerson(browser, baseURL!);
  const page = await ctx.newPage();
  try {
    await ctx.request.post('/api/groups/sample', { data: { locale: 'en' } });
    const chats = await chatsOf(ctx);
    const lucia = chats.find((c) => c.name === 'Lucía Fernández')!;
    const pablo = chats.find((c) => c.name === 'Pablo Ortiz')!;
    await page.goto(`/en/app/groups/inbox/${lucia.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 2, name: 'Lucía Fernández' })).toBeVisible();
    const text = `Para Pablo ${uid()}`;
    // Clic en otro chat y a escribir sin esperar: lo que se escribe nunca termina en el chat que se deja.
    await page.locator('.gr-row', { hasText: 'Pablo Ortiz' }).click();
    const composer = page.getByLabel('WhatsApp', { exact: true });
    await composer.fill(text);
    await composer.press('Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Pablo Ortiz' })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await bodiesOf(ctx, lucia.id)).not.toContain(text);
    // Si llegó a mandarse, fue a Pablo; si no, quedó como borrador del chat donde se escribió (no se perdió).
    if (!(await bodiesOf(ctx, pablo.id)).includes(text)) {
      await page.goto(`/en/app/groups/inbox/${lucia.id}`, { waitUntil: 'networkidle' });
      await expect(page.getByLabel('WhatsApp', { exact: true })).toHaveValue(text);
    }
  } finally {
    await ctx.close();
  }
});

test('abrir un chat con una imagen deja a la vista el último mensaje', async ({ browser, baseURL }) => {
  const { ctx } = await newPerson(browser, baseURL!);
  const page = await ctx.newPage();
  try {
    await ctx.request.post('/api/groups/sample', { data: { locale: 'en' } });
    const acme = (await chatsOf(ctx)).find((c) => c.name === 'Acme · Rollout')!;
    await page.goto(`/en/app/groups/inbox/${acme.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.gr-media img')).toBeVisible();
    await expect
      .poll(() => page.locator('.gr-messages').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight), { timeout: 5000 })
      .toBeLessThan(30);
    await expect(page.locator('.gr-messages').getByText('When can we schedule the team training?')).toBeInViewport();
  } finally {
    await ctx.close();
  }
});

test('descripción del grupo: se ve, se edita y queda; sumar un miembro actualiza el encabezado', async ({ browser, baseURL }) => {
  const { ctx } = await newPerson(browser, baseURL!);
  const page = await ctx.newPage();
  try {
    await ctx.request.post('/api/groups/sample', { data: { locale: 'en' } });
    const acme = (await chatsOf(ctx)).find((c) => c.name === 'Acme · Rollout')!;
    await page.goto(`/en/app/groups/list/${acme.id}`, { waitUntil: 'networkidle' });
    const field = page.getByLabel('Description', { exact: true });
    await expect(field).toHaveValue('Acme rollout. Questions, progress and files.');
    const next = `Rollout notes ${uid()}`;
    await field.fill(next);
    await page.locator('.gr-detail-section', { has: field }).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved')).toBeVisible();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue(next);
    await expect(page.getByText('4 members').first()).toBeVisible();
    await page.getByPlaceholder(/Phones to add/).fill('+54 9 11 5555 0101');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('.ui-page-header').getByText('5 members')).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('cerrar el QR sin escanear no deja un número esperando; un número sin conectar ofrece terminar o probar el ejemplo', async ({ browser, baseURL }) => {
  const { server, hits } = startEvolution();
  await new Promise<void>((resolve) => server.listen(PORT + 31, '127.0.0.1', () => resolve()));
  const { ctx } = await newPerson(browser, baseURL!);
  const page = await ctx.newPage();
  try {
    await page.goto('/en/app/groups/settings?tab=numbers&new=1', { waitUntil: 'networkidle' });
    await page.getByRole('dialog', { name: 'Add a WhatsApp number' }).getByRole('button', { name: 'Show QR code' }).click();
    const connect = page.getByRole('dialog', { name: /^Connect / });
    await expect(connect.getByRole('img', { name: 'QR code to link WhatsApp' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(connect).toBeHidden();
    await expect.poll(async () => ((await (await ctx.request.get('/api/groups/numbers')).json()) as { numbers: unknown[] }).numbers.length).toBe(0);
    const instance = String(hits.find((h) => h.path === '/instance/create')?.body?.instanceName);
    await expect.poll(() => hits.some((h) => h.method === 'DELETE' && h.path === `/instance/delete/${instance}`)).toBe(true);
    await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Try with sample data' })).toBeVisible();

    // Un número agregado que nunca conectó (credenciales propias): la bandeja lo dice y ofrece seguir.
    await ctx.request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Pending ${uid()}` } });
    await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
    await expect(page.getByText('Your number is not connected yet.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Finish connecting' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try with sample data' })).toBeVisible();
  } finally {
    await ctx.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
