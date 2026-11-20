import { expect as baseExpect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { PHONE, check, setTheme, settle } from './responsive-audit';

/**
 * Vincular HubSpot en la celda de las tablas de Lines, contra el proveedor y
 * el HubSpot falsos: en Grupos, "Not linked" se vuelve un buscador de
 * empresas en la celda (sin modal), la lista sale entera debajo de la celda
 * (no la corta la tabla), Enter vincula, el panel del grupo dice lo mismo
 * después de recargar, "Unlink" desde el menú de la celda la quita y Esc
 * cancela. Lo mismo a 390 en la tarjeta, y en Contactos con un contacto de
 * HubSpot. Quien no ve una línea no ve la fila.
 *
 * Nombres, teléfonos y empresas son inventados.
 */

// Con `next dev` (fuera de CI) cada ruta se compila la primera vez que se pide: más margen.
const expect = baseExpect.configure({ timeout: process.env.CI ? 15_000 : 60_000 });
const uid = () => Math.random().toString(36).slice(2, 8);
const TOKEN = 'pat-na1-e2e-lines-table-hubspot-link';
const VIEW_STORE = 'zs-groups-view-v1';
/** Con SHOTS=<carpeta>, capturas para revisar a ojo. */
const SHOTS = process.env.SHOTS;

test.describe.configure({ mode: 'serial' });
test.setTimeout(process.env.CI ? 240_000 : 900_000);

interface NumberInfo {
  id: string;
  webhookPath: string;
}

async function fakeNumber(request: APIRequestContext, name: string): Promise<NumberInfo> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 15_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookPath: new URL(info.webhookUrl).pathname };
}

