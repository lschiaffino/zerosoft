import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';
import { waLinkIp } from './helpers/wa-link';
import { ensureDetailsTab } from './helpers/details-tab';

/**
 * La pestaña IA del panel de un chat, en Lines y en Inbox (components/groups/wa/ChatAiPanel.tsx): preguntar
 * sobre el chat (sugerencias y pregunta propia, con Enter), sentimiento con motivo y tareas propuestas que se
 * crean solo al aprobarlas (ticket o tarea en Lines; tarea del CRM en Inbox), descartar, el error con la IA
 * apagada y, a 390, sin desplazamiento lateral. Con el modelo falso (GROUPS_AI_FAKE, INBOX_FAKE).
 * Cuenta propia; nombres, números y textos inventados.
 */

test.describe.configure({ timeout: 300_000 });

const email = ownWorkspace('wa-ai-tab');
const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

/** Un 1:1 con dos pedidos y una queja al final (el modelo falso lo lee como negativo y propone dos). */
function dmEvents(from: string, tag: string) {
  const at = (s: number) => new Date(Date.now() - s * 1000).toISOString();
  const base = { type: 'message', chatId: `${from}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: from, senderName: `Rita ${tag}` };
  return [
    { ...base, providerMessageId: `a1-${tag}`, body: '¿Me mandás la factura de octubre?', timestamp: at(300) },
    { ...base, providerMessageId: `a2-${tag}`, body: 'Necesito también el presupuesto nuevo', timestamp: at(200) },
    { ...base, providerMessageId: `a3-${tag}`, body: 'La entrega vino mal, es un problema', timestamp: at(100) },
  ];
}

async function seedLines(request: APIRequestContext, tag: string): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `IA ${tag}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
  const from = phone();
  const res = await request.post(new URL(webhookUrl).pathname, { data: { events: dmEvents(from, tag) } });
  expect(res.ok(), await res.text()).toBe(true);
  const db = e2eDb();
  try {
    return String((await db.execute({ sql: 'SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', args: [numberId, `${from}@s.whatsapp.net`] })).rows[0].id);
  } finally {
    db.close();
  }
}

async function seedInbox(request: APIRequestContext, tag: string): Promise<string> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
  const db = e2eDb();
  try {
    const [acc] = (await db.execute({ sql: "SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = ?", args: [email] })).rows;
    const from = phone();
    const res = await request.post(`/api/inbox/webhook/${String(acc.id)}/${String(acc.webhook_secret)}`, { data: { events: dmEvents(from, tag) } });
    expect(res.ok(), await res.text()).toBe(true);
    return String((await db.execute({ sql: 'SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', args: [String(acc.id), `${from}@s.whatsapp.net`] })).rows[0].id);
  } finally {
    db.close();
  }
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}

/** Abre el chat y su pestaña IA; devuelve el contenido de la pestaña. */
async function openAiTab(page: Page, url: string, app: 'lines' | 'inbox') {
  await page.goto(url, { waitUntil: 'networkidle' });
  await expect(page.locator('.gr-msg').first()).toBeVisible({ timeout: 45_000 });
  await ensureDetailsTab(page, 'ai', () => page.locator(app === 'lines' ? '.gr-thread-head .wa-head-avatar' : '.ib-wa-thread .wa-head-who').first().click());
  const ai = page.locator(app === 'lines' ? '.gr-details' : '.ib-wa-details').getByTestId('chat-ai');
  await expect(ai).toBeVisible();
  return ai;
}

/** Preguntar: una sugerencia y una pregunta propia con Enter. */
async function askFlow(page: Page, ai: ReturnType<Page['locator']>) {
  const asked = page.waitForResponse((r) => r.request().method() === 'POST' && /\/(summary|wa)$/.test(new URL(r.url()).pathname), { timeout: 120_000 });
  await ai.getByTestId('chat-ai-suggest-asked').click();
  // La primera respuesta espera a la ruta (en `next dev` compila la primera vez).
  expect((await asked).status()).toBe(200);
  await expect(ai.getByTestId('chat-ai-answer')).toHaveCount(1);
  const q = ai.getByTestId('chat-ai-question');
  await expect(ai.getByTestId('chat-ai-ask')).toBeDisabled();
  await q.fill('¿Cuándo fue la entrega?');
  await q.press('Enter');
  await expect(ai.getByTestId('chat-ai-answer')).toHaveCount(2);
  await expect(q).toHaveValue('');
}

