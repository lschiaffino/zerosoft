import { expect, test, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Fotos que no se pudieron bajar, en Inbox y en Lines, con el WhatsApp falso:
 * "hold-" no baja (el gateway no responde) hasta que se lo libera;
 * "gone-" ya no está en WhatsApp. Se reintenta solo una vez al aparecer, queda
 * "Bajar de nuevo" y, si WhatsApp ya no la tiene, lo dice sin ofrecer
 * reintentar. Con MR_SHOTS=<carpeta> guarda capturas.
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

async function shot(page: Page, name: string, target: Locator) {
  const dir = process.env.MR_SHOTS;
  if (!dir) return;
  await target.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/${name}.png` });
}

type Ev = Record<string, unknown>;

function photo(app: 'inbox' | 'lines', chatId: string, phone: string, name: string, pid: string, body: string, sec: number): Ev {
  return {
    type: 'message',
    chatId,
    isGroup: false,
    fromMe: false,
    senderPhone: phone,
    senderName: name,
    providerMessageId: pid,
    body,
    media: { url: app === 'lines' ? `evo:${pid}` : '', type: 'image/png', name: '', fetchRef: { providerMessageId: pid, chatId, fromMe: false }, info: { kind: 'image', width: 480, height: 320 } },
    timestamp: new Date(Date.now() - 3_600_000 + sec * 1000).toISOString(),
  };
}

const msgWith = (thread: Locator, text: string) => thread.locator('.gr-msg', { hasText: text });

/** Lo mismo en las dos apps: el reintento automático no alcanzó, "Bajar de nuevo" la trae; la que no está, lo dice. */
async function checkRetry(page: Page, thread: Locator, app: string, release: () => Promise<unknown>) {
  const retry = msgWith(thread, 'Foto que tarda');
  const ph = retry.getByTestId('wa-media-unavailable');
  // La foto se pide recién cuando entra en pantalla (loading="lazy").
  await retry.scrollIntoViewIfNeeded();
  // El reintento automático corre solo una vez y vuelve a fallar: queda el botón.
  await expect(ph).toHaveAttribute('data-state', 'idle', { timeout: 30_000 });
  const button = retry.getByTestId('wa-media-retry');
  await expect(button).toBeVisible();
  await shot(page, `${app}-retry`, retry);
  expect((await retry.locator('.gr-bubble').boundingBox())!.width).toBeGreaterThanOrEqual(280);
  // El gateway vuelve a responder: "Bajar de nuevo" la trae.
  await release();
  // Si la pantalla se refrescó sola en el medio, la foto ya volvió a pedirse y no hay botón que tocar.
  await button.click({ timeout: 5000 }).catch(() => null);
  await expect(retry.locator('.wa-image img.is-loaded')).toBeVisible({ timeout: 30_000 });
  await expect(retry.getByTestId('wa-media-unavailable')).toHaveCount(0);

  // La que WhatsApp ya no tiene: el aviso final, sin botón.
  const gone = msgWith(thread, 'Foto que ya no está');
  await gone.scrollIntoViewIfNeeded();
  await expect(gone.getByTestId('wa-media-unavailable')).toHaveAttribute('data-state', 'gone', { timeout: 30_000 });
  await expect(gone.getByTestId('wa-media-retry')).toHaveCount(0);
  await shot(page, `${app}-gone`, gone);
}

test('Inbox: una foto que no bajó se reintenta y se puede bajar de nuevo', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const chatId = `${phone}@s.whatsapp.net`;
  const name = `Tomás Reintento ${uid()}`;
  const tag = uid();
  // Inbox baja el archivo al mostrarlo: falla al cargar y en el reintento automático; "Bajar de nuevo" la trae.
  const events = [photo('inbox', chatId, phone, name, `hold-r-${tag}`, 'Foto que tarda en bajar', 0), photo('inbox', chatId, phone, name, `gone-g-${tag}`, 'Foto que ya no está', 10)];
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events } });
  expect(res.ok(), await res.text()).toBe(true);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
  const thread = page.locator('.ib-wa-thread');
  await expect(thread.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: 30_000 });
  await checkRetry(page, thread, 'inbox', () => request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: [{ type: 'fake_media_release', id: `hold-r-${tag}` }] } }));
});

test('Lines: una foto que no bajó se reintenta y se puede bajar de nuevo', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Reintento ${uid()}` } });
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
    const name = `Tomás Reintento ${uid()}`;
    const tag = uid();
    // Lines la baja al llegar (2 intentos), al mostrarla y en el reintento automático; "Bajar de nuevo" la trae.
    const events = [
      photo('lines', chatId, phone, name, `hold-r-${tag}`, 'Foto que tarda en bajar', 0),
      photo('lines', chatId, phone, name, `gone-g-${tag}`, 'Foto que ya no está', 10),
      photo('lines', chatId, phone, name, `img-m-${tag}`, 'Foto sin archivo guardado', 20),
    ];
    const res = await request.post(new URL(webhookUrl).pathname, { data: { events } });
    expect(res.ok(), await res.text()).toBe(true);
    // Que terminen los dos intentos de cuando llegó (antes de abrir el chat).
    await expect
      .poll(async () => String((await sql('SELECT media_url FROM groups_messages WHERE provider_message_id = ?', [`gone-g-${tag}`]))[0]?.media_url ?? 'x'), { timeout: 20_000 })
      .toBe('');
    await expect
      .poll(async () => String((await sql('SELECT media_url FROM groups_messages WHERE provider_message_id = ?', [`img-m-${tag}`]))[0]?.media_url ?? ''), { timeout: 20_000 })
      .not.toMatch(/^(evo:)?$/);
    // Una que quedó sin archivo guardado (falla definitiva de antes, sin "ya no está"): "Bajar de nuevo" la pide otra vez.
    await sql("UPDATE groups_messages SET media_url = '' WHERE provider_message_id = ?", [`img-m-${tag}`]);
    const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, chatId]);

    await page.goto(`/en/app/lines/inbox/${chat.id}`, { waitUntil: 'networkidle' });
    const thread = page.locator('.wa-thread');
    await checkRetry(page, thread, 'lines', () => request.post(new URL(webhookUrl).pathname, { data: { events: [{ type: 'fake_media_release', id: `hold-r-${tag}` }] } }));

    // Sin archivo guardado: el reintento automático la trae sola (POST al servidor, que la vuelve a pedir).
    const missing = msgWith(thread, 'Foto sin archivo guardado');
    await expect(missing.locator('.wa-image img.is-loaded')).toBeVisible({ timeout: 20_000 });
  } finally {
    await request.delete(`/api/groups/numbers/${numberId}`).catch(() => null);
  }
});
