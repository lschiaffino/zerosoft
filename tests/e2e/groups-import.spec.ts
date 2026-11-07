import http from 'http';
import { createClient } from '@libsql/client';
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { buildEvolutionData, evolutionImportResponse } from '../support/evolution-fake';

/**
 * Groups: al conectar un número por QR se importan los chats y mensajes que
 * Evolution ya guardó (simulado en PORT + 31 con 200 chats, 12 grupos, media
 * y lids), y la bandeja se ve y se usa como WhatsApp Web.
 */

const PORT = Number(process.env.E2E_PORT) || 3210;
const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function newPerson(browser: Browser, baseURL: string): Promise<{ ctx: BrowserContext; email: string }> {
  const email = `groups-import-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  await ctx.request.get('/api/groups/numbers');
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", [email]);
  return { ctx, email };
}

function startEvolution() {
  const data = buildEvolutionData({ chats: 200, groups: 12, perChat: 8 });
  const hits: string[] = [];
  let polls = 0;
  const base = `http://127.0.0.1:${PORT + 31}`;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const p = url.pathname;
      hits.push(p);
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      const json = (code: number, b: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(b));
      };
      const r = evolutionImportResponse(data, req.method ?? 'GET', p, url.searchParams, body, base);
      if (r?.bytes) {
        res.writeHead(200, { 'content-type': r.type ?? 'image/png' });
        return res.end(r.bytes);
      }
      if (r) return json(r.status, r.json);
      if (p === '/instance/create') return json(201, { instance: { instanceName: body?.instanceName } });
      if (p.startsWith('/webhook/set/')) return json(201, {});
      if (p.startsWith('/instance/connectionState/')) return json(200, { instance: { state: ++polls > 1 ? 'open' : 'connecting' } });
      if (p.startsWith('/instance/connect/')) return json(200, { base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' });
      if (p.startsWith('/instance/fetchInstances')) return json(200, [{ ownerJid: '5491100007777@s.whatsapp.net' }]);
      if (p.startsWith('/message/send')) return json(201, { key: { id: `OUT-${Date.now()}` } });
      if (p.startsWith('/instance/logout/') || p.startsWith('/instance/delete/')) return json(200, { status: 'SUCCESS' });
      return json(404, { error: 'not found' });
    });
  });
  return { server, hits, data };
}

test('importar al conectar: 212 chats con nombres, fotos y mensajes; el hilo se ve y se usa como WhatsApp', async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const { server, hits } = startEvolution();
  await new Promise<void>((resolve) => server.listen(PORT + 31, '127.0.0.1', () => resolve()));
  const { ctx } = await newPerson(browser, baseURL!);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  try {
    await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: 'Scan QR code' }).click();
    await page.getByRole('dialog', { name: 'Add a WhatsApp number' }).getByRole('button', { name: 'Show QR code' }).click();
    const connect = page.getByRole('dialog', { name: /^Connect / });
    await expect(connect.getByText(/^Connected/)).toBeVisible({ timeout: 30_000 });
    await connect.getByRole('button', { name: 'Go to inbox' }).click();

    // El progreso se ve en la bandeja y termina solo (las tandas avanzan mientras se mira).
    await expect(page.getByRole('status').filter({ hasText: /Import finished: 212 chats/ })).toBeVisible({ timeout: 120_000 });
    expect(hits.some((p) => p.startsWith('/chat/findMessages/'))).toBe(true);
    expect(hits.some((p) => p.startsWith('/chat/fetchProfilePictureUrl/'))).toBe(true);
    const chats = (await (await ctx.request.get('/api/groups/chats?limit=500')).json()) as { total: number; rows: Array<{ name: string; kind: string; unread: number; awaitingSince: string | null }> };
    expect(chats.total).toBe(212);
    expect(chats.rows.every((c) => !c.awaitingSince)).toBe(true);

    // Lista como WhatsApp: el grupo con 5 sin leer, la hora en verde y el último mensaje con su remitente.
    const groupRow = page.locator('.gr-row', { hasText: 'Clientes zona 1' }).first();
    await expect(groupRow.getByLabel('5 unread')).toBeVisible();
    await expect(groupRow.locator('.gr-row-sender')).toBeVisible();

    // Un 1:1 con media: tildes azules en lo propio, cita, foto que abre el visor.
    const lucia = page.locator('.gr-row', { hasText: 'Lucía García' }).first();
    await lucia.click();
    await expect(page.getByRole('heading', { level: 2, name: /Lucía García/ })).toBeVisible();
    await expect(page.locator('.gr-msg-out .wa-ticks.is-read').first()).toBeAttached();
    await expect(page.locator('.gr-msg .gr-quote').first()).toBeVisible();
    const photo = page.getByRole('button', { name: /^Open / }).first();
    await photo.scrollIntoViewIfNeeded();
    await photo.click();
    const viewer = page.getByRole('dialog', { name: 'Media viewer' });
    await expect(viewer.locator('img')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);

    // Arrastrar un archivo al hilo lo adjunta (con vista previa); se manda con un comentario.
    const thread = page.locator('.wa-thread');
    const dt = await page.evaluateHandle(() => {
      const d = new DataTransfer();
      d.items.add(new File(['hola'], 'nota.txt', { type: 'text/plain' }));
      return d;
    });
    await thread.dispatchEvent('dragenter', { dataTransfer: dt });
    await expect(page.getByText('Drop to attach')).toBeVisible();
    await thread.dispatchEvent('drop', { dataTransfer: dt });
    const tray = page.getByRole('list', { name: 'Files to send' });
    await expect(tray.getByText('nota.txt')).toBeVisible();
    await expect(tray.getByRole('progressbar')).toHaveCount(0, { timeout: 15_000 });
    const composer = page.getByLabel('WhatsApp', { exact: true });
    await composer.fill('Te mando la nota');
    await composer.press('Enter');
    await expect(page.locator('.gr-msg-out', { hasText: 'Te mando la nota' }).locator('.wa-doc')).toBeVisible();
    await expect(tray).toHaveCount(0);
    expect(hits.some((p) => p.startsWith('/message/sendMedia/'))).toBe(true);

    // Reaccionar desde la burbuja y el menú con la flecha (Responder arma la cita en el composer).
    const last = page.locator('.gr-msg-in').last();
    await last.hover();
    await last.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Reply' }).click();
    await expect(page.locator('.wa-replying')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('la bandeja a 390px: lista y conversación sin scroll horizontal, en claro y oscuro', async ({ browser, baseURL }) => {
  const { ctx } = await newPerson(browser, baseURL!);
  try {
    await ctx.request.post('/api/groups/sample', { data: { locale: 'en' } });
    for (const scheme of ['light', 'dark'] as const) {
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
      await page.locator('.gr-row', { hasText: 'Acme · Rollout' }).click();
      await expect(page.locator('.gr-msg').first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.close();
    }
  } finally {
    await ctx.close();
  }
});
