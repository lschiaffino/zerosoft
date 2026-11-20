import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines: el aviso de importación arriba de la lista de chats. Mientras trae
 * mensajes muestra el avance; con todos los chats contados deja de decir
 * "importando mensajes"; al terminar avisa y se va solo; si está frenada lo
 * dice. En cualquier estado se cierra, y lo cerrado no vuelve al recargar.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

/** Un número falso conectado con un chat. Devuelve el id del número. */
async function seedLine(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Aviso ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const res = await request.post(new URL(webhookUrl).pathname, {
    data: {
      events: [{ type: 'message', chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: phone, senderName: `Persona ${uid()}`, providerMessageId: `ib-${uid()}`, body: 'Mensaje de prueba', timestamp: Date.now() }],
    },
  });
  expect(res.ok()).toBe(true);
  return id;
}

/** La base de la corrida (playwright.config.ts): la importación se escribe ahí, como la dejaría el importador. */
async function sql(q: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    for (let i = 0; ; i++) {
      try {
        return (await db.execute({ sql: q, args })).rows;
      } catch (err) {
        if (i >= 20 || !String(err).includes('SQLITE_BUSY')) throw err;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  } finally {
    db.close();
  }
}

interface Import {
  status: string;
  phase: string;
  chatsTotal: number;
  chatsDone: number;
  messages: number;
  error: string;
  startedAt: string;
  finishedAt: string | null;
  /** Hace cuánto fue el último avance guardado (más de 10 min: "no avanza"). */
  quietMs: number;
}

/**
 * Deja la importación de la línea en ese estado. Reclamada por una hora: el importador no la toca mientras dura la
 * prueba, y la bandeja la lee como cualquier otra (la primera lista del servidor y las siguientes).
 */
async function setImport(numberId: string, workspace: string, im: Import) {
  const now = Date.now();
  await sql(
    `INSERT INTO groups_imports (number_id, user_id, status, phase, cursor, per_chat, chats_total, chats_done, messages, error, attempts, claimed_until, started_at, finished_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, 0, ?, ?, ?, ?)
     ON CONFLICT(number_id) DO UPDATE SET status = excluded.status, phase = excluded.phase, chats_total = excluded.chats_total,
       chats_done = excluded.chats_done, messages = excluded.messages, error = excluded.error, claimed_until = excluded.claimed_until,
       started_at = excluded.started_at, finished_at = excluded.finished_at, updated_at = excluded.updated_at`,
    [numberId, workspace, im.status, im.phase, im.chatsTotal, im.chatsDone, im.messages, im.error, new Date(now + 3_600_000).toISOString(), im.startedAt, im.finishedAt, new Date(now - im.quietMs).toISOString()],
  );
}

/**
 * Espera a que el aviso esté en ese estado. Con el aviso en vivo prendido la bandeja relee la lista cada minuto (un
 * cambio en la importación no genera un aviso en vivo); al volver a la ventana la relee en el acto: se le avisa cada
 * pocos segundos. Una relectura de la misma lista ya no corta a la que está en camino, así que avisar seguido no traba.
 */
async function showing(page: Page, kind: string) {
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('lines-import-banner')).toHaveAttribute('data-kind', kind, { timeout: 4000 });
  }).toPass({ timeout: 120_000, intervals: [1500] });
}

// La línea elegida no queda puesta para las pruebas que siguen.
test.afterEach(async ({ request }) => {
  await request.put('/api/groups/prefs', { data: { line: 'all' } });
});

test('Lines: el aviso de importación dice en qué anda, se va solo al terminar y lo cerrado no vuelve', async ({ page, request }) => {
  test.setTimeout(300_000);
  const numberId = await seedLine(request);
  // La línea elegida se guarda por persona y la bandeja solo avisa de las importaciones de esa línea: se elige la de esta prueba.
  await request.put('/api/groups/prefs', { data: { line: numberId } });
  const ws = String((await sql('SELECT user_id FROM groups_numbers WHERE id = ?', [numberId]))[0]?.user_id ?? '');
  expect(ws).not.toBe('');
  // La importación real que arrancó al conectar el número falso termina enseguida: después se pisa con la de la prueba.
  await expect
    .poll(async () => String((await sql('SELECT status FROM groups_imports WHERE number_id = ?', [numberId]))[0]?.status ?? 'none'), { timeout: 30_000 })
    .toMatch(/^(done|error|none)$/);
  const im = (patch: Partial<Import>): Import => ({
    status: 'running',
    phase: 'messages',
    chatsTotal: 20,
    chatsDone: 7,
    messages: 140,
    error: '',
    startedAt: '2026-11-19T10:00:00.000Z',
    finishedAt: null,
    quietMs: 0,
    ...patch,
  });
  const set = (patch: Partial<Import>) => setImport(numberId, ws, im(patch));
  await set({});
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const banner = page.getByTestId('lines-import-banner');

  // Trayendo mensajes: avance con barra, y ya se puede cerrar.
  await showing(page, 'progress');
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '35');
  await expect(banner.getByRole('button', { name: 'Close this notice' })).toBeVisible();

  // Todos los chats contados y la importación sigue (fotos y miembros): ya no es "importando mensajes: 20 de 20" con la barra llena.
  await set({ phase: 'pictures', chatsDone: 20 });
  await showing(page, 'finishing');
  await expect(banner.getByRole('progressbar')).toHaveCount(0);
  await expect(banner).not.toContainText('20 of 20');

  // Terminó: lo dice y se va solo, sin tocar nada.
  await set({ status: 'done', phase: 'done', chatsDone: 20, finishedAt: new Date().toISOString() });
  await showing(page, 'done');
  await expect(banner).toContainText('20 chats');
  await expect(banner).toHaveCount(0, { timeout: 20_000 });
  // El servidor la sigue informando un rato: al recargar no vuelve.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.gr-rows')).toBeVisible({ timeout: 45_000 });
  await expect(banner).toHaveCount(0);

  // Otra importación de la misma línea avisa de nuevo. Está frenada (línea desconectada) con todo contado: lo dice.
  await set({ startedAt: '2026-11-19T11:00:00.000Z', phase: 'pictures', chatsDone: 20, error: 'not_connected' });
  await showing(page, 'paused');
  await expect(banner.getByRole('progressbar')).toHaveCount(0);
  await expect(banner).toContainText('paused');
  // Se cierra con el teclado.
  const close = banner.getByRole('button', { name: 'Close this notice' });
  await close.focus();
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(banner).toHaveCount(0);
  // Y queda cerrado al recargar aunque siga frenada.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.gr-rows')).toBeVisible({ timeout: 45_000 });
  await expect(banner).toHaveCount(0);

  // En el teléfono: una que no avanza hace rato, sin scroll lateral.
  await set({ startedAt: '2026-11-19T12:00:00.000Z', quietMs: 15 * 60_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(banner).toHaveAttribute('data-kind', 'stalled', { timeout: 45_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = await banner.getByRole('button', { name: 'Close this notice' }).boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(390);
});
