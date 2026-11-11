import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Inbox con el WhatsApp falso (GROUPS_FAKE=1): nombres en lugar de números.
 * La libreta de la cuenta nombra un chat que abrí yo, los participantes de un
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

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string; owner: string }> {
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret, a.owner_id FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return { id: String(row.id), secret: String(row.webhook_secret), owner: String(row.owner_id) };
}

type Ev = Record<string, unknown>;

async function events(request: APIRequestContext, acc: { id: string; secret: string }, list: Ev[]) {
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, { data: { events: list } });
  expect(res.ok()).toBe(true);
}

function message(chatId: string, over: Ev = {}): Ev {
  const group = chatId.endsWith('@g.us');
  return {
    type: 'message',
    chatId,
    isGroup: group,
    fromMe: false,
    senderPhone: chatId.replace(/@.*/, ''),
    senderName: '',
    providerMessageId: `in-${uid()}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  };
}

async function openChat(page: Page, name: string) {
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('un chat que abrí yo sale con el nombre de la libreta, no con el número', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const tag = uid();
  const beto = phone();
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  // Beto escribe en un grupo (la libreta aprende su nombre de perfil); después le escribo yo por privado.
  await events(request, acc, [message(gid, { chatName: `Vecinos ${tag}`, senderPhone: beto, senderName: `Beto ${tag}`, body: 'llego tarde' })]);
  await events(request, acc, [message(`${beto}@s.whatsapp.net`, { fromMe: true, senderPhone: '', body: `hola ${tag}`, status: 'sent' })]);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('.ib-item', { hasText: `hola ${tag}` });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`Beto ${tag}`);
  await expect(row).not.toContainText(beto.slice(-4));
  expect(errors, errors.join('\n')).toEqual([]);
});

test('participantes del grupo con nombre y una mención por lid como "@Nombre"', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const tag = uid();
  const carla = phone();
  const carlaLid = lid();
  const dani = phone();
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const title = `Club ${tag}`;
  // En WhatsApp: Carla (con su lid) y Dani están en el grupo; ninguno escribió ni tiene chat conmigo.
  await events(request, acc, [
    {
      type: 'fake_contacts',
      contacts: [
        { phone: carla, lid: carlaLid, name: `Carla ${tag}`, groups: [gid] },
        { phone: dani, name: `Dani ${tag}`, groups: [gid] },
      ],
    },
  ]);
  // Un tercero menciona a Carla: WhatsApp escribe su lid en el texto.
  await events(request, acc, [
    message(gid, { chatName: title, senderPhone: phone(), senderName: `Eva ${tag}`, body: `@${carlaLid} traé las llaves`, mentions: [`${carlaLid}@lid`] }),
  ]);
  await openChat(page, title);
  const thread = page.locator('.ib-wa-thread');
  // Abrir un grupo sin datos pide su info al servidor antes de mostrarlo.
  await expect(thread.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 30_000 });
  // Cabecera: nombres, no teléfonos.
  const sub = thread.locator('.wa-head-sub');
  await expect(sub).toContainText(`Carla ${tag}`, { timeout: 20_000 });
  await expect(sub).toContainText(`Dani ${tag}`);
  await expect(sub).not.toContainText(carla.slice(-4));
  // La mención: "@Carla …" con estilo de mención, sin el lid.
  const bubble = thread.locator('.gr-msg', { hasText: 'traé las llaves' });
  await expect(bubble.locator('.wa-mention')).toHaveText(`@Carla ${tag}`);
  await expect(bubble).not.toContainText(carlaLid);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('repaso diario: el contacto que se cambió el nombre en WhatsApp', async ({ page, request }) => {
  // El cron de cada minuto hace de todo: puede tardar varias corridas en llegar al repaso.
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const tag = uid();
  const dario = phone();
  await events(request, acc, [message(`${dario}@s.whatsapp.net`, { senderName: `Dario ${tag}`, body: `buenas ${tag}` })]);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await expect(page.locator('.ib-item', { hasText: `Dario ${tag}` })).toBeVisible();
  // Se renombra en WhatsApp (la app no se entera) y toca el repaso de la cuenta.
  await events(request, acc, [{ type: 'fake_contacts', contacts: [{ phone: dario, name: `Dario Nuevo ${tag}` }] }]);
  await sql(
    "INSERT OR REPLACE INTO wa_contact_sync (app, account_id, user_id, phase, cursor, started_at, finished_at, claimed_until, updated_at) VALUES ('inbox', ?, ?, 'contacts', '', NULL, NULL, NULL, ?)",
    [acc.id, acc.owner, new Date(0).toISOString()],
  );
  await expect
    .poll(
      async () => {
        await request.get('/api/cron/minute', { headers: CRON });
        const [t] = await sql('SELECT title FROM inbox_threads WHERE account_id = ? AND handle = ?', [acc.id, dario]);
        return String(t?.title ?? '');
      },
      { timeout: 120_000, intervals: [1_000, 5_000] },
    )
    .toBe(`Dario Nuevo ${tag}`);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.ib-item', { hasText: `Dario Nuevo ${tag}` })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
