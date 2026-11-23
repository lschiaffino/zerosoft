import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';
import { waLinkIp } from './helpers/wa-link';
import { ensureDetailsTab } from './helpers/details-tab';

/**
 * La pestaña AI del panel de un chat, en Lines y en Inbox, a 1280 y 390 (modelo falso de e2e): elegir el rango
 * (desde la última lectura o días), resumir, ver preguntas, compromisos, respuestas sugeridas y ánimo; Insertar pone
 * la respuesta en el campo con Deshacer y no manda nada. Con la IA apagada (cookie del modelo falso) lo dice y no
 * ofrece resumir. Sin desplazamiento lateral; a 390, lo que se toca mide 40px o más.
 * Con L2_SHOTS=<carpeta> guarda capturas en los cinco aspectos, claro y oscuro. Cuenta propia; textos inventados.
 */

test.describe.configure({ timeout: 300_000 });

const email = ownWorkspace('wa-ai-tab');
const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'];

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${new URL(res.url()).pathname}`);
  });
  return errors;
}

const noSideScroll = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);

const events = (from: string, tag: string) =>
  ['Hola, quería consultar por el pedido', '¿Me pasan el precio del plan anual?', 'Mañana les confirmo la dirección'].map((body, i) => ({
    type: 'message',
    chatId: `${from}@s.whatsapp.net`,
    isGroup: false,
    fromMe: false,
    senderPhone: from,
    senderName: `Paula ${tag}`,
    providerMessageId: `ai-${tag}-${i}`,
    body,
    timestamp: new Date(Date.now() - (5 - i) * 60_000).toISOString(),
  }));

async function linesChat(request: APIRequestContext, tag: string): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `IA ${tag}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const from = phone();
  const res = await request.post(new URL(webhookUrl).pathname, { data: { events: events(from, tag) } });
  expect(res.ok(), await res.text()).toBe(true);
  const db = e2eDb();
  try {
    return String((await db.execute({ sql: 'SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', args: [id, `${from}@s.whatsapp.net`] })).rows[0].id);
  } finally {
    db.close();
  }
}

async function inboxChat(request: APIRequestContext, tag: string): Promise<string> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
  const db = e2eDb();
  try {
    const [acc] = (await db.execute({ sql: "SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = ?", args: [email] })).rows;
    const from = phone();
    const res = await request.post(`/api/inbox/webhook/${String(acc.id)}/${String(acc.webhook_secret)}`, { data: { events: events(from, tag) } });
    expect(res.ok(), await res.text()).toBe(true);
    return String((await db.execute({ sql: 'SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', args: [String(acc.id), `${from}@s.whatsapp.net`] })).rows[0].id);
  } finally {
    db.close();
  }
}

const apps = {
  lines: { url: (id: string) => `/en/app/lines/inbox/${id}`, panel: '.gr-details', head: '.gr-thread-head .wa-head-avatar', cookie: 'groups_ai_fake' },
  inbox: { url: (id: string) => `/en/app/inbox?t=${id}`, panel: '.ib-wa-details', head: '.ib-wa-thread .wa-head-who', cookie: 'inbox_ai_fake' },
} as const;

async function openAiTab(page: Page, app: keyof typeof apps, id: string): Promise<Locator> {
  await page.goto(apps[app].url(id), { waitUntil: 'networkidle' });
  await expect(page.locator('.gr-msg').first()).toBeVisible({ timeout: 45_000 });
  await ensureDetailsTab(page, 'ai', () => page.locator(apps[app].head).first().click());
  return page.locator(apps[app].panel).getByTestId('details-ai');
}

