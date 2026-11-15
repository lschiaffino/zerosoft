import { expect, test, type Locator } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Volver a importar una línea no rompe nada, visto en la pantalla (Inbox y
 * Lines, con el WhatsApp falso): llegan unos mensajes, la persona lee el chat,
 * y lo mismo vuelve a llegar (igual, en otro orden y por el historial). El
 * chat sigue siendo uno, con los mismos mensajes, leído, y la foto sigue
 * cargando. El detalle columna por columna está en
 * tests/unit/wa-reimport-invariants.test.ts.
 *
 * Nombres, números y textos inventados.
 */

test.describe.configure({ timeout: 180_000 });

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

type Ev = Record<string, unknown>;

function events(app: 'inbox' | 'lines', chatId: string, phone: string, name: string, tag: string): Ev[] {
  const at = (sec: number) => new Date(Date.now() - 3_600_000 + sec * 1000).toISOString();
  const base = (pid: string, body: string, sec: number): Ev => ({ type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: phone, senderName: name, providerMessageId: pid, body, timestamp: at(sec) });
  return [
    base(`t1-${tag}`, `Primer mensaje ${tag}`, 0),
    { ...base(`img-${tag}`, `Foto con texto ${tag}`, 10), media: { url: app === 'lines' ? `evo:img-${tag}` : '', type: 'image/png', name: '', fetchRef: { providerMessageId: `img-${tag}`, chatId, fromMe: false }, info: { kind: 'image', width: 480, height: 320 } } },
    base(`t2-${tag}`, `Último mensaje ${tag}`, 20),
  ];
}

/** Lo mismo de vuelta, de tres formas. */
async function again(post: (body: unknown) => Promise<void>, evs: Ev[]) {
  await post({ events: evs });
  await post({ events: [...evs].reverse() });
  await post({ events: evs.map((e) => ({ ...e, history: true })) });
}

async function expectSame(thread: Locator, tag: string) {
  await expect(thread.locator('.gr-msg', { hasText: `Primer mensaje ${tag}` })).toHaveCount(1);
  await expect(thread.locator('.gr-msg', { hasText: `Último mensaje ${tag}` })).toHaveCount(1);
  const photo = thread.locator('.gr-msg', { hasText: `Foto con texto ${tag}` });
  await expect(photo).toHaveCount(1);
  await expect(photo.locator('.wa-image img.is-loaded')).toBeVisible({ timeout: 20_000 });
}

test('Inbox: lo mismo que vuelve a llegar no duplica mensajes ni vuelve a marcar el chat como no leído', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const chatId = `${phone}@s.whatsapp.net`;
  const name = `Rita Reimporta ${uid()}`;
  const tag = uid();
  const evs = events('inbox', chatId, phone, name, tag);
  const post = async (data: unknown) => {
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data });
    expect(res.ok(), await res.text()).toBe(true);
  };
  await post({ events: evs });
  const state = async () => (await sql('SELECT id, unread, (SELECT COUNT(*) FROM inbox_messages m WHERE m.thread_id = t.id) AS n FROM inbox_threads t WHERE account_id = ? AND external_id = ?', [String(acc.id), chatId]))[0];
  expect(Number((await state()).n)).toBe(3);

  const open = async () => {
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
    await expect(page.locator('.ib-wa-thread').getByRole('heading', { level: 2, name })).toBeVisible();
  };
  await open();
  const thread = page.locator('.ib-wa-thread');
  await expectSame(thread, tag);
  // Abrirlo lo deja leído.
  await expect.poll(async () => Number((await state()).unread), { timeout: 15_000 }).toBe(0);
  const before = await state();

  // Fuera del chat: un chat abierto se marca leído solo y taparía un no leído que volviera.
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await again(post, evs);
  expect(await state()).toEqual(before);
  await open();
  await expect(page.locator('.ib-item', { hasText: name })).toHaveCount(1);
  await expectSame(page.locator('.ib-wa-thread'), tag);
});

test('Lines: lo mismo que vuelve a llegar no duplica mensajes, no pierde el archivo guardado ni los no leídos', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Reimporta ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  try {
    await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
    await expect
      .poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
      .toBe('connected');
    const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
    const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    const chatId = `${phone}@s.whatsapp.net`;
    const name = `Rita Reimporta ${uid()}`;
    const tag = uid();
    const evs = events('lines', chatId, phone, name, tag);
    const post = async (data: unknown) => {
      const res = await request.post(new URL(webhookUrl).pathname, { data });
      expect(res.ok(), await res.text()).toBe(true);
    };
    await post({ events: evs });
    const file = async () => String((await sql('SELECT media_url FROM groups_messages WHERE provider_message_id = ?', [`img-${tag}`]))[0]?.media_url ?? '');
    await expect.poll(file, { timeout: 20_000 }).not.toMatch(/^(evo:.*)?$/);
    const saved = await file();
    const state = async () => (await sql('SELECT id, unread_count, (SELECT COUNT(*) FROM groups_messages m WHERE m.chat_id = c.id) AS n FROM groups_chats c WHERE number_id = ? AND provider_chat_id = ?', [numberId, chatId]))[0];
    const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, chatId]);

    await page.goto(`/en/app/lines/inbox/${chat.id}`, { waitUntil: 'networkidle' });
    await expectSame(page.locator('.wa-thread'), tag);
    await expect.poll(async () => Number((await state()).unread_count), { timeout: 15_000 }).toBe(0);
    const before = await state();
    expect(Number(before.n)).toBe(3);

    // Fuera del chat: un chat abierto se marca leído solo y taparía un no leído que volviera.
    await page.goto('/en/app/lines', { waitUntil: 'networkidle' });
    await again(post, evs);
    expect(await state()).toEqual(before);
    // El archivo guardado es el mismo (no se volvió a bajar ni se perdió el enlace).
    expect(await file()).toBe(saved);
    await page.goto(`/en/app/lines/inbox/${chat.id}`, { waitUntil: 'networkidle' });
    await expectSame(page.locator('.wa-thread'), tag);
    expect(Number((await sql('SELECT COUNT(*) AS n FROM groups_chats WHERE number_id = ?', [numberId]))[0].n)).toBe(1);
  } finally {
    await request.delete(`/api/groups/numbers/${numberId}`).catch(() => null);
  }
});
