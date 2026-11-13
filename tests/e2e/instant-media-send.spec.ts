import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines e Inbox: una nota de voz o una foto aparecen en el chat al tocar
 * enviar, con el reloj y la copia local, aunque la subida tarde (acá se la
 * demora 3 s): la grabadora o la vista previa se cierran ya y el tilde
 * aparece cuando el servidor lo guarda. Y pegar más imágenes con la vista
 * previa abierta las suma (las repetidas no). Micrófono falso de Chromium;
 * WhatsApp falso (GROUPS_FAKE=1). Con INSTANT_SHOTS=<carpeta> guarda capturas.
 */

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }, permissions: ['microphone'] });

const uid = () => Math.random().toString(36).slice(2, 8);
const UPLOAD_DELAY_MS = 3_000;
const INSTANT_MS = 300;
// 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

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

async function shot(page: Page, name: string) {
  const dir = process.env.INSTANT_SHOTS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}-1280.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${dir}/${name}-390.png` });
  await page.setViewportSize({ width: 1280, height: 800 });
}

/** Demora `pattern` 3 s (la subida lenta). */
async function slow(page: Page, pattern: string) {
  await page.route(pattern, async (route) => {
    await new Promise((r) => setTimeout(r, UPLOAD_DELAY_MS));
    await route.continue().catch(() => undefined);
  });
}

/**
 * Toca `button` y mide, en la página, cuánto tarda en estar la burbuja provisoria (con el reloj) y en irse `gone`.
 * Devuelve los milisegundos.
 */
async function timeToBubble(page: Page, button: string, bubble: string, gone: string): Promise<number> {
  return page.evaluate(
    ({ button, bubble, gone }) =>
      new Promise<number>((resolve, reject) => {
        const btn = document.querySelector<HTMLButtonElement>(button);
        if (!btn) return reject(new Error(`no ${button}`));
        const t0 = performance.now();
        btn.click();
        const check = () => {
          const shown = document.querySelector(bubble);
          if (shown && !document.querySelector(gone)) return resolve(Math.round(performance.now() - t0));
          if (performance.now() - t0 > 5_000) return reject(new Error('the pending bubble never showed up'));
          requestAnimationFrame(check);
        };
        check();
      }),
    { button, bubble, gone },
  );
}

/** Pega estos archivos (imágenes hechas en la página, por color) en `target`, como ⌘V. */
async function pasteImages(page: Page, target: string, colors: string[]) {
  await page.evaluate(
    async ({ target, colors }) => {
      const make = (color: string) =>
        new Promise<File>((resolve) => {
          const c = document.createElement('canvas');
          c.width = 8;
          c.height = 8;
          const g = c.getContext('2d')!;
          g.fillStyle = color;
          g.fillRect(0, 0, 8, 8);
          c.toBlob((b) => resolve(new File([b!], 'image.png', { type: 'image/png' })), 'image/png');
        });
      const el = document.querySelector<HTMLElement>(target);
      if (!el) throw new Error(`no ${target}`);
      el.focus();
      for (const color of colors) {
        const dt = new DataTransfer();
        dt.items.add(await make(color));
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 150));
      }
    },
    { target, colors },
  );
}

// ---------- Lines ----------

async function linesChat(page: Page, request: APIRequestContext, name: string) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Instant ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const chatId = `549${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}@c.us`;
  const res = await request.post(new URL(info.webhookUrl).pathname, {
    data: { events: [{ type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName: name, providerMessageId: `e2e-${uid()}`, body: '¿me mandás la foto?' }] },
  });
  expect(res.ok()).toBe(true);
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  // La primera vez (next dev compilando) el clic puede llegar antes de que la lista esté lista: se vuelve a tocar.
  await expect(async () => {
    await page.locator('.gr-row', { hasText: name }).click();
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('Lines: la nota de voz y la foto aparecen al instante con el reloj y el tilde llega cuando se guardan', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const name = `Instant${uid()}`;
  await linesChat(page, request, name);
  await slow(page, '**/api/groups/upload');

  // Nota de voz: grabar un poco con el micrófono falso y tocar enviar.
  await page.getByRole('button', { name: 'Record a voice note' }).click();
  await expect(page.locator('.wa-recording')).toBeVisible();
  await page.waitForTimeout(1_200);
  const voiceMs = await timeToBubble(page, '.wa-recording button[aria-label="Send voice note"]', '[id^="m-tmp-"] .wa-voice', '.wa-recording');
  console.log(`[instant] Lines voice note: bubble in ${voiceMs} ms`);
  expect(voiceMs).toBeLessThan(INSTANT_MS);
  const pendingVoice = page.locator('[id^="m-tmp-"]').filter({ has: page.locator('.wa-voice') });
  await expect(pendingVoice.locator('.wa-ticks[title="Sending"]')).toBeVisible();
  // El campo queda libre: el micrófono vuelve enseguida.
  await expect(page.getByRole('button', { name: 'Record a voice note' })).toBeVisible();
  await shot(page, 'lines-voice-pending');
  // Termina la subida: el mensaje guardado reemplaza a la burbuja, con su tilde.
  await expect(page.locator('[id^="m-tmp-"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.gr-msg-out').filter({ has: page.locator('.wa-voice') }).last().locator('.wa-ticks[title="Sent"], .wa-ticks[title="Delivered"], .wa-ticks[title="Read"]')).toBeVisible();

  // Foto: a la bandeja (se sube por detrás) y enviar; la vista previa se cierra ya.
  await page.locator('input[type=file]').first().setInputFiles({ name: 'terraza.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.wa-attach-pane')).toBeVisible();
  const photoMs = await timeToBubble(page, '.wa-attach-send', '[id^="m-tmp-"] .wa-image', '.wa-attach-pane');
  console.log(`[instant] Lines photo: bubble in ${photoMs} ms`);
  expect(photoMs).toBeLessThan(INSTANT_MS);
  const pendingPhoto = page.locator('[id^="m-tmp-"]').filter({ has: page.locator('.wa-image') });
  await expect(pendingPhoto.locator('.wa-ticks[title="Sending"]')).toBeVisible();
  await expect(pendingPhoto.locator('.wa-upring')).toBeVisible();
  expect(await pendingPhoto.locator('img:not(.wa-thumb)').getAttribute('src')).toMatch(/^blob:/);
  await shot(page, 'lines-photo-pending');
  await expect(page.locator('[id^="m-tmp-"]')).toHaveCount(0, { timeout: 20_000 });
  const sentPhoto = page.locator('.gr-msg-out').filter({ has: page.locator('.wa-image') }).last();
  await expect(sentPhoto.locator('.wa-ticks[title="Sent"], .wa-ticks[title="Delivered"], .wa-ticks[title="Read"]')).toBeVisible();
  // Uno de cada uno guardado (los reintentos no duplican).
  const rows = await sql("SELECT media_type FROM groups_messages WHERE chat_id = (SELECT id FROM groups_chats WHERE name = ?) AND direction = 'out' ORDER BY created_at", [name]);
  expect(rows.map((r) => String(r.media_type).split('/')[0])).toEqual(['audio', 'image']);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Lines: pegar imágenes con la vista previa abierta las suma, sin repetir', async ({ page, request }) => {
  const errors = watchErrors(page);
  const name = `Paste${uid()}`;
  await linesChat(page, request, name);
  // La primera, pegada en el campo, abre la vista previa.
  await pasteImages(page, '.wa-composer textarea', ['#c0392b']);
  await expect(page.locator('.wa-attach-pane')).toBeVisible();
  // Otra distinta y la misma de antes (las capturas se llaman todas image.png): entra una sola.
  await pasteImages(page, '.wa-attach-caption input', ['#2980b9', '#c0392b']);
  await expect(page.locator('.wa-attach-thumb:not(.is-add)')).toHaveCount(2);
  // La que se sumó queda elegida.
  await expect(page.locator('.wa-attach-thumb.is-on')).toHaveCount(1);
  await expect(page.locator('.wa-attach-thumb:not(.is-add)').nth(1)).toHaveClass(/is-on/);
  // Pegar texto en el comentario sigue pegando texto.
  await page.locator('.wa-attach-caption input').fill('dos fotos');
  await expect(page.locator('.wa-attach-caption input')).toHaveValue('dos fotos');
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
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await expect(async () => {
    await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click();
    await expect(page.locator('.ib-wa-thread').getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
}

test('Inbox: la nota de voz y la foto aparecen al instante con el reloj y el tilde llega cuando se guardan', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const title = `Instant ${uid()}`;
  await inboxChat(page, request, title);
  await slow(page, '**/api/inbox/threads/*/media');
  const thread = page.locator('.ib-wa-thread');

  await thread.getByRole('button', { name: 'Record a voice message' }).click();
  await expect(thread.locator('.wa-recording')).toBeVisible();
  await page.waitForTimeout(1_200);
  const voiceMs = await timeToBubble(page, '.wa-recording button[aria-label="Send the voice message"]', '[id^="m-tmp-"] .wa-voice', '.wa-recording');
  console.log(`[instant] Inbox voice note: bubble in ${voiceMs} ms`);
  expect(voiceMs).toBeLessThan(INSTANT_MS);
  const pendingVoice = thread.locator('[id^="m-tmp-"]').filter({ has: page.locator('.wa-voice') });
  await expect(pendingVoice.locator('.wa-ticks[title="Sending"]')).toBeVisible();
  await expect(thread.getByRole('button', { name: 'Record a voice message' })).toBeVisible();
  await shot(page, 'inbox-voice-pending');
  await expect(thread.locator('[id^="m-tmp-"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(thread.locator('.gr-msg-out').filter({ has: page.locator('.wa-voice') }).last().locator('.wa-ticks[title="Sent"], .wa-ticks[title="Delivered"], .wa-ticks[title="Read"]')).toBeVisible();

  await thread.locator('.ib-wa-attach input[type=file]').first().setInputFiles({ name: 'terraza.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.wa-attach-pane')).toBeVisible();
  const photoMs = await timeToBubble(page, '.wa-attach-send', '[id^="m-tmp-"] .wa-image', '.wa-attach-pane');
  console.log(`[instant] Inbox photo: bubble in ${photoMs} ms`);
  expect(photoMs).toBeLessThan(INSTANT_MS);
  const pendingPhoto = thread.locator('[id^="m-tmp-"]').filter({ has: page.locator('.wa-image') });
  await expect(pendingPhoto.locator('.wa-ticks[title="Sending"]')).toBeVisible();
  expect(await pendingPhoto.locator('img:not(.wa-thumb)').getAttribute('src')).toMatch(/^blob:/);
  await shot(page, 'inbox-photo-pending');
  await expect(thread.locator('[id^="m-tmp-"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(thread.locator('.gr-msg-out').filter({ has: page.locator('.wa-image') }).last().locator('.wa-ticks[title="Sent"], .wa-ticks[title="Delivered"], .wa-ticks[title="Read"]')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Inbox: pegar imágenes con la vista previa abierta las suma, sin repetir', async ({ page, request }) => {
  const errors = watchErrors(page);
  const title = `Paste ${uid()}`;
  await inboxChat(page, request, title);
  await pasteImages(page, '.ib-wa-thread .wa-composer textarea', ['#16a085']);
  await expect(page.locator('.wa-attach-pane')).toBeVisible();
  await pasteImages(page, '.wa-attach-caption input', ['#8e44ad', '#16a085']);
  await expect(page.locator('.wa-attach-thumb:not(.is-add)')).toHaveCount(2);
  await expect(page.locator('.wa-attach-thumb:not(.is-add)').nth(1)).toHaveClass(/is-on/);
  expect(errors, errors.join('\n')).toEqual([]);
});