async function shots(page: Page, name: string) {
  const dir = process.env.L2_SHOTS;
  if (!dir) return;
  for (const look of LOOKS) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(([l, t]) => {
        document.documentElement.setAttribute('data-look', l);
        document.documentElement.setAttribute('data-theme', t);
      }, [look, theme]);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${dir}/${name}-${look}-${theme}.png` });
    }
  }
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-look', 'current');
    document.documentElement.setAttribute('data-theme', 'light');
  });
}

for (const app of ['lines', 'inbox'] as const) {
  for (const width of [1280, 390]) {
    test(`${app}: pestaña AI, resumir e insertar una respuesta sin mandarla (${width})`, async ({ page, request }) => {
      const errors = watchErrors(page);
      await page.setViewportSize({ width, height: 844 });
      const tag = uid();
      const id = app === 'lines' ? await linesChat(request, tag) : await inboxChat(request, tag);
      const tab = await openAiTab(page, app, id);
      // Rango: al abrir había mensajes sin leer, así que arranca "desde la última lectura".
      const range = tab.getByTestId('details-ai-range');
      await expect(range.locator('[data-range="unread"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(range.locator('[data-range="unread"]')).toContainText('3');
      // Teclado: con el foco en un rango, Enter lo elige.
      await range.locator('[data-range="7"]').focus();
      await page.keyboard.press('Enter');
      await expect(range.locator('[data-range="7"]')).toHaveAttribute('aria-pressed', 'true');
      await tab.getByTestId('details-ai-run').click();
      const results = tab.getByTestId('details-ai-results');
      await expect(results).toBeVisible();
      await expect(tab.getByTestId('details-ai-summary')).toContainText('3 messages');
      await expect(tab.getByTestId('details-ai-questions')).toContainText('precio del plan anual');
      await expect(tab.getByTestId('details-ai-commitments')).toContainText('Mañana les confirmo');
      await expect(tab.getByTestId('details-ai-mood').locator('[data-mood]')).toHaveAttribute('data-mood', 'neutral');
      await expect(tab.getByTestId('details-ai-results')).toHaveAttribute('data-range', '7');
      expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
      if (width === 390) {
        for (const b of [...(await range.getByRole('button').all()), ...(await tab.getByTestId('details-ai-insert').all()), tab.getByTestId('details-ai-run')]) {
          expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(40);
        }
      }
      if (width === 1280) await shots(page, `${app}-ai-tab-${width}`);

      // Insertar: la respuesta va al campo (en el teléfono el panel se cierra), con Deshacer, y no sale nada.
      const reply = (await tab.getByTestId('details-ai-reply').first().locator('p').textContent())!.trim();
      await tab.getByTestId('details-ai-insert').first().click();
      const field = page.getByTestId('composer-input');
      await expect(field).toHaveValue(reply);
      await expect(field).toBeVisible();
      await expect(page.getByTestId('ai-compose-undo')).toBeVisible();
      if (process.env.L2_SHOTS) await page.screenshot({ path: `${process.env.L2_SHOTS}/${app}-ai-inserted-${width}.png` });
      await page.getByTestId('ai-compose-undo').getByRole('button', { name: 'Undo' }).click();
      await expect(field).toHaveValue('');
      // Lines, con una nota interna a medio escribir: no se pisa ni pasa al campo de WhatsApp; el panel avisa.
      if (app === 'lines' && width === 1280) {
        await page.locator('.wa-mode-note').click();
        await field.fill(`Nota a medio escribir ${tag}`);
        await tab.getByTestId('details-ai-insert').first().click();
        await expect(tab.getByTestId('details-ai-insert-failed')).toBeVisible();
        await expect(field).toHaveValue(`Nota a medio escribir ${tag}`);
        await expect(page.locator('.wa-mode-note')).toHaveAttribute('aria-selected', 'true');
        await field.fill('');
      }
      // Nada salió a WhatsApp: el chat no tiene mensajes propios.
      if (app === 'lines') {
        const r = (await (await request.get(`/api/groups/chats/${id}/messages?limit=60`)).json()) as { messages: Array<{ direction: string }> };
        expect(r.messages.filter((m) => m.direction === 'out')).toEqual([]);
      } else {
        const r = (await (await request.get(`/api/inbox/threads/${id}`)).json()) as { messages: Array<{ fromMe: boolean }> };
        expect(r.messages.filter((m) => m.fromMe)).toEqual([]);
      }
      expect(errors).toEqual([]);
    });
  }

  test(`${app}: con la IA apagada, la pestaña lo dice y no ofrece resumir`, async ({ page, request, context }) => {
    await page.setViewportSize({ width: 1280, height: 844 });
    const id = app === 'lines' ? await linesChat(request, uid()) : await inboxChat(request, uid());
    await context.addCookies([{ name: apps[app].cookie, value: 'off', domain: 'localhost', path: '/' }]);
    const tab = await openAiTab(page, app, id);
    await expect(tab.getByTestId('details-ai-off')).toBeVisible();
    await expect(tab.getByTestId('details-ai-run')).toHaveCount(0);
    // Y la ruta tampoco llama a nada.
    const res = await page.request.post(app === 'lines' ? `/api/groups/chats/${id}/summary` : `/api/inbox/threads/${id}/wa`, {
      data: app === 'lines' ? { kind: 'insights', range: { kind: 'days', days: 7 } } : { action: 'insights', range: { kind: 'days', days: 7 } },
    });
    expect(res.status()).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('ai_disabled');
  });
}
