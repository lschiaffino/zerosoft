import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Timeline de la ficha, como el de HubSpot (bloque A2): pestañas con contador, filtro de tipos con menú
 * (Esc y clic afuera lo cierran), búsqueda, fijar arriba, actividad de asociados en la empresa con su
 * interruptor, crear una nota desde el botón de la pestaña, contraer y expandir todo, y la privacidad:
 * un miembro sin la línea de Lines no ve el chat vinculado ni el texto de la tarea que salió de él.
 * A 1280 y a 390 (sin scroll lateral). Textos inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

async function json<T>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

/** Empresa con un contacto, una nota propia de la empresa y una llamada del contacto (asociada). */
async function seed(request: APIRequestContext) {
  const tag = uid();
  const company = await json<{ id: string }>(request.post('/api/crm/companies', { data: { name: `Timeline Co ${tag}` } }));
  const contact = await json<{ id: string }>(
    request.post('/api/crm/contacts', { data: { firstName: 'Tina', lastName: `Line ${tag}`, email: `tl-${tag}@timeline-e2e.io`, companyId: company.id } }),
  );
  const note = `Company note ${tag}`;
  const call = `Contact call ${tag}`;
  const companyNote = await json<{ id: string }>(request.post('/api/crm/activities', { data: { type: 'note', body: note, companyId: company.id } }));
  await json(request.post('/api/crm/activities', { data: { type: 'call', subject: call, contactId: contact.id } }));
  return { tag, company, contact, note, call, companyNoteId: companyNote.id, path: `/en/app/crm/companies/${company.id}?tab=activity` };
}

const panel = (page: Page) => page.getByTestId('record-panel-activity');
const items = (page: Page) => panel(page).getByTestId('crm-timeline-item');

async function noSideScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'sin scroll lateral').toBeLessThanOrEqual(0);
}

