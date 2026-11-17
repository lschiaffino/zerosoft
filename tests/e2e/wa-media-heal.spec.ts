import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { waLinkIp } from './helpers/wa-link';

/**
 * Audios y documentos que no están, en Inbox y en Lines, con el WhatsApp
 * falso: tocar reproducir (o la tarjeta) los va a buscar y, si vuelven, suenan
 * o se bajan; si WhatsApp ya no los tiene, lo dice y el botón sigue vivo. La
 * transcripción se hace cuando el audio vuelve. Además: el archivo es privado
 * (otra persona no lo lee) y se sirve con Range.
 *
 * Prefijos del WhatsApp falso: "failN-" falla N veces y después baja,
 * "gone-" ya no está, "aud-" un audio, "doc-" un PDF. Con MH_SHOTS=<carpeta>
 * guarda capturas a 1280 y 390, claro y oscuro.
 *
 * Nombres, números y textos inventados.
 */

test.describe.configure({ timeout: 240_000 });

/**
 * Con `next dev` (como corre esto en una máquina local), la primera vez que se pide una ruta se compila, y las rutas
 * agrupadas de Inbox y Lines tardan: se piden una vez antes, con margen, para que la pantalla no se quede esperando.
 * Con el build de CI responden al instante.
 */
test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  const ctx = await playwright.request.newContext({ baseURL: `http://localhost:${Number(process.env.E2E_PORT) || 3210}` });
  try {
    for (const url of ['/api/inbox/threads/warm', '/api/inbox/media/warm', '/api/inbox/messages/warm', '/api/groups/media/warm', '/api/groups/messages/warm/transcript', '/api/groups/chats/warm/messages']) {
      await ctx.get(url, { timeout: 280_000 }).catch(() => null);
    }
  } finally {
    await ctx.dispose();
  }
});

const uid = () => Math.random().toString(36).slice(2, 8);

/**
 * El chat abierto, con su encabezado. En una máquina cargada el pedido del chat puede pasar el tiempo que espera la
 * pantalla, que entonces ofrece "Try again": se toca y se sigue esperando (con el build de CI abre a la primera).
 */
