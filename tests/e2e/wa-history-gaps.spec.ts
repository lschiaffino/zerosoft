import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Mensajes que WhatsApp no pudo entregar (WhatsApp falso, GROUPS_FAKE=1), en
 * Inbox y en Lines. El número falso hace de Evolution con el parche 0002:
 * `fake_withheld` avisa que falta un mensaje y se lo guarda; el historial que
 * se le pide lo devuelve.
 * - Con el chat abierto: "Fetch missing messages" en el menú del chat avisa
 *   que se le pidió al teléfono y el mensaje aparece en su lugar.
 * - Abrir un chat que ya tenía el hueco lo pide solo, sin tocar nada.
 * Nombres y números inventados.
 */

const TOAST = 'We asked your phone for this chat’s messages. They may take a moment.';

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

/** Tres mensajes de a un minuto: el del medio "no se pudo descifrar" (lo guarda el número falso). */
function conversation(jid: string, name: string, tag: string) {
  const t0 = Date.now() - 5 * 60_000;
  const msg = (n: number, body: string, fromMe = false) => ({
    type: 'message',
    chatId: jid,
    isGroup: false,
    fromMe,
    senderPhone: fromMe ? '' : jid.replace(/@.*/, ''),
    senderName: fromMe ? '' : name,
    providerMessageId: `e2e-gap-${tag}-${n}`,
    body,
    timestamp: new Date(t0 + n * 60_000).toISOString(),
  });
  return {
    first: msg(0, `uno ${tag}`),
    withheld: { type: 'fake_withheld', message: msg(1, `dos ${tag}`, true) },
    third: msg(2, `tres ${tag}`),
  };
}

/** Los tres en orden en el hilo. */
async function expectInOrder(thread: Locator, tag: string) {
  await expect(thread.getByText(`dos ${tag}`)).toBeVisible({ timeout: 10_000 });
  await expect(thread.getByText(`dos ${tag}`)).toHaveCount(1);
  const text = (await thread.innerText()).replace(/\s+/g, ' ');
  const at = (s: string) => text.indexOf(s);
  expect(at(`uno ${tag}`)).toBeGreaterThanOrEqual(0);
  expect(at(`uno ${tag}`)).toBeLessThan(at(`dos ${tag}`));
  expect(at(`dos ${tag}`)).toBeLessThan(at(`tres ${tag}`));
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.describe('Inbox', () => {
  async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
    await request.post('/api/inbox/whatsapp');
    await expect
      .poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 })
      .toBe('connected');
    const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
    return { id: String(row.id), secret: String(row.webhook_secret) };
  }

  async function events(request: APIRequestContext, acc: { id: string; secret: string }, list: unknown[]) {
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, { data: { events: list } });
    expect(res.ok(), await res.text()).toBe(true);
  }

  test('el menú del chat trae el mensaje que faltaba; abrir un chat con el hueco lo pide solo', async ({ page, request }) => {
    const errors = watchErrors(page);
    const acc = await linkWhatsapp(request);

    // Con el chat abierto llega el aviso: se pide desde el menú.
    const tag = uid();
    const name = `Juli ${tag}`;
    const jid = `${phone()}@s.whatsapp.net`;
    const c = conversation(jid, name, tag);
    await events(request, acc, [c.first]);
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    const thread = page.locator('.ib-wa-thread');
    // Con `next dev` la primera vez compila el chat: se vuelve a tocar la fila hasta que abre.
    await expect(async () => {
      await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
      await expect(thread.getByText(`uno ${tag}`)).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000 });
    await events(request, acc, [c.withheld, c.third]);
    await expect(thread.getByText(`tres ${tag}`)).toBeVisible({ timeout: 25_000 });
    await expect(thread.getByText(`dos ${tag}`)).toHaveCount(0);
    await thread.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Fetch missing messages' }).click();
    await expect(page.getByText(TOAST)).toBeVisible({ timeout: 30_000 });
    await expectInOrder(thread, tag);
    await expect.poll(async () => (await sql('SELECT history_gap_at FROM inbox_threads WHERE account_id = ? AND external_id = ?', [acc.id, jid]))[0]?.history_gap_at ?? null).toBeNull();

    // El hueco ya estaba al abrir: se pide solo.
    const tag2 = uid();
    const name2 = `Mora ${tag2}`;
    const jid2 = `${phone()}@s.whatsapp.net`;
    const c2 = conversation(jid2, name2, tag2);
    await events(request, acc, [c2.first, c2.withheld, c2.third]);
    await page.locator('.ib-item', { hasText: name2 }).locator('.ib-row-btn').click();
    await expectInOrder(thread, tag2);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

test.describe('Lines', () => {
  interface NumberInfo {
    id: string;
    webhookUrl: string;
  }

  async function fakeNumber(request: APIRequestContext): Promise<NumberInfo> {
    const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Huecos ${uid()}` } });
    expect(created.ok()).toBe(true);
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

  async function chatOf(numberId: string, jid: string): Promise<string> {
    const [row] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, jid]);
    return String(row.id);
  }

  test('el menú del chat trae el mensaje que faltaba; abrir un chat con el hueco lo pide solo', async ({ page, request }) => {
    const errors = watchErrors(page);
    const n = await fakeNumber(request);

    const tag = uid();
    const name = `Juli ${tag}`;
    const jid = `${phone()}@s.whatsapp.net`;
    const c = conversation(jid, name, tag);
    await events(request, n, [c.first]);
    await page.goto(`/en/app/lines/inbox/${await chatOf(n.id, jid)}`, { waitUntil: 'networkidle' });
    const thread = page.locator('.gr-messages');
    await expect(thread.getByText(`uno ${tag}`)).toBeVisible({ timeout: 30_000 });
    // El webhook ya guardó el aviso al responder; lo que sigue no espera al refresco del hilo.
    await events(request, n, [c.withheld, c.third]);
    await expect(thread.getByText(`dos ${tag}`)).toHaveCount(0);
    await page.getByRole('button', { name: 'More chat actions' }).click();
    await page.getByRole('menuitem', { name: 'Fetch missing messages' }).click();
    await expect(page.getByText(TOAST)).toBeVisible({ timeout: 30_000 });
    await expectInOrder(thread, tag);
    await expect.poll(async () => (await sql('SELECT history_gap_at FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [n.id, jid]))[0]?.history_gap_at ?? null).toBeNull();

    // El hueco ya estaba al abrir: se pide solo.
    const tag2 = uid();
    const name2 = `Mora ${tag2}`;
    const jid2 = `${phone()}@s.whatsapp.net`;
    const c2 = conversation(jid2, name2, tag2);
    await events(request, n, [c2.first, c2.withheld, c2.third]);
    await page.goto(`/en/app/lines/inbox/${await chatOf(n.id, jid2)}`, { waitUntil: 'networkidle' });
    await expectInOrder(page.locator('.gr-messages'), tag2);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
