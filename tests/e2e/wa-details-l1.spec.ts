import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';
import { waLinkIp } from './helpers/wa-link';
import { ensureDetailsTab } from './helpers/details-tab';

/**
 * Pendientes del panel del chat (bloque L1), en Lines y en Inbox, a 1280 y 390:
 * - Lines, Notas: un chat que está en dos líneas junta las notas internas de las dos, cada una con su línea.
 * - Inbox, CRM: el CRM de zerosoft como en Lines. Sugiere el contacto con el mismo teléfono, lo vincula (link al
 *   contacto y sus negocios), busca y vincula una empresa (la lista se cierra con Esc y con un toque afuera) y
 *   desvincula.
 * - El chip de la AI ("Pulir", "Insertado · Deshacer") nunca tapa la conversación: queda afuera de la lista de
 *   mensajes y el último mensaje se ve entero.
 * Con L1_SHOTS=<carpeta> guarda capturas para la pasada visual. Cuenta propia; nombres, números y textos inventados.
 */

test.describe.configure({ timeout: 300_000 });

const email = ownWorkspace('wa-details-l1');
const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

async function shot(page: Page, name: string) {
  const dir = process.env.L1_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

const noSideScroll = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${new URL(res.url()).pathname}`);
  });
  return errors;
}

async function fakeLine(request: APIRequestContext, name: string): Promise<{ id: string; webhook: string }> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhook: new URL(webhookUrl).pathname };
}

const dm = (from: string, tag: string, body: string, n: number) => ({
  type: 'message',
  chatId: `${from}@s.whatsapp.net`,
  isGroup: false,
  fromMe: false,
  senderPhone: from,
  senderName: `Paula ${tag}`,
  providerMessageId: `l1-${tag}-${n}`,
  body,
  timestamp: new Date(Date.now() - (10 - n) * 60_000).toISOString(),
});

/** El mismo 1:1 por dos líneas (Ventas y Soporte): dos chats que la bandeja muestra como uno. */
async function linesOnTwoLines(request: APIRequestContext, tag: string) {
  const ventas = await fakeLine(request, `Ventas ${tag}`);
  const soporte = await fakeLine(request, `Soporte ${tag}`);
  const from = phone();
  for (const [i, l] of [ventas, soporte].entries()) {
    const res = await request.post(l.webhook, { data: { events: [dm(from, tag, i ? 'Escribo por soporte' : 'Escribo por ventas', i + 1)] } });
    expect(res.ok(), await res.text()).toBe(true);
  }
  const db = e2eDb();
  try {
    const id = async (numberId: string) =>
      String((await db.execute({ sql: 'SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', args: [numberId, `${from}@s.whatsapp.net`] })).rows[0].id);
    return { onVentas: await id(ventas.id), onSoporte: await id(soporte.id) };
  } finally {
    db.close();
  }
}

/** Un 1:1 de Inbox con varios mensajes (para que la conversación llene la pantalla). */
async function inboxDm(request: APIRequestContext, tag: string): Promise<{ id: string; from: string }> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
  const db = e2eDb();
  try {
    const [acc] = (await db.execute({ sql: "SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = ?", args: [email] })).rows;
    const from = phone();
    const events = Array.from({ length: 9 }, (_, i) => dm(from, tag, `Mensaje ${i + 1} de la charla de prueba`, i + 1));
    const res = await request.post(`/api/inbox/webhook/${String(acc.id)}/${String(acc.webhook_secret)}`, { data: { events } });
    expect(res.ok(), await res.text()).toBe(true);
    const id = String((await db.execute({ sql: 'SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', args: [String(acc.id), `${from}@s.whatsapp.net`] })).rows[0].id);
    return { id, from };
  } finally {
    db.close();
  }
}

async function openChat(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await expect(page.locator('.gr-msg').first()).toBeVisible({ timeout: 45_000 });
}

/** El chip de la AI está afuera de la lista de mensajes y el último mensaje se ve entero. */
async function chipClearOfMessages(page: Page, chip: Locator) {
  await expect(chip).toBeVisible();
  const box = await chip.boundingBox();
  const geo = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.wa-messages')!.getBoundingClientRect();
    const msgs = [...document.querySelectorAll<HTMLElement>('.wa-messages .gr-msg')];
    const last = msgs[msgs.length - 1]?.getBoundingClientRect();
    return { paneBottom: pane.bottom, lastBottom: last?.bottom ?? 0 };
  });
  expect(box!.y).toBeGreaterThanOrEqual(geo.paneBottom - 0.5);
  expect(geo.lastBottom).toBeLessThanOrEqual(geo.paneBottom + 0.5);
}

for (const width of [1280, 390]) {
  test(`Lines: la pestaña Notas junta las notas de las dos líneas (${width})`, async ({ page, request }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 844 });
    const tag = uid();
    const chats = await linesOnTwoLines(request, tag);
    for (const [id, body] of [
      [chats.onVentas, `Nota por ventas ${tag}`],
      [chats.onSoporte, `Nota por soporte ${tag}`],
    ]) {
      const res = await request.post(`/api/groups/chats/${id}/messages`, { data: { body, note: true } });
      expect(res.ok(), await res.text()).toBe(true);
    }
    await openChat(page, `/en/app/lines/inbox/${chats.onVentas}`);
    await ensureDetailsTab(page, 'notes', () => page.locator('.gr-thread-head .wa-head-avatar').first().click());
    const panel = page.locator('.gr-details');
    const ventas = panel.getByTestId('details-note').filter({ hasText: `Nota por ventas ${tag}` });
    const soporte = panel.getByTestId('details-note').filter({ hasText: `Nota por soporte ${tag}` });
    await expect(ventas).toBeVisible();
    await expect(soporte).toBeVisible();
    await expect(ventas.getByTestId('details-note-line')).toContainText(`Ventas ${tag}`);
    await expect(soporte.getByTestId('details-note-line')).toContainText(`Soporte ${tag}`);
    expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
    await shot(page, `lines-notes-two-lines-${width}`);
    // Una nota de la otra línea lleva a su mensaje en la conversación (que junta las dos líneas).
    await soporte.click();
    await expect(page.locator('.gr-msg.is-target')).toContainText(`Nota por soporte ${tag}`);
    expect(errors).toEqual([]);
  });

  test(`Inbox: la pestaña CRM vincula el CRM de zerosoft (${width})`, async ({ page, request }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 844 });
    const tag = uid();
    const chat = await inboxDm(request, tag);
    const contact = await request.post('/api/crm/contacts', { data: { firstName: 'Paula', lastName: `Demo ${tag}`, phone: `+${chat.from}` } });
    expect(contact.ok(), await contact.text()).toBe(true);
    const contactId = ((await contact.json()) as { id: string }).id;
    const pipelines = (await (await request.get('/api/crm/pipelines')).json()) as { rows: Array<{ id: string; stages: Array<{ id: string; is_won: number; is_lost: number }> }> };
    const p = pipelines.rows[0];
    const stage = p.stages.find((s) => !s.is_won && !s.is_lost)!;
    const deal = await request.post('/api/crm/deals', { data: { name: `Renovación ${tag}`, pipelineId: p.id, stageId: stage.id, amount: 1200, contactIds: [contactId] } });
    expect(deal.ok(), await deal.text()).toBe(true);
    const company = await request.post('/api/crm/companies', { data: { name: `Acme ${tag}` } });
    expect(company.ok(), await company.text()).toBe(true);

    await openChat(page, `/en/app/inbox?t=${chat.id}`);
    await ensureDetailsTab(page, 'crm', () => page.locator('.ib-wa-thread .wa-head-who').first().click());
    const panel = page.locator('.ib-wa-details');
    const crm = panel.getByTestId('inbox-crm');
    // El contacto con el mismo teléfono, sugerido; un toque lo vincula.
    const suggest = crm.getByTestId('inbox-crm-suggestions');
    await expect(suggest).toContainText(`Paula Demo ${tag}`);
    await suggest.getByRole('button', { name: 'Link' }).click();
    const linked = crm.getByTestId('inbox-crm-contact');
    await expect(linked.getByRole('link', { name: `Paula Demo ${tag}` })).toHaveAttribute('href', `/en/app/crm/contacts/${contactId}`);
    await expect(suggest).toHaveCount(0);
    await expect(panel.getByTestId('details-deals').getByRole('link', { name: `Renovación ${tag}` })).toBeVisible();

    // Buscar una empresa: la lista se cierra con Esc y con un toque afuera; después se elige.
    const search = crm.getByTestId('inbox-crm-search');
    const results = crm.getByTestId('inbox-crm-results');
    await search.fill(`Acme ${tag}`);
    await expect(results).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(results).toHaveCount(0);
    await search.fill(`Acme ${tag} `);
    await expect(results).toBeVisible();
    await panel.locator('.ib-wa-card-title').first().click();
    await expect(results).toHaveCount(0);
    await search.fill(`Acme ${tag}`);
    await results.getByRole('button', { name: new RegExp(`Acme ${tag}`) }).click();
    await expect(crm.getByTestId('inbox-crm-company').getByRole('link', { name: `Acme ${tag}` })).toBeVisible();
    // Con contacto y empresa vinculados no queda buscador.
    await expect(search).toHaveCount(0);
    expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
    for (const b of await crm.getByRole('button').all()) {
      if (width === 390) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    }
    await shot(page, `inbox-crm-${width}`);

    // Desvincular el contacto: vuelve la sugerencia y se recuerda al recargar.
    await linked.getByRole('button', { name: 'Remove' }).click();
    await expect(crm.getByTestId('inbox-crm-contact')).toHaveCount(0);
    await expect(suggest).toBeVisible();
    await page.reload({ waitUntil: 'networkidle' });
    await ensureDetailsTab(page, 'crm', () => page.locator('.ib-wa-thread .wa-head-who').first().click());
    await expect(page.locator('.ib-wa-details').getByTestId('inbox-crm-company')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`El chip de la AI no tapa la conversación, en Lines y en Inbox (${width})`, async ({ page, request }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 844 });
    const tag = uid();
    const long = Array.from({ length: 16 }, (_, i) => `palabra${i}`).join(' ');

    // Lines: "Pulir" va en la fila de las solapas.
    const lines = await linesOnTwoLines(request, tag);
    await openChat(page, `/en/app/lines/inbox/${lines.onVentas}`);
    await page.getByTestId('composer-input').fill(long);
    await chipClearOfMessages(page, page.getByTestId('ai-compose-polish'));
    await shot(page, `lines-chip-polish-${width}`);

    // Inbox: "Pulir" y, después de insertar un borrador, "Insertado · Deshacer", en su fila arriba del campo.
    const chat = await inboxDm(request, tag);
    await openChat(page, `/en/app/inbox?t=${chat.id}`);
    const field = page.getByTestId('composer-input');
    await field.fill(long);
    await chipClearOfMessages(page, page.getByTestId('ai-compose-polish'));
    await shot(page, `inbox-chip-polish-${width}`);
    await field.fill('');
    await expect(page.getByTestId('ai-compose-polish')).toHaveCount(0);
    if (width === 390) {
      // En el teléfono el lápiz va en el menú "+".
      await page.locator('.ib-wa-thread').getByRole('button', { name: 'Attach', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Help me write', exact: true }).click();
    } else {
      await page.getByTestId('ai-compose-open').click();
    }
    const bar = page.getByTestId('ai-compose');
    await bar.getByTestId('ai-compose-suggest').click();
    await expect(bar.getByTestId('ai-compose-draft')).not.toHaveAttribute('aria-busy', 'true');
    await bar.getByTestId('ai-compose-insert').click();
    await expect(bar).toBeHidden();
    await chipClearOfMessages(page, page.getByTestId('ai-compose-undo'));
    expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
    await shot(page, `inbox-chip-undo-${width}`);
    // Nada salió: el borrador quedó en el campo.
    await expect(field).not.toHaveValue('');
    expect(errors).toEqual([]);
  });
}