for (const [name, viewport] of [
  ['1280', DESKTOP],
  ['390', PHONE],
] as const) {
  test.describe(`timeline de la ficha a ${name}`, () => {
    test.use({ viewport });

    test('pestañas, filtro de tipos, búsqueda, fijar, asociados y nota nueva', async ({ page, request }) => {
      test.setTimeout(120_000);
      const s = await seed(request);
      await page.goto(s.path, { waitUntil: 'networkidle' });
      await expect(items(page).filter({ hasText: s.note })).toBeVisible();
      // La llamada del contacto llega como actividad asociada, con su origen.
      const callCard = items(page).filter({ hasText: s.call });
      await expect(callCard).toHaveAttribute('data-rollup', 'true');
      await expect(callCard.getByTestId('timeline-item-from')).toBeVisible();
      await expect(panel(page).getByTestId('timeline-tab-all')).toContainText('2');
      await noSideScroll(page);

      // Pestaña Llamadas: solo la llamada.
      await panel(page).getByTestId('timeline-tab-call').click();
      await expect(items(page)).toHaveCount(1);
      await panel(page).getByTestId('timeline-tab-all').click();

      // Filtro de tipos: un menú que cierra con Esc y con un clic afuera.
      const filter = panel(page).getByTestId('timeline-filter');
      await filter.click();
      const menu = panel(page).getByTestId('timeline-filter-menu');
      await expect(menu).toBeVisible();
      await noSideScroll(page);
      const box = await menu.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      await menu.getByTestId('timeline-filter-note').click();
      await expect(menu.getByTestId('timeline-filter-note')).toHaveAttribute('aria-checked', 'false');
      await expect(items(page).filter({ hasText: s.note })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(filter).toBeFocused();
      await filter.click();
      await expect(menu).toBeVisible();
      await menu.getByTestId('timeline-filter-note').click();
      // Un toque afuera (en la página, fuera del menú y de su botón).
      await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
      await expect(menu).toHaveCount(0);
      await expect(items(page).filter({ hasText: s.note })).toBeVisible();

      // Actividad de asociados: se apaga y la llamada del contacto se va.
      await filter.click();
      await menu.getByTestId('timeline-associated').click();
      await page.keyboard.press('Escape');
      await expect(items(page).filter({ hasText: s.call })).toHaveCount(0);
      await expect(items(page).filter({ hasText: s.note })).toBeVisible();
      // Queda recordado al volver.
      await page.reload({ waitUntil: 'networkidle' });
      await expect(items(page).filter({ hasText: s.note })).toBeVisible();
      await expect(items(page).filter({ hasText: s.call })).toHaveCount(0);
      await panel(page).getByTestId('timeline-filter').click();
      await panel(page).getByTestId('timeline-filter-menu').getByTestId('timeline-associated').click();
      await page.keyboard.press('Escape');
      await expect(items(page).filter({ hasText: s.call })).toBeVisible();

      // Búsqueda dentro de la actividad.
      await panel(page).getByTestId('timeline-search').fill(`call ${s.tag}`);
      await expect(items(page)).toHaveCount(1);
      await panel(page).getByTestId('timeline-search').fill('zzz nothing here');
      await expect(panel(page).getByTestId('timeline-no-match')).toBeVisible();
      await panel(page).getByTestId('timeline-search').fill('');

      // Fijar la nota de la empresa: sube a "Fijada", arriba de todo.
      const noteCard = items(page).filter({ hasText: s.note });
      await noteCard.getByTestId('timeline-item-menu').click();
      await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
      await expect(noteCard.getByTestId('timeline-item-pinned')).toBeVisible();
      await expect(panel(page).locator('.atl-group').first()).toHaveAttribute('data-group', 'pinned');
      await expect(panel(page).locator('.atl-group').first().getByTestId('crm-timeline-item')).toContainText(s.note);
      // La llamada es de un contacto: desde la empresa no se fija.
      await callCard.getByTestId('timeline-item-menu').click();
      await expect(page.getByRole('menuitem', { name: 'Pin', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');

      // Contraer y expandir todo.
      await expect(noteCard.locator('.tl-body')).toBeVisible();
      await panel(page).getByTestId('timeline-collapse-all').click();
      await expect(noteCard.locator('.tl-body')).toHaveCount(0);
      await expect(noteCard.getByTestId('timeline-item-toggle')).toHaveAttribute('aria-expanded', 'false');
      await panel(page).getByTestId('timeline-collapse-all').click();
      await expect(noteCard.locator('.tl-body')).toBeVisible();

      // Nota nueva desde el botón de la pestaña Notas ("Create note", como en HubSpot).
      await panel(page).getByTestId('timeline-tab-note').click();
      await panel(page).getByTestId('timeline-create-note').click();
      const composer = panel(page).getByTestId('timeline-composer');
      await expect(composer).toHaveAttribute('data-kind', 'note');
      const fresh = `Fresh note ${s.tag}`;
      await composer.locator('textarea').fill(fresh);
      await composer.getByRole('button', { name: 'Save note' }).click();
      await expect(items(page).filter({ hasText: fresh })).toBeVisible();
      await expect(composer).toHaveCount(0);
      await noSideScroll(page);
    });
  });
}

async function teammate(browser: Browser, baseURL: string): Promise<{ ctx: BrowserContext; id: string }> {
  const email = `timeline-${uid()}@crm-timeline-e2e.io`;
  const ctx = await browser.newContext({ baseURL, viewport: DESKTOP });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  await ctx.request.get('/api/notes');
  const db = e2eDb();
  try {
    const team = (await db.execute("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1")).rows[0]?.id;
    expect(team).toBeTruthy();
    await db.execute({ sql: "INSERT OR IGNORE INTO team_members (team_id, user_id, role) SELECT ?, id, 'member' FROM users WHERE email = ?", args: [String(team), email] });
    await db.execute({ sql: "UPDATE users SET onboarded_at = datetime('now'), active_team_id = ? WHERE email = ?", args: [String(team), email] });
    const id = String((await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] })).rows[0]?.id ?? '');
    expect(id).toBeTruthy();
    return { ctx, id };
  } finally {
    db.close();
  }
}

test('privacidad: un miembro sin la línea no ve el chat vinculado ni el texto de su tarea en la empresa', async ({ browser, page, request, baseURL }) => {
  test.setTimeout(150_000);
  const s = await seed(request);
  const secret = `zqx${uid()}`;
  const task = await json<{ id: string }>(
    request.post('/api/crm/activities', { data: { type: 'task', subject: `Chat task ${secret}`, body: `Notes ${secret}`, contactId: s.contact.id } }),
  );
  // Una línea restringida (solo el dueño), un chat vinculado al contacto con un mensaje, y la tarea como salida de ese chat.
  const db = e2eDb();
  const numberId = `e2e-num-${uid()}`;
  const chatId = `e2e-chat-${uid()}`;
  try {
    await db.execute({
      sql: "INSERT INTO groups_numbers (id, user_id, name, provider, webhook_secret, visibility, owner_id) VALUES (?, 'demo', 'Private line', 'fake', ?, 'restricted', 'demo')",
      args: [numberId, uid()],
    });
    await db.execute({
      sql: "INSERT INTO groups_chats (id, user_id, number_id, provider_chat_id, kind, name, crm_contact_id, last_message_at) VALUES (?, 'demo', ?, ?, 'dm', ?, ?, datetime('now'))",
      args: [chatId, numberId, `${uid()}@c.us`, `Chat ${secret}`, s.contact.id],
    });
    await db.execute({
      sql: "INSERT INTO groups_messages (id, user_id, chat_id, number_id, direction, sender_name, body) VALUES (?, 'demo', ?, ?, 'in', 'Cliente', ?)",
      args: [`e2e-msg-${uid()}`, chatId, numberId, `Message ${secret}`],
    });
    await db.execute({
      sql: "INSERT INTO groups_tasks (id, user_id, chat_id, activity_id, created_by) VALUES (?, 'demo', ?, ?, 'demo')",
      args: [task.id, chatId, task.id],
    });
  } finally {
    db.close();
  }

  // El dueño ve la línea: el chat en la pestaña WhatsApp del contacto y la tarea con su texto en la empresa.
  await page.setViewportSize(DESKTOP);
  await page.goto(`/en/app/crm/contacts/${s.contact.id}?tab=activity`, { waitUntil: 'networkidle' });
  await panel(page).getByTestId('timeline-tab-whatsapp').click();
  await expect(items(page).filter({ hasText: `Message ${secret}` })).toBeVisible();
  await page.goto(s.path, { waitUntil: 'networkidle' });
  await expect(items(page).filter({ hasText: `Chat task ${secret}` })).toBeVisible();

  // El miembro no: ni la pestaña, ni el chat, ni el texto (en la página ni en "cargar más").
  const { ctx } = await teammate(browser, baseURL!);
  try {
    const p = await ctx.newPage();
    await p.goto(`/en/app/crm/contacts/${s.contact.id}?tab=activity`, { waitUntil: 'networkidle' });
    await expect(panel(p).getByTestId('timeline-search')).toBeVisible();
    await expect(panel(p).getByTestId('timeline-tab-whatsapp')).toHaveCount(0);
    expect(await p.content()).not.toContain(secret);
    await p.goto(s.path, { waitUntil: 'networkidle' });
    const hidden = items(p).filter({ has: p.getByTestId('crm-private-chat-task') });
    await expect(hidden).toHaveAttribute('data-rollup', 'true');
    expect(await p.content()).not.toContain(secret);
    const more = await ctx.request.get(`/api/crm/timeline?kind=company&id=${s.company.id}&offset=0`);
    expect(more.ok()).toBeTruthy();
    expect(await more.text()).not.toContain(secret);
    // Fijar desde la empresa una actividad de otro registro: 404.
    const pin = await ctx.request.post('/api/crm/timeline', { data: { activityId: task.id, kind: 'company', id: s.company.id, pinned: true } });
    expect(pin.status()).toBe(404);
  } finally {
    await ctx.close();
  }
});
