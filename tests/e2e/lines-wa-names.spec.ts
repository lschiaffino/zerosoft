import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines con el proveedor falso (GROUPS_FAKE=1): nombres en lugar de números.
 * La libreta del número nombra un chat que abrió el número, los miembros de un
 * grupo y las menciones por lid ("@<id anónimo>" → "@Nombre"), y el repaso
 * diario trae el nombre nuevo de un contacto que se renombró en WhatsApp.
 * Nombres y números inventados.
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
const lid = () => `${Math.floor(100_000_000_000_000 + Math.random() * 800_000_000_000_000)}`;
const CRON = { authorization: 'Bearer e2e-cron' };

interface NumberInfo {
  id: string;
  webhookUrl: string;
}

async function fakeNumber(request: APIRequestContext): Promise<NumberInfo> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Names ${uid()}` } });
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

function message(chatId: string, over: Record<string, unknown> = {}) {
  return {
    type: 'message',
    chatId,
    isGroup: chatId.endsWith('@g.us'),
    fromMe: false,
    senderPhone: chatId.replace(/@.*/, ''),
    senderName: '',
    providerMessageId: `e2e-${uid()}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
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

test('un chat que abrió el número sale con el nombre de la libreta, no con el número', async ({ page, request }) => {
  // Primera página de Lines de la corrida: con `next dev` compilarla puede tardar.
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const tag = uid();
  const beto = phone();
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  // Beto escribe en un grupo (la libreta aprende su nombre de perfil); después el número le escribe por privado.
  await events(request, n, [message(gid, { chatName: `Vecinos ${tag}`, senderPhone: beto, senderName: `Beto ${tag}`, body: 'llego tarde' })]);
  await events(request, n, [message(`${beto}@s.whatsapp.net`, { fromMe: true, senderPhone: '', body: `hola ${tag}`, status: 'sent' })]);
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('.gr-row', { hasText: `hola ${tag}` });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(`Beto ${tag}`);
  await expect(row).not.toContainText(`+${beto}`);
  expect(errors).toEqual([]);
});

test('miembros del grupo con nombre y una mención por lid como "@Nombre"', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const tag = uid();
  const carla = phone();
  const carlaLid = lid();
  const dani = phone();
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const title = `Club ${tag}`;
  // En WhatsApp: Carla y Dani están en el grupo; ninguno escribió. El servidor manda el contacto de Carla con su lid.
  await events(request, n, [
    {
      type: 'fake_contacts',
      contacts: [
        { phone: carla, lid: carlaLid, name: `Carla ${tag}`, groups: [gid] },
        { phone: dani, name: `Dani ${tag}`, groups: [gid] },
      ],
    },
    { type: 'contact', chatId: `${carlaLid}@lid`, name: `Carla ${tag}`, lid: carlaLid, phone: carla },
  ]);
  // Un tercero menciona a Carla: WhatsApp escribe su lid en el texto.
  await events(request, n, [message(gid, { chatName: title, senderPhone: phone(), senderName: `Eva ${tag}`, body: `@${carlaLid} traé las llaves`, mentions: [`${carlaLid}@lid`] })]);
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: title }).click({ timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 30_000 });
  // Cabecera: nombres de los miembros, no teléfonos.
  const sub = page.locator('.wa-head-sub');
  await expect(sub).toContainText(`Carla ${tag}`);
  await expect(sub).toContainText(`Dani ${tag}`);
  await expect(sub).not.toContainText(`+${carla}`);
  // La mención: "@Carla …" con estilo de mención, sin el lid.
  const bubble = page.locator('.gr-msg', { hasText: 'traé las llaves' });
  await expect(bubble.locator('.wa-mention')).toHaveText(`@Carla ${tag}`);
  await expect(bubble).not.toContainText(carlaLid);
  expect(errors).toEqual([]);
});

test('repaso diario: el contacto que se cambió el nombre en WhatsApp', async ({ page, request }) => {
  // El cron de cada minuto hace de todo: puede tardar varias corridas en llegar al repaso.
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const tag = uid();
  const dario = phone();
  await events(request, n, [message(`${dario}@s.whatsapp.net`, { senderName: `Dario ${tag}`, body: `buenas ${tag}` })]);
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await expect(page.locator('.gr-row', { hasText: `Dario ${tag}` })).toBeVisible({ timeout: 20_000 });
  // Se renombra en WhatsApp (la app no se entera) y toca el repaso del número.
  await events(request, n, [{ type: 'fake_contacts', contacts: [{ phone: dario, name: `Dario Nuevo ${tag}`, about: `De viaje ${tag}` }] }]);
  const [num] = await sql('SELECT user_id FROM groups_numbers WHERE id = ?', [n.id]);
  await sql(
    "INSERT OR REPLACE INTO wa_contact_sync (app, account_id, user_id, phase, cursor, started_at, finished_at, claimed_until, updated_at) VALUES ('lines', ?, ?, 'contacts', '', NULL, NULL, NULL, ?)",
    [n.id, String(num.user_id), new Date(0).toISOString()],
  );
  await expect
    .poll(
      async () => {
        await request.get('/api/cron/minute', { headers: CRON });
        const [c] = await sql("SELECT name FROM groups_chats WHERE number_id = ? AND phone = ? AND kind = 'dm'", [n.id, dario]);
        return String(c?.name ?? '');
      },
      { timeout: 150_000, intervals: [1_000, 5_000] },
    )
    .toBe(`Dario Nuevo ${tag}`);
  await page.reload({ waitUntil: 'networkidle' });
  const row = page.locator('.gr-row', { hasText: `Dario Nuevo ${tag}` });
  await expect(row).toBeVisible();
  // La "info" del contacto, en los detalles del chat.
  await row.click();
  await page.locator('.wa-head-avatar').click();
  await expect(page.locator('.wa-about')).toHaveText(`De viaje ${tag}`);
  expect(errors).toEqual([]);
});