let jidSeq = 0;
const newJid = () => `1203637${String(Date.now()).slice(-8)}${++jidSeq}@g.us`;
const fakePhone = () => `54900${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;

/** El grupo `jid` recibe un mensaje en esa línea; devuelve el id de su chat. */
async function groupIn(request: APIRequestContext, n: NumberInfo, jid: string, name: string): Promise<string> {
  const res = await request.post(n.webhookPath, {
    data: { events: [{ type: 'message', chatId: jid, isGroup: true, chatName: name, fromMe: false, senderPhone: fakePhone(), senderName: 'Cliente de prueba', providerMessageId: `hl-${uid()}`, body: 'Hola' }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const found = (await (await request.get(`/api/groups/chats?kind=group&number=${n.id}&q=${encodeURIComponent(name)}`)).json()) as { rows: Array<{ id: string; name: string }> };
  const chat = found.rows.find((r) => r.name === name);
  expect(chat, `chat ${name}`).toBeTruthy();
  return chat!.id;
}

/** Un chat 1:1 con un mensaje entrante (la persona aparece en Contactos). */
async function dmIn(request: APIRequestContext, n: NumberInfo, phone: string, name: string) {
  const res = await request.post(n.webhookPath, {
    data: { events: [{ type: 'message', chatId: `${phone}@c.us`, isGroup: false, fromMe: false, senderPhone: phone, senderName: name, providerMessageId: `hl-${uid()}`, body: 'Hola' }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function connect(request: APIRequestContext) {
  await request.delete('/api/groups/hubspot');
  await request.post('/api/groups/hubspot/fake', { data: { rateLimit: 0 } });
  const res = await request.post('/api/groups/hubspot', { data: { token: TOKEN } });
  expect(res.ok(), await res.text()).toBe(true);
}

test.afterAll(async ({ request }) => {
  await request.put('/api/profile/look', { data: { look: 'current' } }).catch(() => null);
  await request.delete('/api/groups/hubspot').catch(() => null);
});

const groupRow = (page: Page, jid: string) => page.locator(`tr[data-group="${jid}"]`);

async function openList(page: Page, tag: string) {
  await page.request.get('/api/groups/table?tz=0', { timeout: 120_000 });
  await page.goto('/en/app/lines/list', { waitUntil: 'domcontentloaded' });
  await page.evaluate((key) => window.localStorage.removeItem(key), VIEW_STORE);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
  await expect(async () => {
    await page.getByRole('searchbox', { name: 'Search by name' }).fill(tag);
    await expect(page.locator('tbody tr').first()).toContainText(tag, { timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
}

/** La lista flotante entra entera en la ventana y nada la tapa (la tabla no la corta). */
async function fullyVisible(page: Page, pop: Locator) {
  const box = (await pop.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  const options = pop.getByRole('option');
  const n = await options.count();
  for (let i = 0; i < n; i++) {
    const on = await options.nth(i).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(hit && el.contains(hit));
    });
    expect(on, `opción ${i} a la vista`).toBe(true);
  }
}

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function as(browser: Browser, email: string): Promise<BrowserContext> {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  return ctx;
}

async function member(browser: Browser, name: string) {
  const email = `celda-${uid()}@lines-e2e.io`;
  const demo = await as(browser, 'session-demo');
  await demo.request.get('/api/teams/members');
  await demo.close();
  const ctx = await as(browser, email);
  const first = await ctx.request.get('/api/teams/members');
  expect(first.status(), await first.text()).toBeLessThan(500);
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  const team = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  await sql("UPDATE users SET name = ?, onboarded_at = datetime('now'), active_team_id = ? WHERE id = ?", [name, team, id]);
  await sql("INSERT OR REPLACE INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '*')", [team, id]);
  return { ctx, id };
}

test('Grupos: vincular la empresa en la celda, el panel dice lo mismo, desvincular y Esc', async ({ page, request, browser, baseURL }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 860 });
  const tag = uid();
  await connect(request);
  const companyId = `98${String(Date.now()).slice(-7)}`;
  const companyName = `Orbit Cargo ${tag}`;
  const created = await request.post('/api/groups/hubspot/fake', { data: { create: { id: companyId, properties: { name: companyName, domain: `orbit-${tag}.example` } } } });
  expect(created.ok(), await created.text()).toBe(true);
  const n = await fakeNumber(request, `Celda ${tag}`);
  const jid = newJid();
  const groupName = `Grupo celda ${tag}`;
  const chatId = await groupIn(request, n, jid, groupName);
  const otherJid = newJid();
  const otherName = `Grupo otro ${tag}`;
  await groupIn(request, n, otherJid, otherName);

  // La búsqueda de HubSpot compila en el primer pedido con `next dev`: se pide antes.
  await request.get(`/api/groups/hubspot/search?chat=${chatId}&type=company&q=orbit`, { timeout: 120_000 });
  await openList(page, tag);
  const row = groupRow(page, jid);
  const cell = row.getByTestId('groups-company');
  const trigger = cell.getByRole('button', { name: `Link a HubSpot company to ${groupName}` });
  await expect(trigger).toContainText('Not linked');

  // ---------- Clic: la celda es un buscador, sin modal ----------
  await trigger.click();
  const input = cell.getByRole('combobox', { name: 'Search companies in HubSpot' });
  await expect(input).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const pop = page.getByTestId('groups-company-pop');
  await expect(pop).toContainText('Type at least 2 letters');
  await input.fill(`orbit cargo ${tag}`);
  const option = pop.getByRole('option', { name: new RegExp(companyName) });
  await expect(option).toBeVisible();
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await fullyVisible(page, pop);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/link-1280-open.png` });
  // Nada encontrado: lo dice.
  await input.fill(`zzz-nada-${tag}`);
  await expect(pop).toContainText('No companies found');
  await input.fill(`orbit cargo ${tag}`);
  await expect(option).toBeVisible();

  // ---------- Enter vincula ----------
  const linkedRes = page.waitForResponse((r) => r.url().endsWith('/api/groups/hubspot/links') && r.request().method() === 'POST');
  await input.press('Enter');
  expect((await linkedRes).status()).toBe(200);
  const link = cell.getByRole('link', { name: `Open ${companyName} in HubSpot` });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', new RegExp(`/record/0-2/${companyId}$`));
  await expect(pop).toHaveCount(0);
  const links = (await (await request.get(`/api/groups/hubspot/links?chat=${chatId}`)).json()) as { links: Array<{ type: string; id: string }> };
  expect(links.links).toContainEqual(expect.objectContaining({ type: 'company', id: companyId }));

  // Después de recargar sigue, y el panel del grupo dice lo mismo.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.getByRole('searchbox', { name: 'Search by name' }).fill(tag);
  await expect(groupRow(page, jid).getByRole('link', { name: `Open ${companyName} in HubSpot` })).toBeVisible();
  await page.goto(`/en/app/lines/list/${chatId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'HubSpot', exact: true }).getByRole('link', { name: `Open ${companyName} in HubSpot`, exact: true })).toBeVisible({ timeout: process.env.CI ? 30_000 : 120_000 });

  // ---------- Unlink desde el menú de la celda ----------
  await openList(page, tag);
  const menuBtn = groupRow(page, jid).getByRole('button', { name: `HubSpot company of ${groupName}` });
  await menuBtn.click();
  const menu = page.getByRole('menu', { name: `HubSpot company of ${groupName}` });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Change' })).toBeFocused();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/link-1280-menu.png` });
  // Esc cierra el menú y deja el foco en su botón.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(menuBtn).toBeFocused();
  await menuBtn.click();
  const unlinkRes = page.waitForResponse((r) => r.url().includes('/api/groups/hubspot/links?') && r.request().method() === 'DELETE');
  await page.getByRole('menuitem', { name: 'Unlink' }).click();
  expect((await unlinkRes).status()).toBe(200);
  await expect(groupRow(page, jid).getByRole('button', { name: `Link a HubSpot company to ${groupName}` })).toBeVisible();
  const after = (await (await request.get(`/api/groups/hubspot/links?chat=${chatId}`)).json()) as { links: Array<{ type: string }> };
  expect(after.links.some((l) => l.type === 'company')).toBe(false);

  // ---------- Esc cancela (sin vincular nada) y un clic afuera también ----------
  const other = groupRow(page, otherJid);
  await other.getByRole('button', { name: `Link a HubSpot company to ${otherName}` }).click();
  const otherInput = other.getByRole('combobox', { name: 'Search companies in HubSpot' });
  await otherInput.fill(`orbit cargo ${tag}`);
  await expect(page.getByTestId('groups-company-pop').getByRole('option').first()).toBeVisible();
  await otherInput.press('Escape');
  await expect(otherInput).toHaveCount(0);
  await expect(page.getByTestId('groups-company-pop')).toHaveCount(0);
  await expect(other.getByRole('button', { name: `Link a HubSpot company to ${otherName}` })).toBeFocused();
  await other.getByRole('button', { name: `Link a HubSpot company to ${otherName}` }).click();
  await expect(page.getByTestId('groups-company-pop')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search by name' }).click();
  await expect(page.getByTestId('groups-company-pop')).toHaveCount(0);
  await expect(other.getByTestId('groups-company').getByRole('link')).toHaveCount(0);

  // ---------- Capturas: actual claro y retro oscuro ----------
  if (SHOTS) {
    for (const [look, theme] of [
      ['current', 'light'],
      ['retro', 'dark'],
    ] as const) {
      expect((await request.put('/api/profile/look', { data: { look } })).ok()).toBe(true);
      await setTheme(page.context(), baseURL!, theme);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await settle(page);
      await page.getByRole('searchbox', { name: 'Search by name' }).fill(tag);
      await other.getByRole('button', { name: `Link a HubSpot company to ${otherName}` }).click();
      await other.getByRole('combobox').fill(`orbit cargo ${tag}`);
      await expect(page.getByTestId('groups-company-pop').getByRole('option').first()).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/link-1280-${look}-${theme}.png` });
      await page.keyboard.press('Escape');
    }
    await request.put('/api/profile/look', { data: { look: 'current' } });
    await setTheme(page.context(), baseURL!, 'light');
  }

  // ---------- 390: la tarjeta, el mismo buscador ----------
  const phone = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  try {
    const mobile = await phone.newPage();
    const looks = SHOTS
      ? ([
          ['current', 'light'],
          ['retro', 'dark'],
        ] as const)
      : ([['current', 'light']] as const);
    for (const [look, theme] of looks) {
      expect((await request.put('/api/profile/look', { data: { look } })).ok()).toBe(true);
      await setTheme(phone, baseURL!, theme);
      await mobile.goto('/en/app/lines/list', { waitUntil: 'domcontentloaded' });
      await settle(mobile);
      await mobile.evaluate((key) => window.localStorage.removeItem(key), VIEW_STORE);
      await mobile.reload({ waitUntil: 'domcontentloaded' });
      await settle(mobile);
      await mobile.getByRole('searchbox', { name: 'Search by name' }).fill(tag);
      const mrow = groupRow(mobile, jid);
      await expect(mrow).toBeVisible();
      await check(mobile, `lines celda hubspot 390 ${look} ${theme}`);
      await mrow.getByRole('button', { name: `Link a HubSpot company to ${groupName}` }).click();
      const minput = mrow.getByRole('combobox', { name: 'Search companies in HubSpot' });
      await minput.fill(`orbit cargo ${tag}`);
      const mpop = mobile.getByTestId('groups-company-pop');
      await expect(mpop.getByRole('option', { name: new RegExp(companyName) })).toBeVisible();
      await expect(mobile.getByRole('dialog')).toHaveCount(0);
      await fullyVisible(mobile, mpop);
      if (SHOTS) await mobile.screenshot({ path: `${SHOTS}/link-390-${look}-${theme}.png` });
      if (look === 'current') {
        await mpop.getByRole('option', { name: new RegExp(companyName) }).tap();
        await expect(mrow.getByRole('link', { name: `Open ${companyName} in HubSpot` })).toBeVisible();
        const scroll = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(scroll).toBeLessThanOrEqual(1);
        // Se desvincula igual desde la tarjeta.
        await mrow.getByRole('button', { name: `HubSpot company of ${groupName}` }).tap();
        await mobile.getByRole('menuitem', { name: 'Unlink' }).tap();
        await expect(mrow.getByRole('button', { name: `Link a HubSpot company to ${groupName}` })).toBeVisible();
      } else {
        await minput.press('Escape');
      }
    }
    await request.put('/api/profile/look', { data: { look: 'current' } });
  } finally {
    await phone.close();
  }
  expect(errors).toEqual([]);
});

test('Contactos: vincular el contacto de HubSpot en la celda y desvincularlo', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 860 });
  const tag = uid();
  await connect(request);
  const n = await fakeNumber(request, `Contactos celda ${tag}`);
  const personName = `Persona celda ${tag}`;
  await dmIn(request, n, fakePhone(), personName);

  await page.goto('/en/app/lines/contacts', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await expect(async () => {
    // Hasta que la página hidrata el buscador no filtra: se reintenta hasta que queda solo esta persona.
    await page.getByTestId('contacts-search').fill(tag);
    await baseExpect(page.getByTestId('contact-row')).toHaveCount(1, { timeout: 3_000 });
    await baseExpect(page.getByTestId('contact-row').first()).toContainText(personName, { timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
  const row = page.getByTestId('contact-row').filter({ hasText: personName });
  const cell = row.getByTestId('contacts-hubspot');
  await cell.getByRole('button', { name: `Link a HubSpot contact to ${personName}` }).click();
  const input = cell.getByRole('combobox', { name: 'Search contacts in HubSpot' });
  await expect(input).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // El contacto del HubSpot falso de Globex (por el dominio de su email).
  await input.fill('globex');
  const pop = page.getByTestId('contacts-hubspot-pop');
  await expect(pop.getByRole('option')).toHaveCount(1);
  await fullyVisible(page, pop);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/contacts-1280-open.png` });
  await input.press('ArrowDown');
  await input.press('Enter');
  const link = cell.getByRole('link');
  await expect(link).toHaveAttribute('href', /\/record\/0-1\/7002$/);
  // La empresa del contacto también.
  await expect(cell).toContainText('Globex Retail');

  // Después de recargar, la ficha dice lo mismo.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.getByTestId('contacts-search').fill(tag);
  await expect(row.getByTestId('contacts-hubspot').getByRole('link')).toHaveAttribute('href', /\/record\/0-1\/7002$/);
  await row.getByTestId('contact-open').click();
  await expect(page.getByTestId('contact-hs-contact')).toHaveAttribute('href', /\/record\/0-1\/7002$/);
  await page.getByTestId('contact-close').click();

  // Desvincular desde el menú de la celda.
  await row.getByRole('button', { name: `HubSpot contact of ${personName}` }).click();
  await page.getByRole('menuitem', { name: 'Unlink' }).click();
  await expect(row.getByRole('button', { name: `Link a HubSpot contact to ${personName}` })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.getByTestId('contacts-search').fill(tag);
  await expect(row.getByRole('button', { name: `Link a HubSpot contact to ${personName}` })).toBeVisible();
  expect(errors).toEqual([]);
});

