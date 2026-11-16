import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * Lines e Inbox: "Enviar más tarde" desde la grabadora de notas de voz. Se
 * graba con el micrófono falso de Chromium, el reloj de la grabadora abre el
 * selector de cuándo (cerrarlo deja la grabación en pausa, sin perderla), la
 * nota queda en la tira de programados con su duración y un botón para
 * escucharla, y "Enviar ahora" la manda como nota de voz. WhatsApp falso
 * (GROUPS_FAKE=1). Con VOICE_LATER_SHOTS=<carpeta> guarda capturas de la
 * grabadora y del programado a 1280 y 390, en claro y en oscuro.
 */

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }, permissions: ['microphone'] });

const uid = () => Math.random().toString(36).slice(2, 8);

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

/** Capturas de lo que hay en pantalla a 1280 y 390, en claro y en oscuro (solo con VOICE_LATER_SHOTS). */
async function shots(page: Page, name: string) {
  const dir = process.env.VOICE_LATER_SHOTS;
  if (!dir) return;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/${name}-${width}-${scheme}.png` });
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 800 });
}

/** Nada se sale del ancho de la pantalla (ni la barra ni el programado empujan la página). */
async function expectNoSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** En el selector de cuándo: una fecha propia (mañana a esta hora) y confirmar. No depende de la hora del día. */
async function pickTomorrow(dialog: Locator) {
  const at = new Date(Date.now() + 24 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  await dialog.locator('input[type="datetime-local"]').fill(`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`);
  await dialog.locator('.ui-when-custom button[type="submit"]').click();
}

/** El programado se puede escuchar antes de que salga: reproducir y pausar. */
async function listen(voice: Locator) {
  const play = voice.locator('.wa-sched-voice-play');
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await expect(voice.locator('.wa-sched-voice-error')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

// ---------- Lines ----------

async function linesChat(page: Page, request: APIRequestContext, name: string) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Later ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const chatId = `549${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}@c.us`;
  const res = await request.post(new URL(info.webhookUrl).pathname, {
    data: { events: [{ type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName: name, providerMessageId: `e2e-${uid()}`, body: 'hola' }] },
  });
  expect(res.ok()).toBe(true);
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  // La primera vez (next dev compilando) el clic puede llegar antes de que la lista esté lista: se vuelve a tocar.
  await expect(async () => {
    await page.locator('.gr-row', { hasText: name }).click();
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
}

test('Lines: la nota de voz se programa desde la grabadora, queda en la tira con su duración y "Enviar ahora" la manda como nota de voz', async ({ page, request }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  const name = `Later${uid()}`;
  await linesChat(page, request, name);
  const bar = page.locator('.wa-recording');
  const later = page.getByTestId('lines-voice-later');
  const dialog = page.locator('dialog.ui-when[open]');

  // Menos de un segundo no se programa: el reloj, tocado apenas aparece, avisa y la grabación sigue.
  await page.getByRole('button', { name: 'Record a voice note' }).click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const t0 = performance.now();
        const tick = () => {
          const btn = document.querySelector<HTMLButtonElement>('[data-testid="lines-voice-later"]');
          if (btn) {
            btn.click();
            return resolve();
          }
          if (performance.now() - t0 > 10_000) return reject(new Error('the recording bar never showed up'));
          requestAnimationFrame(tick);
        };
        tick();
      }),
  );
  await expect(page.getByText('Record at least one second to schedule it.')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(bar).toBeVisible();

  // Con algo grabado, el reloj abre el selector y la grabación queda en pausa.
  await page.waitForTimeout(1_300);
  await later.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Voice note \(0:0\d\)/)).toBeVisible();
  await expect(bar.locator('.wa-rec-dot.is-paused')).toBeVisible();
  // Esc cierra el selector y vuelve a la grabación, en pausa y sin perderla.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Resume recording' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Send voice note', exact: true })).toBeVisible();
  await shots(page, 'lines-recording-bar');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoSideScroll(page);
  // En el teléfono el reloj se toca cómodo y la barra entra entera.
  const box = (await later.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(40);
  expect(box.height).toBeGreaterThanOrEqual(40);
  const send = (await bar.getByRole('button', { name: 'Send voice note', exact: true }).boundingBox())!;
  expect(send.x + send.width).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Se programa: la grabadora se cierra y la nota queda en la tira del chat.
  await later.click();
  await pickTomorrow(dialog);
  // Sube el audio y lo programa (con next dev, la primera vez compila las rutas de subida).
  await expect(bar).toHaveCount(0, { timeout: 90_000 });
  const strip = page.getByTestId('lines-scheduled-strip');
  const voice = strip.getByTestId('scheduled-voice');
  await expect(voice).toBeVisible();
  await expect(voice).toContainText(/Voice note \(0:0\d\)/);
  // Nada salió todavía.
  await expect(page.locator('.gr-msg-out')).toHaveCount(0);
  const [row] = await sql("SELECT b.media_kind, b.media_duration, b.media_type, b.body FROM groups_broadcasts b JOIN groups_broadcast_recipients r ON r.broadcast_id = b.id JOIN groups_chats c ON c.id = r.chat_id WHERE c.name = ? AND b.kind = 'scheduled'", [name]);
  expect(row).toMatchObject({ media_kind: 'voice', body: '' });
  expect(Number(row.media_duration)).toBeGreaterThanOrEqual(1);
  expect(String(row.media_type)).toMatch(/^audio\//);
  await listen(voice);
  // Una nota de voz no tiene texto que editar: se le cambia la hora.
  await expect(strip.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(strip.getByRole('button', { name: 'Change time' })).toBeVisible();
  await shots(page, 'lines-scheduled-voice');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoSideScroll(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  // "Enviar ahora": sale como nota de voz y deja la tira.
  await strip.getByRole('button', { name: 'Send now' }).click();
  const sent = page.locator('.gr-msg-out').filter({ has: page.locator('.wa-voice') });
  await expect(sent).toHaveCount(1, { timeout: 30_000 });
  await expect(strip).toHaveCount(0, { timeout: 20_000 });
  const [msg] = await sql("SELECT meta, status FROM groups_messages WHERE chat_id = (SELECT id FROM groups_chats WHERE name = ?) AND direction = 'out'", [name]);
  expect(msg.status).not.toBe('failed');
  expect((JSON.parse(String(msg.meta)) as { media: Record<string, unknown> }).media).toMatchObject({ kind: 'voice', ptt: true });
  expect(errors, errors.join('\n')).toEqual([]);
});

// ---------- Inbox ----------

async function inboxChat(page: Page, request: APIRequestContext, title: string) {
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const phone = `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}1`;
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, {
    data: { events: [{ type: 'message', chatId: `${phone}@s.whatsapp.net`, chatName: title, isGroup: false, fromMe: false, senderPhone: phone, senderName: title, providerMessageId: `in-${uid()}`, body: 'hola', timestamp: new Date().toISOString() }] },
  });
  expect(res.ok()).toBe(true);
  // La conversación ya compilada y leída una vez (con next dev, la primera lectura puede pasar el tiempo de la pantalla).
  const [row] = await sql('SELECT id FROM inbox_threads WHERE title = ?', [title]);
  expect((await request.get(`/api/inbox/threads/${row.id}`, { timeout: 90_000 })).ok()).toBe(true);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await expect(async () => {
    // Con next dev compilando, la primera lectura del chat puede pasar el tiempo de la pantalla: "Reintentar".
    const retry = page.getByRole('button', { name: 'Try again' });
    if (await retry.isVisible()) await retry.click();
    else await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click();
    await expect(page.locator('.ib-wa-thread').getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  return String(row.id);
}

test('Inbox: la nota de voz se programa desde la grabadora, queda en los programados con su duración y "Enviar ya" la manda como nota de voz', async ({ page, request }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  const title = `Later ${uid()}`;
  const threadId = await inboxChat(page, request, title);
  const thread = page.locator('.ib-wa-thread');
  const bar = thread.locator('.wa-recording');
  const later = page.getByTestId('inbox-voice-later');
  const dialog = page.locator('dialog.ui-when[open]');

  await thread.getByRole('button', { name: 'Record a voice message' }).click();
  await expect(bar).toBeVisible();
  await page.waitForTimeout(1_500);
  await later.click();
  await expect(dialog).toBeVisible();
  await expect(bar.locator('.wa-rec-dot.is-paused')).toBeVisible();
  // Un clic afuera cierra el selector y vuelve a la grabación, en pausa y sin perderla.
  await page.mouse.click(8, 8);
  await expect(dialog).toHaveCount(0);
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Resume recording' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Send the voice message', exact: true })).toBeVisible();
  await shots(page, 'inbox-recording-bar');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoSideScroll(page);
  const box = (await later.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(40);
  expect(box.height).toBeGreaterThanOrEqual(40);
  const send = (await bar.getByRole('button', { name: 'Send the voice message', exact: true }).boundingBox())!;
  expect(send.x + send.width).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Se programa: la grabadora se cierra y la nota queda en los programados del chat.
  await later.click();
  await pickTomorrow(dialog);
  // Sube el audio y lo programa (con next dev, la primera vez compila las rutas de subida).
  await expect(bar).toHaveCount(0, { timeout: 90_000 });
  const list = thread.locator('.ib-scheduled');
  const voice = list.getByTestId('scheduled-voice');
  await expect(voice).toBeVisible();
  await expect(voice).toContainText(/Voice note \(0:0\d\)/);
  await expect(thread.locator('.gr-msg-out')).toHaveCount(0);
  const [row] = await sql("SELECT media_kind, media_duration, media_type, body FROM inbox_scheduled WHERE thread_id = ? AND status = 'pending'", [threadId]);
  expect(row).toMatchObject({ media_kind: 'voice', body: '' });
  expect(Number(row.media_duration)).toBeGreaterThanOrEqual(1);
  expect(String(row.media_type)).toMatch(/^audio\//);
  await listen(voice);
  // "Editar" de una nota de voz le cambia la hora: abre el selector de cuándo (Esc lo cierra).
  await list.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(voice).toBeVisible();
  await shots(page, 'inbox-scheduled-voice');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoSideScroll(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  // "Enviar ya": sale como nota de voz y deja los programados.
  await list.getByRole('button', { name: 'Send now' }).click();
  const sent = thread.locator('.gr-msg-out').filter({ has: page.locator('.wa-voice') });
  await expect(sent).toHaveCount(1, { timeout: 30_000 });
  await expect(list).toHaveCount(0, { timeout: 20_000 });
  const [msg] = await sql('SELECT media_type, meta FROM inbox_messages WHERE thread_id = ? AND from_me = 1', [threadId]);
  expect(msg.media_type).toBe('audio');
  expect(JSON.parse(String(msg.meta)) as Record<string, unknown>).toMatchObject({ ptt: true });
  expect(Number((JSON.parse(String(msg.meta)) as { duration: number }).duration)).toBeGreaterThanOrEqual(1);
  expect(errors, errors.join('\n')).toEqual([]);
});
