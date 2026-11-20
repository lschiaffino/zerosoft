import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { PHONE, check, setTheme, settle } from './responsive-audit';

/**
 * Lines › Grupos y Contactos como una planilla, contra el proveedor y el
 * HubSpot falsos: la cabecera queda fija al bajar y alineada con las columnas
 * al correr de costado (con la casilla y el nombre fijos a la izquierda),
 * una propiedad de zerosoft y una de la empresa de HubSpot se editan en la
 * celda (Enter guarda, Esc cancela, Tab pasa a la siguiente) y siguen después
 * de recargar (la de HubSpot, en el HubSpot falso), una celda de solo lectura
 * no se edita, y quien no ve una línea no ve sus grupos.
 *
 * Nombres, teléfonos y empresas son inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const TOKEN = 'pat-na1-e2e-lines-table-grid';
const VIEW_STORE = 'zs-groups-view-v1';
/** Con SHOTS=<carpeta>, capturas para revisar a ojo (y con SHOTS_LOOKS=1, en los cinco aspectos). */
const SHOTS = process.env.SHOTS;
const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;
const ROWS = 28;

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

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
const newJid = () => `1203636${String(Date.now()).slice(-8)}${++jidSeq}@g.us`;
const fakePhone = (i: number) => `54900${String(Date.now()).slice(-5)}${String(i).padStart(3, '0')}`;

