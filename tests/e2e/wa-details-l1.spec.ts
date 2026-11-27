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
 * - El chip de la AI ("Pulir", "Insertado · Deshacer") flota sobre el borde del campo, sin cambiarle el alto al composer: queda afuera de la lista de
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

/** "Ayudame a escribir": en el teléfono el lápiz va en el menú "+"; en la computadora, en la fila del campo. */
async function openAiBar(page: Page, scope: string) {
  const narrow = (page.viewportSize()?.width ?? 1280) < 721;
  if (narrow) {
    await page.locator(scope).getByRole('button', { name: 'Attach', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Help me write', exact: true }).click();
  } else {
    await page.locator(scope).getByTestId('ai-compose-open').click();
  }
  await expect(page.getByTestId('ai-compose')).toBeVisible();
}

/** Alto del composer (la caja entera, con sus solapas). */
async function composerHeight(page: Page) {
  return Math.round((await page.locator('.wa-composer').first().boundingBox())!.height);
}

/** El chip flota: visible, clickeable, no cambia el alto del composer y no tapa Enviar ni el micrófono. */
async function chipFloats(page: Page, chip: Locator) {
  await expect(chip).toBeVisible();
  // Alto con el chip y con el chip escondido: el mismo (flota, no ocupa lugar).
  const withChip = await composerHeight(page);
  const hide = await page.addStyleTag({ content: '[data-testid^="ai-compose-"].aic-float { display: none !important; }' });
  const without = await composerHeight(page);
  await hide.evaluate((n) => n.remove());
  expect(withChip, 'el composer no cambia de alto con el chip').toBe(without);
  const box = (await chip.boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
  for (const sel of ['.wa-send', '.vc-bar']) {
    for (const el of await page.locator(`.wa-composer ${sel}`).all()) {
      const b = await el.boundingBox();
      if (!b) continue;
      const apart = box.x >= b.x + b.width || box.x + box.width <= b.x || box.y >= b.y + b.height || box.y + box.height <= b.y;
      expect(apart, `el chip no tapa ${sel}`).toBe(true);
    }
  }
  // Clickeable: el centro del chip es del chip (nada encima).
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid^="ai-compose-"]')?.getAttribute('data-testid') ?? null, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit).toMatch(/^ai-compose-(polish|undo)$/);
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
    // Un embudo con una etapa abierta (una cuenta nueva no tiene ninguno).
    const db = e2eDb();
    const [pipelineId, stageId] = [`pl_${tag}`, `st_${tag}`];
    try {
      const ws = String((await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] })).rows[0].id);
      await db.execute({ sql: "INSERT INTO crm_pipelines (id, user_id, name, position) VALUES (?, ?, 'Ventas', 0)", args: [pipelineId, ws] });
      await db.execute({ sql: "INSERT INTO crm_stages (id, pipeline_id, name, position) VALUES (?, ?, 'Propuesta', 0)", args: [stageId, pipelineId] });
    } finally {
      db.close();
    }
    const deal = await request.post('/api/crm/deals', { data: { name: `Renovación ${tag}`, pipelineId, stageId, amount: 1200, contactIds: [contactId] } });
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
    await suggest.getByTestId('inbox-crm-link').click();
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
    // Esc cierra solo la lista: el panel sigue abierto.
    await expect(crm).toBeVisible();
    await search.fill(`Acme ${tag} `);
    await expect(results).toBeVisible();
    await crm.locator('.ib-wa-card-title').first().click();
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
    await linked.getByTestId('inbox-crm-unlink').click();
    await expect(crm.getByTestId('inbox-crm-contact')).toHaveCount(0);
    await expect(suggest).toBeVisible();
    await page.reload({ waitUntil: 'networkidle' });
    await ensureDetailsTab(page, 'crm', () => page.locator('.ib-wa-thread .wa-head-who').first().click());
    await expect(page.locator('.ib-wa-details').getByTestId('inbox-crm-company')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`El chip de la AI flota sin cambiar el alto del composer, en Lines y en Inbox (${width})`, async ({ page, request }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 844 });
    const tag = uid();
    const long = Array.from({ length: 16 }, (_, i) => `palabra${i}`).join(' ');

    // Lines: "Pulir" e "Insertado · Deshacer" van en la fila de las solapas, sin pisarlas.
    const lines = await linesOnTwoLines(request, tag);
    await openChat(page, `/en/app/lines/inbox/${lines.onVentas}`);
    await page.getByTestId('composer-input').fill(long);
    await chipFloats(page, page.getByTestId('ai-compose-polish'));
    await shot(page, `lines-chip-polish-${width}`);
    await page.getByTestId('composer-input').fill('');
    await openAiBar(page, '.gr-inbox');
    await page.getByTestId('ai-compose').getByTestId('ai-compose-suggest').click();
    await expect(page.getByTestId('ai-compose-draft')).not.toHaveAttribute('aria-busy', 'true');
    await page.getByTestId('ai-compose-insert').click();
    const linesUndo = page.getByTestId('ai-compose-undo');
    await chipFloats(page, linesUndo);
    const chipBox = (await linesUndo.boundingBox())!;
    for (const tab of await page.locator('.wa-mode-tab').all()) {
      const b = (await tab.boundingBox())!;
      expect(chipBox.x >= b.x + b.width || chipBox.x + chipBox.width <= b.x, 'el chip no pisa las solapas').toBe(true);
    }
    expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
    await shot(page, `lines-chip-undo-${width}`);

    // Inbox: "Pulir" y, después de insertar un borrador, "Insertado · Deshacer", en su fila arriba del campo.
    const chat = await inboxDm(request, tag);
    await openChat(page, `/en/app/inbox?t=${chat.id}`);
    const field = page.getByTestId('composer-input');
    await field.fill(long);
    await chipFloats(page, page.getByTestId('ai-compose-polish'));
    await shot(page, `inbox-chip-polish-${width}`);
    await field.fill('');
    await expect(page.getByTestId('ai-compose-polish')).toHaveCount(0);
    await openAiBar(page, '.ib-wa-thread');
    const bar = page.getByTestId('ai-compose');
    await bar.getByTestId('ai-compose-suggest').click();
    await expect(bar.getByTestId('ai-compose-draft')).not.toHaveAttribute('aria-busy', 'true');
    await bar.getByTestId('ai-compose-insert').click();
    await expect(bar).toBeHidden();
    await chipFloats(page, page.getByTestId('ai-compose-undo'));
    expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
    await shot(page, `inbox-chip-undo-${width}`);
    // Nada salió: el borrador quedó en el campo.
    await expect(field).not.toHaveValue('');
    expect(errors).toEqual([]);
  });
}
