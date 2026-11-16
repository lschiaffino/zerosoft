import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Buscar un chat archivado, como WhatsApp: en los resultados de búsqueda la
 * fila del archivado lleva "Archivado" a la derecha; en la lista normal no
 * está, y uno sin archivar no lo lleva. Inbox y Lines, en escritorio (1280) y
 * en el teléfono (390), sin scroll de costado. WhatsApp falso; nombres y
 * números inventados.
 */

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

function message(chatId: string, body: string, senderName: string) {
  return {
    type: 'message',
    chatId,
    isGroup: false,
    fromMe: false,
    senderPhone: chatId.replace(/@.*/, ''),
    senderName,
    providerMessageId: `e2e-${uid()}`,
    body,
    timestamp: new Date().toISOString(),
  };
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

const SIZES = [
  { name: 'escritorio', width: 1280, height: 800 },
  { name: 'teléfono', width: 390, height: 844 },
];

for (const size of SIZES) {
  test.describe(`${size.name} (${size.width})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
    });

    test('Inbox: el archivado lleva "Archivado" solo en la búsqueda', async ({ page, request }, info) => {
      const errors = watchErrors(page);
      await request.post('/api/inbox/whatsapp');
      await expect
        .poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 })
        .toBe('connected');
      const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
      const tag = uid();
      const kept = { name: `Busco ${tag} Activa`, jid: `${phone()}@s.whatsapp.net` };
      const gone = { name: `Busco ${tag} Guardada`, jid: `${phone()}@s.whatsapp.net` };
      const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, {
        data: { events: [message(kept.jid, `hola ${tag}`, kept.name), message(gone.jid, `chau ${tag}`, gone.name)] },
      });
      expect(res.ok()).toBe(true);
      const [t] = await sql('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', [String(acc.id), gone.jid]);
      expect((await request.post('/api/inbox/threads', { data: { ids: [String(t.id)], action: 'done' } })).ok()).toBe(true);

      await page.goto('/es/app/inbox', { waitUntil: 'networkidle' });
      // En la lista normal el archivado no está y nadie lleva la marca.
      await expect(page.locator('.ib-item', { hasText: kept.name })).toBeVisible();
      await expect(page.locator('.ib-item', { hasText: gone.name })).toHaveCount(0);
      await expect(page.getByTestId('search-archived-tag')).toHaveCount(0);

      await page.locator('#ib-search').fill(`Busco ${tag}`);
      const goneRow = page.locator('.ib-item', { hasText: gone.name });
      const keptRow = page.locator('.ib-item', { hasText: kept.name });
      await expect(goneRow).toBeVisible();
      await expect(keptRow).toBeVisible();
      await expect(goneRow.getByTestId('search-archived-tag')).toHaveText('Archivado');
      await expect(keptRow.getByTestId('search-archived-tag')).toHaveCount(0);
      // A la derecha de la fila, dentro de ella.
      const row = (await goneRow.boundingBox())!;
      const tagBox = (await goneRow.getByTestId('search-archived-tag').boundingBox())!;
      expect(tagBox.x).toBeGreaterThan(row.x + row.width / 2);
      expect(tagBox.x + tagBox.width).toBeLessThanOrEqual(row.x + row.width + 1);
      await noSideScroll(page);
      await page.screenshot({ path: info.outputPath(`inbox-search-${size.width}.png`) });
      expect(errors, errors.join('\n')).toEqual([]);
    });

    test('Lines: el archivado lleva "Archivado" solo en la búsqueda', async ({ page, request }, info) => {
      const errors = watchErrors(page);
      const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Buscar ${uid()}` } });
      expect(created.ok()).toBe(true);
      const { id } = (await created.json()) as { id: string };
      await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
      await expect
        .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
        .toBe('connected');
      const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
      const tag = uid();
      const kept = { name: `Busco ${tag} Activa`, jid: `${phone()}@s.whatsapp.net` };
      const gone = { name: `Busco ${tag} Guardada`, jid: `${phone()}@s.whatsapp.net` };
      const send = async (r: APIRequestContext, list: unknown[]) => expect((await r.post(new URL(webhookUrl).pathname, { data: { events: list } })).ok()).toBe(true);
      await send(request, [message(kept.jid, `hola ${tag}`, kept.name), message(gone.jid, `chau ${tag}`, gone.name)]);
      // Archivado desde el teléfono.
      await send(request, [{ type: 'archive', chatId: gone.jid, archived: true }]);

      await page.goto('/es/app/lines/inbox', { waitUntil: 'networkidle' });
      const list = page.locator('.gr-rows');
      await expect(list.locator('.gr-row', { hasText: kept.name })).toBeVisible();
      await expect(list.locator('.gr-row', { hasText: gone.name })).toHaveCount(0);
      await expect(page.getByTestId('search-archived-tag')).toHaveCount(0);

      await page.locator('input.gr-search').fill(`Busco ${tag}`);
      const goneRow = list.locator('.gr-row', { hasText: gone.name }).first();
      const keptRow = list.locator('.gr-row', { hasText: kept.name }).first();
      await expect(goneRow).toBeVisible();
      await expect(keptRow).toBeVisible();
      await expect(goneRow.getByTestId('search-archived-tag')).toHaveText('Archivado');
      await expect(keptRow.getByTestId('search-archived-tag')).toHaveCount(0);
      const row = (await goneRow.boundingBox())!;
      const tagBox = (await goneRow.getByTestId('search-archived-tag').boundingBox())!;
      expect(tagBox.x).toBeGreaterThan(row.x + row.width / 2);
      expect(tagBox.x + tagBox.width).toBeLessThanOrEqual(row.x + row.width + 1);
      await noSideScroll(page);
      await page.screenshot({ path: info.outputPath(`lines-search-${size.width}.png`) });
      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
}