/** Varios grupos en una línea, en un solo pedido; cada uno con un mensaje de una persona distinta. Devuelve jid → chat. */
async function groupsIn(request: APIRequestContext, n: NumberInfo, groups: Array<{ jid: string; name: string; person: string }>): Promise<Map<string, string>> {
  const res = await request.post(n.webhookPath, {
    data: {
      events: groups.map((g, i) => ({
        type: 'message',
        chatId: g.jid,
        isGroup: true,
        chatName: g.name,
        fromMe: false,
        senderPhone: fakePhone(i),
        senderName: g.person,
        providerMessageId: `grid-${uid()}-${i}`,
        body: 'Hola',
      })),
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const out = new Map<string, string>();
  await expect(async () => {
    const found = (await (await request.get(`/api/groups/chats?kind=group&number=${n.id}&limit=200`)).json()) as { rows: Array<{ id: string; name: string }> };
    for (const g of groups) {
      const chat = found.rows.find((r) => r.name === g.name);
      expect(chat, g.name).toBeTruthy();
      out.set(g.jid, chat!.id);
    }
  }).toPass({ timeout: 20_000 });
  return out;
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

test.afterAll(async ({ request }) => {
  await request.delete('/api/groups/hubspot').catch(() => null);
  await request.put('/api/profile/look', { data: { look: 'current' } }).catch(() => null);
});

async function openList(page: Page, tag: string, columns: string[]) {
  await page.request.get('/api/groups/table?tz=0', { timeout: 120_000 });
  await page.goto('/en/app/lines/list', { waitUntil: 'networkidle' });
  await page.evaluate(([key, cols]) => window.localStorage.setItem(key, JSON.stringify({ columns: cols, sort: { col: 'name', dir: 'asc' }, status: [], filters: {} })), [VIEW_STORE, columns] as const);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(async () => {
    await page.getByRole('searchbox', { name: 'Search by name' }).fill(tag);
    await expect(page.locator('tbody tr').first()).toContainText(tag, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

const box = async (l: Locator) => (await l.boundingBox())!;

test('cabecera y nombre fijos, edición en la celda de zerosoft y de HubSpot, Esc, Tab y solo lectura', async ({ page, request, browser, baseURL }) => {
  const errors = watchErrors(page);
  const tag = uid();
  await page.setViewportSize({ width: 1280, height: 800 });
  const n = await fakeNumber(request, `Grilla ${tag}`);
  // Muchos grupos (para que la tabla scrollee); el primero en orden alfabético es el que se edita.
  const groups = Array.from({ length: ROWS }, (_, i) => ({ jid: newJid(), name: `Grilla ${String(i).padStart(2, '0')} ${tag}`, person: `Persona ${i} ${tag}` }));
  const chats = await groupsIn(request, n, groups);
  const first = groups[0];
  const second = groups[1];

  // HubSpot: una empresa propia del test, vinculada al primer grupo.
  const companyId = `96${String(Date.now()).slice(-7)}`;
  const created = await request.post('/api/groups/hubspot/fake', { data: { create: { id: companyId, properties: { name: `Orbit Grid ${tag}`, plan_tier: 'starter', city: 'Springfield' } } } });
  expect(created.ok(), await created.text()).toBe(true);
  await request.delete('/api/groups/hubspot');
  expect((await request.post('/api/groups/hubspot', { data: { token: TOKEN } })).ok()).toBe(true);
  expect((await request.get('/api/groups/hubspot/properties')).ok()).toBe(true);
  const linked = await request.post('/api/groups/hubspot/links', { data: { chatId: chats.get(first.jid), type: 'company', objectId: companyId } });
  expect(linked.ok(), await linked.text()).toBe(true);

  // Una propiedad de zerosoft de texto.
  const propLabel = `Notas ${tag}`;
  const prop = await request.post('/api/groups/properties', { data: { label: propLabel, type: 'text', scope: 'chat' } });
  expect(prop.ok(), await prop.text()).toBe(true);
  const def = (await prop.json()) as { id: string; key: string };

  const columns = [
    'lines',
    'members',
    'labels',
    'company',
    `prop:${def.key}`,
    'hs:plan_tier',
    'hs:city',
    'hs:domain',
    'hs:industry',
    'hs:numberofemployees',
    'hs:annualrevenue',
    'hs:seats_per_employee',
    'hs:lifecyclestage',
    'status',
    'activity',
    'created',
  ];
  try {
    await openList(page, tag, columns);
    await expect(page.locator('tbody tr')).toHaveCount(ROWS);
    const row = page.locator(`tr[data-group="${first.jid}"]`);
    // Los valores de la empresa y el esquema de HubSpot llegan después de la tabla.
    await expect(row.getByRole('button', { name: `Edit Plan for ${first.name}` })).toContainText('Starter', { timeout: 30_000 });
    const wrap = page.getByTestId('groups-table-wrap');

    // ---------- Cabecera fija al bajar ----------
    const wrapBox = await box(wrap);
    const nameHead = page.locator('thead th[data-col="name"]');
    expect(await wrap.evaluate((el) => el.scrollHeight > el.clientHeight + 200), 'la tabla scrollea en su caja').toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/grid-top.png` });
    await wrap.hover();
    await page.mouse.wheel(0, 600);
    await expect.poll(() => wrap.evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
    const headAfter = await box(nameHead);
    // Arriba de la caja y debajo de la banda de la app (48px), a la vista.
    expect(Math.abs(headAfter.y - wrapBox.y)).toBeLessThan(3);
    expect(headAfter.y).toBeGreaterThanOrEqual(48);
    await expect(nameHead).toBeInViewport();
    // Lo que se ve justo debajo de la cabecera es una fila, no la cabecera tapada.
    const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('thead, tbody')?.tagName ?? '', [headAfter.x + 20, headAfter.y + headAfter.height / 2] as const);
    expect(under).toBe('THEAD');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/grid-scrolled.png` });

    // ---------- De costado: cabecera alineada con las celdas, casilla y nombre fijos ----------
    expect(await wrap.evaluate((el) => el.scrollWidth > el.clientWidth + 100), 'la tabla corre de costado').toBe(true);
    const nameX = (await box(nameHead)).x;
    await wrap.evaluate((el) => (el.scrollLeft = 420));
    await expect.poll(() => wrap.evaluate((el) => el.scrollLeft)).toBeGreaterThan(300);
    const headers = await page.locator('thead th').evaluateAll((els) => els.map((e) => e.getAttribute('data-col')));
    for (const col of ['hs:city', 'hs:industry', 'status']) {
      const at = headers.indexOf(col);
      expect(at, col).toBeGreaterThan(1);
      const h = await box(page.locator('thead th').nth(at));
      const b = await box(page.locator('tbody tr').nth(8).locator('td').nth(at));
      expect(Math.abs(h.x - b.x), `${col} alineada`).toBeLessThan(1.5);
      expect(Math.abs(h.width - b.width), `${col} mismo ancho`).toBeLessThan(1.5);
    }
    expect(Math.abs((await box(nameHead)).x - nameX)).toBeLessThan(1.5);
    const bodyName = await box(page.locator('tbody tr').nth(8).locator('td').nth(1));
    expect(Math.abs(bodyName.x - nameX)).toBeLessThan(1.5);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/grid-sideways.png` });
    await wrap.evaluate((el) => {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    });

    // ---------- Propiedad de zerosoft: Esc cancela ----------
    const propCell = row.getByRole('button', { name: `Edit ${propLabel} for ${first.name}` });
    const propEditor = page.getByRole('dialog', { name: `Edit ${propLabel} for ${first.name}` });
    await propCell.click();
    await expect(propEditor).toBeVisible();
    await propEditor.getByLabel(propLabel).fill('No va');
    await page.keyboard.press('Escape');
    await expect(propEditor).toHaveCount(0);
    await expect(propCell).toBeFocused();
    await expect(propCell).not.toContainText('No va');

    // Enter guarda (optimista: se ve enseguida).
    await propCell.click();
    await propEditor.getByLabel(propLabel).fill(`Renueva en marzo ${tag}`);
    await page.keyboard.press('Enter');
    await expect(propEditor).toHaveCount(0);
    await expect(propCell).toContainText(`Renueva en marzo ${tag}`);
    await expect(propCell).toBeFocused();

    // Tab guarda y pasa a la celda siguiente (la columna Plan de HubSpot).
    const second2 = page.locator(`tr[data-group="${second.jid}"]`).getByRole('button', { name: `Edit ${propLabel} for ${second.name}` });
    await second2.click();
    await page.getByRole('dialog', { name: `Edit ${propLabel} for ${second.name}` }).getByLabel(propLabel).fill(`Segundo ${tag}`);
    await page.keyboard.press('Tab');
    await expect(second2).toContainText(`Segundo ${tag}`);
    const planAt = headers.indexOf('hs:plan_tier');
    await expect
      .poll(() => page.evaluate(() => (document.activeElement?.closest('td') as HTMLTableCellElement | null)?.cellIndex ?? -1))
      .toBe(planAt);

    // ---------- Flechas entre celdas ----------
    await propCell.focus();
    await page.keyboard.press('ArrowRight');
    await expect(row.getByRole('button', { name: `Edit Plan for ${first.name}` })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => (document.activeElement?.closest('tr') as HTMLElement | null)?.dataset.group ?? '')).toBe(second.jid);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    await expect(propCell).toBeFocused();

    // ---------- Propiedad de la empresa de HubSpot ----------
    const planCell = row.getByRole('button', { name: `Edit Plan for ${first.name}` });
    await expect(planCell).toContainText('Starter');
    await planCell.click();
    const planEditor = page.getByRole('dialog', { name: `Edit Plan for ${first.name}` });
    await planEditor.getByLabel('Value of Plan').selectOption('growth');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/grid-hs-editor.png` });
    await page.keyboard.press('Enter');
    await expect(planEditor).toHaveCount(0);
    await expect(planCell).toContainText('Growth');
    await expect
      .poll(async () => ((await (await request.get(`/api/groups/hubspot/fake?company=${companyId}`)).json()) as { properties: Record<string, string> }).properties.plan_tier)
      .toBe('growth');
    // Un valor que HubSpot rechaza vuelve atrás con un aviso.
    const sizeCell = row.getByRole('button', { name: `Edit Number of employees for ${first.name}` });
    await sizeCell.click();
    await page.getByRole('dialog', { name: `Edit Number of employees for ${first.name}` }).getByLabel('Value of Number of employees').fill('muchos');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ui-toast[data-tone="error"]')).toBeVisible();
    await expect(sizeCell).not.toContainText('muchos');

    // ---------- Solo lectura: no entra en edición y dice por qué ----------
    const members = row.locator('td').nth(headers.indexOf('members'));
    await members.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(members.getByRole('button')).toHaveCount(0);
    const calc = row.locator('td').nth(headers.indexOf('hs:seats_per_employee'));
    await expect(calc).toHaveAttribute('title', /Read only in HubSpot/);
    await calc.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Un grupo sin empresa: la columna de HubSpot explica cómo editarla.
    const unlinked = page.locator(`tr[data-group="${second.jid}"]`).locator('td').nth(planAt);
    await expect(unlinked).toHaveAttribute('title', /Link this group to a HubSpot company/);
    await unlinked.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/grid-edited.png` });

    // ---------- Después de recargar sigue todo ----------
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('searchbox', { name: 'Search by name' }).fill(tag);
    await expect(row.getByRole('button', { name: `Edit ${propLabel} for ${first.name}` })).toContainText(`Renueva en marzo ${tag}`);
    await expect(row.getByRole('button', { name: `Edit Plan for ${first.name}` })).toContainText('Growth');
    const saved = (await (await request.get(`/api/groups/chats/${chats.get(first.jid)}`)).json()) as { chat: { properties: Record<string, unknown> } };
    expect(saved.chat.properties[def.key]).toBe(`Renueva en marzo ${tag}`);

    // ---------- Aspectos (solo capturas locales) ----------
    if (SHOTS && process.env.SHOTS_LOOKS) {
      for (const look of LOOKS) {
        for (const theme of ['light', 'dark'] as const) {
          expect((await request.put('/api/profile/look', { data: { look } })).ok()).toBe(true);
          await setTheme(page.context(), baseURL!, theme);
          await page.reload({ waitUntil: 'networkidle' });
          await page.getByRole('searchbox', { name: 'Search by name' }).fill(tag);
          await expect(row).toBeVisible();
          await wrap.evaluate((el) => {
            el.scrollTop = 260;
            el.scrollLeft = 240;
          });
          await page.locator(`tr[data-group="${groups[9].jid}"]`).hover();
          await page.screenshot({ path: `${SHOTS}/grid-${look}-${theme}.png` });
        }
      }
      await request.put('/api/profile/look', { data: { look: 'current' } });
      await setTheme(page.context(), baseURL!, 'light');
    }

    // ---------- Teléfono, claro y oscuro: tarjetas, sin scroll lateral, se edita igual ----------
    const phone = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
    try {
      const mobile = await phone.newPage();
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(phone, baseURL!, theme);
        await mobile.goto('/en/app/lines/list', { waitUntil: 'domcontentloaded' });
        await settle(mobile);
        await mobile.evaluate(([key, cols]) => window.localStorage.setItem(key, JSON.stringify({ columns: cols, sort: { col: 'name', dir: 'asc' }, status: [], filters: {} })), [VIEW_STORE, columns] as const);
        await mobile.reload({ waitUntil: 'domcontentloaded' });
        await settle(mobile);
        await mobile.getByRole('searchbox', { name: 'Search by name' }).fill(tag);
        const mrow = mobile.locator(`tr[data-group="${first.jid}"]`);
        await expect(mrow).toBeVisible();
        await check(mobile, `lines grilla 390 ${theme}`);
        if (SHOTS) await mobile.screenshot({ path: `${SHOTS}/grid-390-${theme}.png` });
        await mrow.getByRole('button', { name: `Edit Plan for ${first.name}` }).click();
        await expect(mobile.getByRole('dialog', { name: `Edit Plan for ${first.name}` })).toBeVisible();
        await check(mobile, `lines grilla editor 390 ${theme}`);
        if (SHOTS) await mobile.screenshot({ path: `${SHOTS}/grid-390-editor-${theme}.png` });
        await mobile.keyboard.press('Escape');
        await expect(mobile.getByRole('dialog')).toHaveCount(0);
      }
    } finally {
      await phone.close();
    }
  } finally {
    await request.delete(`/api/groups/properties?id=${def.id}`);
    await page.evaluate((key) => window.localStorage.removeItem(key), VIEW_STORE).catch(() => null);
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Contactos: cabecera y nombre fijos al bajar', async ({ page, request }) => {
  const tag = uid();
  await page.setViewportSize({ width: 1280, height: 720 });
  const n = await fakeNumber(request, `Contactos grilla ${tag}`);
  const groups = Array.from({ length: ROWS }, (_, i) => ({ jid: newJid(), name: `Contacto grupo ${i} ${tag}`, person: `Contacto ${String(i).padStart(2, '0')} ${tag}` }));
  await groupsIn(request, n, groups);
  await page.goto('/en/app/lines/contacts', { waitUntil: 'networkidle' });
  await expect(async () => {
    await page.getByTestId('contacts-search').fill(tag);
    await expect(page.getByTestId('contact-row')).toHaveCount(ROWS, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  const wrap = page.getByTestId('contacts-table-wrap');
  const head = page.getByTestId('contacts-table').locator('thead th').first();
  const top = (await box(wrap)).y;
  expect(await wrap.evaluate((el) => el.scrollHeight > el.clientHeight + 200)).toBe(true);
  await wrap.hover();
  await page.mouse.wheel(0, 700);
  await expect.poll(() => wrap.evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
  const after = await box(head);
  expect(Math.abs(after.y - top)).toBeLessThan(3);
  await expect(head).toBeInViewport();
  // Las flechas pasan de una fila a la otra.
  const firstName = page.getByTestId('contact-open').first();
  await wrap.evaluate((el) => (el.scrollTop = 0));
  await firstName.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('contact-open').nth(1)).toBeFocused();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/grid-contacts.png` });
});

// ---------------------------------------------------------------------
// Una persona (member) sin acceso a una línea no ve sus grupos
// ---------------------------------------------------------------------

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
  const email = `grilla-${uid()}@lines-e2e.io`;
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

test('quien no ve una línea no ve sus grupos en la tabla', async ({ browser, request }) => {
  const tag = uid();
  const open = await fakeNumber(request, `Abierta ${tag}`);
  const closed = await fakeNumber(request, `Reservada ${tag}`);
  const seen = { jid: newJid(), name: `Visible ${tag}`, person: `Persona visible ${tag}` };
  const hidden = { jid: newJid(), name: `Oculto ${tag}`, person: `Persona oculta ${tag}` };
  await groupsIn(request, open, [seen]);
  await groupsIn(request, closed, [hidden]);
  const restricted = await request.patch(`/api/groups/numbers/${closed.id}`, { data: { visibility: 'restricted' } });
  expect(restricted.ok(), await restricted.text()).toBe(true);
  const ana = await member(browser, `Ana Grilla ${tag}`);
  try {
    const p = await ana.ctx.newPage();
    await p.goto('/en/app/lines/list', { waitUntil: 'networkidle' });
    await expect(async () => {
      await p.getByRole('searchbox', { name: 'Search by name' }).fill(tag);
      await expect(p.locator(`tr[data-group="${seen.jid}"]`)).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await expect(p.locator(`tr[data-group="${hidden.jid}"]`)).toHaveCount(0);
    await expect(p.locator('tbody tr')).toHaveCount(1);
    // Tampoco por la API de la tabla.
    const table = (await (await ana.ctx.request.get(`/api/groups/table?q=${encodeURIComponent(tag)}&tz=0`)).json()) as { rows: Array<{ key: string }> };
    expect(table.rows.map((r) => r.key)).toEqual([seen.jid]);
  } finally {
    await ana.ctx.close();
  }
});