async function openedThread(page: Page, name: string) {
  const heading = page.locator('.ib-wa-thread').getByRole('heading', { level: 2, name });
  const again = page.getByRole('button', { name: 'Try again' });
  for (let i = 0; i < 6; i++) {
    await expect(heading.or(again).first()).toBeVisible({ timeout: 40_000 });
    if (await heading.isVisible()) return;
    await again.click();
  }
  await expect(heading).toBeVisible({ timeout: 40_000 });
}

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function shot(page: Page, name: string, target: Locator) {
  const dir = process.env.MH_SHOTS;
  if (!dir) return;
  await target.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/${name}.png` });
}

type Ev = Record<string, unknown>;

function media(app: 'inbox' | 'lines', chatId: string, phone: string, name: string, pid: string, kind: 'voice' | 'document', sec: number): Ev {
  return {
    type: 'message',
    chatId,
    isGroup: false,
    fromMe: false,
    senderPhone: phone,
    senderName: name,
    providerMessageId: pid,
    body: '',
    media: {
      url: app === 'lines' ? `evo:${pid}` : '',
      type: kind === 'voice' ? 'audio/ogg' : 'application/pdf',
      name: kind === 'voice' ? '' : `informe-${pid.slice(-4)}.pdf`,
      fetchRef: { providerMessageId: pid, chatId, fromMe: false },
      info: kind === 'voice' ? { kind: 'voice', ptt: true, duration: 2 } : { kind: 'document', size: 2048 },
    },
    timestamp: new Date(Date.now() - 3_600_000 + sec * 1000).toISOString(),
  };
}

/** ¿El audio de esta burbuja avanzó? (suena de verdad, no solo cambió el ícono). */
const played = (voice: Locator) => voice.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime > 0 || a.ended);

/** Capturas del estado a 1280 y 390, claro y oscuro (solo con MH_SHOTS). */
async function themesAndSizes(page: Page, context: BrowserContext, baseURL: string, app: string, target: () => Locator, open: () => Promise<void>) {
  if (!process.env.MH_SHOTS) return;
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 860 });
      await open();
      await expect(target()).toBeVisible();
      // Sin scroll horizontal en el teléfono.
      if (width === 390) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `${app}-${width}-${theme}`, target());
    }
  }
  await context.addCookies([{ name: 'zs_theme', value: 'light', url: baseURL }]);
  await page.setViewportSize({ width: 1280, height: 860 });
}

test('Inbox: tocar reproducir va a buscar el audio; lo que ya no está lo dice y se puede volver a pedir', async ({ page, request, context, baseURL, playwright }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const chatId = `${phone}@s.whatsapp.net`;
  const name = `Vera Audio ${uid()}`;
  const tag = uid();
  const ids = { heal: `fail2-aud-${tag}`, gone: `gone-aud-${tag}`, doc: `fail1-doc-${tag}`, docGone: `gone-doc-${tag}`, ok: `aud-ok-${tag}`, off: `off-aud-${tag}` };
  const events = [
    media('inbox', chatId, phone, name, ids.heal, 'voice', 0),
    media('inbox', chatId, phone, name, ids.gone, 'voice', 10),
    media('inbox', chatId, phone, name, ids.doc, 'document', 20),
    media('inbox', chatId, phone, name, ids.docGone, 'document', 30),
    media('inbox', chatId, phone, name, ids.ok, 'voice', 40),
    media('inbox', chatId, phone, name, ids.off, 'voice', 50),
  ];
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events } });
  expect(res.ok(), await res.text()).toBe(true);
  const row = async (ext: string) => (await sql('SELECT id FROM inbox_messages WHERE external_id = ?', [ext]))[0] as { id: string };

  const open = async () => {
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
    await openedThread(page, name);
  };
  await open();
  const thread = page.locator('.ib-wa-thread');
  const voices = thread.getByTestId('wa-voice');
  await expect(voices).toHaveCount(4);

  // La transcripción se pide sola al ver el audio: como el audio no está, falla y no muestra nada (el aviso va en el audio).
  const healId = (await row(ids.heal)).id;
  await expect
    .poll(async () => String((await sql("SELECT error FROM wa_transcripts WHERE scope = 'inbox' AND message_id = ?", [healId]))[0]?.error ?? ''), { timeout: 30_000 })
    .toBe('media_unavailable');
  await expect(thread.locator('.wa-transcript.is-off')).toHaveCount(0);

  // 1. Nota de voz que no carga: reproducir la va a buscar sola y suena. Nunca un botón apagado.
  const heal = voices.nth(0);
  await expect(heal.getByTestId('wa-voice-play')).toBeEnabled();
  await heal.getByTestId('wa-voice-play').click();
  await expect(heal).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await expect.poll(() => played(heal), { timeout: 20_000 }).toBe(true);
  // Y con el audio de vuelta, se transcribe.
  await expect
    .poll(async () => String((await sql("SELECT status FROM wa_transcripts WHERE scope = 'inbox' AND message_id = ?", [healId]))[0]?.status ?? ''), { timeout: 30_000 })
    .toBe('done');
  // La del primer audio (el que se acaba de traer), debajo de su burbuja.
  await expect(thread.locator('.gr-msg').filter({ has: page.getByTestId('wa-voice') }).first().locator('.wa-transcript')).toBeVisible({ timeout: 60_000 });

  // 2. Nota de voz que WhatsApp ya no tiene: lo dice, y el botón queda para pedírsela de nuevo al teléfono.
  const gone = voices.nth(1);
  await gone.getByTestId('wa-voice-play').click();
  await expect(gone).toHaveAttribute('data-state', 'gone', { timeout: 30_000 });
  await expect(gone.getByTestId('wa-voice-play')).toBeEnabled();
  await expect(gone.getByRole('status')).not.toBeEmpty();
  await gone.getByTestId('wa-voice-play').click();
  await expect(gone).toHaveAttribute('data-state', 'gone', { timeout: 30_000 });
  await shot(page, 'inbox-voice-states', gone);

  // 2b. El gateway dice que la sesión está cerrada: "línea desconectada", no "ya no está".
  const off = voices.nth(3);
  await off.getByTestId('wa-voice-play').click();
  await expect(off).toHaveAttribute('data-state', 'offline', { timeout: 30_000 });
  await expect(off.getByTestId('wa-voice-play')).toBeEnabled();

  // 3. Documento: la tarjeta lo va a buscar; la primera vez falla (pasajero) y dice que no se pudo; la segunda lo baja.
  const docs = thread.getByTestId('wa-doc-retry');
  await expect(docs).toHaveCount(2);
  await docs.nth(0).click();
  await expect(docs.nth(0)).toHaveAttribute('data-state', 'failed', { timeout: 30_000 });
  const download = page.waitForEvent('download');
  await docs.nth(0).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  // 4. Documento que ya no está.
  const docGone = thread.getByTestId('wa-doc-retry').last();
  await docGone.click();
  await expect(docGone).toHaveAttribute('data-state', 'gone', { timeout: 30_000 });
  await shot(page, 'inbox-doc-states', docGone);

  // 5. El archivo es de su dueña: sin sesión 401, otra persona 404. Con Range, 206.
  const okId = (await row(ids.ok)).id;
  const ranged = await request.get(`/api/inbox/media/${okId}`, { headers: { range: 'bytes=0-99' } });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()['content-range']).toMatch(/^bytes 0-99\/\d+$/);
  expect(ranged.headers()['accept-ranges']).toBe('bytes');
  expect(ranged.headers()['cache-control']).toContain('private');
  expect((await ranged.body()).length).toBe(100);
  const as = async (who: string) => {
    const ctx = await playwright.request.newContext({ baseURL, storageState: { cookies: [{ name: 'zs_e2e_as', value: who, domain: 'localhost', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] } });
    try {
      // Una persona de verdad, con su workspace: lo que se prueba es que no lea lo de otra.
      if (who !== 'session') await ctx.post('/api/onboarding', { data: { kind: 'full', mode: 'personal', name: 'Otra', locale: 'en' } }).catch(() => null);
      return (await ctx.get(`/api/inbox/media/${okId}`)).status();
    } finally {
      await ctx.dispose();
    }
  };
  expect(await as('session')).toBe(401);
  expect(await as(`otra-${uid()}@own-e2e.test`)).toBe(404);

  await themesAndSizes(page, context, baseURL!, 'inbox', () => page.locator('.ib-wa-thread').getByTestId('wa-voice').nth(1), async () => {
    await open();
    const v = page.locator('.ib-wa-thread').getByTestId('wa-voice').nth(1);
    await v.getByTestId('wa-voice-play').click();
    await expect(v).toHaveAttribute('data-state', 'gone', { timeout: 30_000 });
    const d = page.locator('.ib-wa-thread').getByTestId('wa-doc-retry').last();
    await d.click();
    await expect(d).toHaveAttribute('data-state', 'gone', { timeout: 30_000 });
  });
});

test('Lines: un audio sin archivo se va a buscar al tocar reproducir; el documento, al tocar la tarjeta', async ({ page, request, context, baseURL, playwright }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Audios ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  try {
    await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
    await expect
      .poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 30_000 })
      .toBe('connected');
    const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
    const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    const chatId = `${phone}@s.whatsapp.net`;
    const name = `Vera Audio ${uid()}`;
    const tag = uid();
    const ids = { heal: `aud-h-${tag}`, gone: `gone-aud-${tag}`, doc: `doc-d-${tag}` };
    const events = [media('lines', chatId, phone, name, ids.heal, 'voice', 0), media('lines', chatId, phone, name, ids.gone, 'voice', 10), media('lines', chatId, phone, name, ids.doc, 'document', 20)];
    const res = await request.post(new URL(webhookUrl).pathname, { data: { events } });
    expect(res.ok(), await res.text()).toBe(true);
    const urlOf = async (pid: string) => String((await sql('SELECT media_url FROM groups_messages WHERE provider_message_id = ?', [pid]))[0]?.media_url ?? 'x');
    // Lo que llegó bien queda guardado; lo que WhatsApp no tiene queda sin archivo.
    await expect.poll(() => urlOf(ids.heal), { timeout: 20_000 }).not.toMatch(/^(evo:.*|x)?$/);
    await expect.poll(() => urlOf(ids.doc), { timeout: 20_000 }).not.toMatch(/^(evo:.*|x)?$/);
    await expect.poll(() => urlOf(ids.gone), { timeout: 20_000 }).toBe('');
    // Como quedaba un archivo que no se pudo guardar al llegar (antes de este cambio): sin archivo, sin marca.
    await sql("UPDATE groups_messages SET media_url = '' WHERE provider_message_id IN (?, ?)", [ids.heal, ids.doc]);
    const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, chatId]);
    const [healRow] = await sql('SELECT id FROM groups_messages WHERE provider_message_id = ?', [ids.heal]);

    const open = async () => {
      await page.goto(`/en/app/lines/inbox/${chat.id}`, { waitUntil: 'networkidle' });
      await expect(page.locator('.wa-thread').getByTestId('wa-voice').first()).toBeVisible({ timeout: 30_000 });
    };
    await open();
    const thread = page.locator('.wa-thread');
    const voices = thread.getByTestId('wa-voice');
    await expect(voices).toHaveCount(2);
    await shot(page, 'lines-before', voices.nth(0));

    // 1. Audio sin archivo: el botón está vivo, lo va a buscar y suena. Queda guardado y se transcribe.
    const heal = voices.nth(0);
    await expect(heal).toHaveAttribute('data-state', 'idle');
    await expect(heal.getByTestId('wa-voice-play')).toBeEnabled();
    await heal.getByTestId('wa-voice-play').click();
    await expect(heal).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
    await expect.poll(() => played(heal), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => urlOf(ids.heal), { timeout: 10_000 }).not.toBe('');
    await expect
      .poll(async () => String((await sql("SELECT status FROM wa_transcripts WHERE scope = 'lines' AND message_id = ?", [String(healRow.id)]))[0]?.status ?? ''), { timeout: 30_000 })
      .toBe('done');

    // 2. El que WhatsApp ya no tiene: lo dice desde el principio y se puede volver a pedir.
    const gone = voices.nth(1);
    await expect(gone).toHaveAttribute('data-state', 'gone');
    await expect(gone.getByTestId('wa-voice-play')).toBeEnabled();
    await gone.getByTestId('wa-voice-play').click();
    await expect(gone).toHaveAttribute('data-state', 'gone', { timeout: 30_000 });

    // 3. Documento sin archivo: la tarjeta lo va a buscar y lo baja.
    const doc = thread.getByTestId('wa-doc-retry');
    await expect(doc).toHaveCount(1);
    const download = page.waitForEvent('download');
    await doc.click();
    await download;
    await expect.poll(() => urlOf(ids.doc), { timeout: 10_000 }).not.toBe('');

    // 4. Con la línea desvinculada no se marca nada como perdido: dice que está desconectada.
    await sql("UPDATE groups_messages SET media_url = '', meta = json_remove(meta, '$.mediaGone') WHERE provider_message_id = ?", [ids.gone]);
    await sql("UPDATE groups_numbers SET status = 'disconnected' WHERE id = ?", [numberId]);
    await open();
    const off = page.locator('.wa-thread').getByTestId('wa-voice').nth(1);
    await off.getByTestId('wa-voice-play').click();
    await expect(off).toHaveAttribute('data-state', 'offline', { timeout: 30_000 });
    await expect(off.getByTestId('wa-voice-play')).toBeEnabled();
    expect(String((await sql('SELECT meta FROM groups_messages WHERE provider_message_id = ?', [ids.gone]))[0]?.meta ?? '')).not.toContain('mediaGone');
    await shot(page, 'lines-offline', off);
    await sql("UPDATE groups_numbers SET status = 'connected' WHERE id = ?", [numberId]);

    // 5. Otra persona (otro workspace) no puede pedir ni volver a bajar el archivo.
    const ctx = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [{ name: 'zs_e2e_as', value: `otra-${uid()}@own-e2e.test`, domain: 'localhost', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] },
    });
    try {
      await ctx.post('/api/onboarding', { data: { kind: 'full', mode: 'personal', name: 'Otra', locale: 'en' } }).catch(() => null);
      expect([403, 404]).toContain((await ctx.get(`/api/groups/media/${healRow.id}`)).status());
      expect([403, 404]).toContain((await ctx.post(`/api/groups/media/${healRow.id}`)).status());
    } finally {
      await ctx.dispose();
    }

    await themesAndSizes(page, context, baseURL!, 'lines', () => page.locator('.wa-thread').getByTestId('wa-voice').nth(1), async () => {
      await open();
      const v = page.locator('.wa-thread').getByTestId('wa-voice').nth(1);
      await v.getByTestId('wa-voice-play').click();
      await expect(v).toHaveAttribute('data-state', 'gone', { timeout: 30_000 });
    });
  } finally {
    await request.delete(`/api/groups/numbers/${numberId}`).catch(() => null);
  }
});