test('quien no ve una línea no ve la fila (ni su celda de HubSpot)', async ({ browser, request }) => {
  const tag = uid();
  await connect(request);
  const open = await fakeNumber(request, `Abierta celda ${tag}`);
  const closed = await fakeNumber(request, `Reservada celda ${tag}`);
  const seen = newJid();
  const hidden = newJid();
  await groupIn(request, open, seen, `Visible celda ${tag}`);
  await groupIn(request, closed, hidden, `Oculto celda ${tag}`);
  const restricted = await request.patch(`/api/groups/numbers/${closed.id}`, { data: { visibility: 'restricted' } });
  expect(restricted.ok(), await restricted.text()).toBe(true);
  const someone = await member(browser, `Persona equipo ${tag}`);
  try {
    const p = await someone.ctx.newPage();
    await p.goto('/en/app/lines/list', { waitUntil: 'domcontentloaded' });
    await expect(async () => {
      await p.getByRole('searchbox', { name: 'Search by name' }).fill(tag);
      await expect(p.locator(`tr[data-group="${seen}"]`)).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await expect(p.locator(`tr[data-group="${hidden}"]`)).toHaveCount(0);
    // La fila que sí ve se vincula en la celda (es persona del equipo, no invitada).
    await expect(p.locator(`tr[data-group="${seen}"]`).getByTestId('groups-company-link')).toBeVisible();
  } finally {
    await someone.ctx.close();
  }
});