for (const width of [1280, 390]) {
  test(`Lines: pestaña IA del chat (${width}px)`, async ({ page, request, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.setViewportSize({ width, height: 844 });
    const tag = uid();
    const chat = await seedLines(request, tag);
    const ai = await openAiTab(page, `/en/app/lines/inbox/${chat}`, 'lines');
    await askFlow(page, ai);

    // Analizar: sentimiento y dos propuestas; todavía no se creó nada.
    await ai.getByTestId('chat-ai-analyze').click();
    await expect(ai.getByTestId('chat-ai-sentiment')).toHaveAttribute('data-sentiment', 'negative');
    const proposals = ai.getByTestId('chat-ai-proposal');
    await expect(proposals).toHaveCount(2);
    const count = async () => {
      const tasks = ((await (await request.get(`/api/groups/tasks?chat=${chat}&status=all`)).json()) as { tasks: unknown[] }).tasks.length;
      const tickets = ((await (await request.get(`/api/groups/tickets?chat=${chat}&status=all`)).json()) as { tickets: Array<{ title: string }> }).tickets;
      return { tasks, tickets };
    };
    expect((await count()).tasks).toBe(0);
    expect((await count()).tickets).toHaveLength(0);
    if (width === 390) await noSideScroll(page);

    // La primera como ticket, con el título cambiado.
    const first = proposals.nth(0);
    await expect(first.getByTestId('chat-ai-proposal-kind')).toHaveValue('ticket');
    await first.getByTestId('chat-ai-proposal-title').fill(`Revisar la entrega ${tag}`);
    await first.getByTestId('chat-ai-create').click();
    await expect(first.getByTestId('chat-ai-created-link')).toBeVisible();
    expect((await count()).tickets.map((t) => t.title)).toEqual([`Revisar la entrega ${tag}`]);

    // La segunda, cambiada a tarea: queda en la pestaña Tareas.
    const second = proposals.nth(1);
    await second.getByTestId('chat-ai-proposal-kind').selectOption('task');
    await second.getByTestId('chat-ai-create').click();
    await expect(second.getByTestId('chat-ai-created-link')).toBeVisible();
    expect((await count()).tasks).toBe(1);

    // Volver a analizar y descartar una: desaparece sin crear nada.
    await ai.getByTestId('chat-ai-analyze').click();
    await expect(proposals).toHaveCount(2);
    await expect(proposals.nth(0)).toHaveAttribute('data-state', 'open');
    await proposals.nth(0).getByTestId('chat-ai-dismiss').click();
    await expect(proposals).toHaveCount(1);
    expect((await count()).tasks).toBe(1);

    // Con la IA apagada, el error en la pestaña.
    await context.addCookies([{ name: 'groups_ai_fake', value: 'off', url: page.url() }]);
    await ai.getByTestId('chat-ai-analyze').click();
    await expect(ai.getByTestId('chat-ai-analyze-error')).toBeVisible();
    if (width === 390) await noSideScroll(page);
    expect(errors).toEqual([]);
  });

  test(`Inbox: pestaña IA del chat (${width}px)`, async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.setViewportSize({ width, height: 844 });
    const tag = uid();
    const thread = await seedInbox(request, tag);
    const ai = await openAiTab(page, `/en/app/inbox?t=${thread}`, 'inbox');
    await askFlow(page, ai);

    await ai.getByTestId('chat-ai-analyze').click();
    await expect(ai.getByTestId('chat-ai-sentiment')).toHaveAttribute('data-sentiment', 'negative');
    const proposals = ai.getByTestId('chat-ai-proposal');
    await expect(proposals).toHaveCount(2);
    // En Inbox no hay tickets: no se elige el tipo.
    await expect(ai.getByTestId('chat-ai-proposal-kind')).toHaveCount(0);
    if (width === 390) await noSideScroll(page);

    const title = `Mandar la factura ${tag}`;
    const tasks = async () => {
      const db = e2eDb();
      try {
        return Number((await db.execute({ sql: "SELECT COUNT(*) AS c FROM crm_activities WHERE type = 'task' AND subject = ?", args: [title] })).rows[0].c);
      } finally {
        db.close();
      }
    };
    expect(await tasks()).toBe(0);
    await proposals.nth(0).getByTestId('chat-ai-proposal-title').fill(title);
    await proposals.nth(0).getByTestId('chat-ai-create').click();
    await expect(proposals.nth(0).getByTestId('chat-ai-created-link')).toHaveAttribute('href', /\/app\/crm\/tasks\//);
    expect(await tasks()).toBe(1);
    expect(errors).toEqual([]);
  });
}
