import { expect as baseExpect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { waLinkIp } from './helpers/wa-link';
import { PHONE, check, settle } from './responsive-audit';

/**
 * El panel de detalles de un chat (Lines) y la info del contacto (Inbox):
 * una sola escala de letra (valores, campos y botones del mismo tamaño) y
 * controles compactos (28 a 32px) a 1280, con HubSpot vinculado (el HubSpot
 * falso en memoria, GROUPS_INTEGRATIONS_FAKE). La sección CRM solo aparece con
 * la app CRM prendida para el workspace. Fuera de CI deja capturas en los
 * cinco aspectos, claro y oscuro, a 1280 y a 390 (SHOTS_DIR o la carpeta del test).
 */

const expect = baseExpect.configure({ timeout: process.env.CI ? 15_000 : 60_000 });
const uid = () => Math.random().toString(36).slice(2, 8);
const randomPhone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const TOKEN = 'pat-na1-e2e-chat-details-panel';
const PANEL_PHONE = '5491155550177';

test.describe.configure({ mode: 'serial' });
test.setTimeout(process.env.CI ? 240_000 : 900_000);

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function connect(request: APIRequestContext) {
  await request.delete('/api/groups/hubspot');
  await request.post('/api/groups/hubspot/fake', { data: { rateLimit: 0 } });
  const res = await request.post('/api/groups/hubspot', { data: { token: TOKEN } });
  expect(res.ok(), await res.text()).toBe(true);
  for (const type of ['company', 'contact', 'deal']) {
    await request.post('/api/groups/hubspot/properties', { data: { type, pinned: [] } });
    await request.post('/api/groups/hubspot/properties', { data: { type, mine: null } });
  }
}

async function linesChat(request: APIRequestContext): Promise<string> {
  const tag = uid();
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Panel ${tag}` } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const phone = randomPhone();
  const name = `Paula ${tag}`;
  const res = await request.post(new URL(webhookUrl).pathname, {
    data: { events: [{ type: 'message', chatId: `${phone}@c.us`, isGroup: false, fromMe: false, senderPhone: phone, senderName: name, providerMessageId: `cdp-${tag}`, body: 'Hola' }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const found = (await (await request.get(`/api/groups/chats?q=${encodeURIComponent(name)}`)).json()) as { rows: Array<{ id: string }> };
  expect(found.rows.length).toBeGreaterThan(0);
  const chat = found.rows[0].id;
  for (const [type, objectId] of [['company', '9001'], ['contact', '7001'], ['deal', '8001']]) {
    const linked = await request.post('/api/groups/hubspot/links', { data: { chatId: chat, type, objectId } });
    expect(linked.ok(), await linked.text()).toBe(true);
  }
  return chat;
}

async function inboxThread(request: APIRequestContext): Promise<string> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 60_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const tag = uid();
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, {
    data: { events: [{ type: 'message', chatId: `${PANEL_PHONE}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: PANEL_PHONE, senderName: `Pia ${tag}`, providerMessageId: `cdp-${tag}`, body: 'hola', timestamp: new Date().toISOString() }] },
  });
  expect(res.ok()).toBe(true);
  const [th] = await sql("SELECT id FROM inbox_threads WHERE account_id = ? AND handle = ? AND kind = 'dm'", [String(acc.id), PANEL_PHONE]);
  const who = (await (await request.get(`/api/inbox/people/person?thread=${th.id}`)).json()) as { row: { id: string; hubspot: { contact: { id: string } | null } | null } };
  if (who.row.hubspot?.contact?.id !== '7001') {
    const linked = await request.post('/api/inbox/people/person', { data: { id: who.row.id, action: 'link', contactId: '7001' } });
    expect(linked.ok(), await linked.text()).toBe(true);
  }
  return String(th.id);
}

const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;
type Look = (typeof LOOKS)[number];
async function setLook(request: APIRequestContext, look: Look) {
  const res = await request.put('/api/profile/look', { data: { look } });
  expect(res.ok(), await res.text()).toBe(true);
}
async function setCrm(request: APIRequestContext, mode: 'off' | 'all') {
  const res = await request.put('/api/teams/apps', { data: { app: 'crm', mode, people: [], teams: [], denied: [] } });
  expect(res.ok(), await res.text()).toBe(true);
}

const hubspotRegion = (page: Page) => page.getByRole('region', { name: 'HubSpot', exact: true });
const linesPanel = (page: Page) => page.locator('.gr-details');
const inboxCard = (page: Page) => page.getByTestId('inbox-chat-hubspot');
const inboxDetails = (page: Page) => page.locator('.ib-wa-details');

/** El aspecto y el tema en la página abierta (los dos son atributos de <html>), para las capturas. */
async function applyLook(page: Page, look: Look, theme: 'light' | 'dark') {
  await page.evaluate(
    ([l, t]) => {
      const html = document.documentElement;
      if (l === 'current') html.removeAttribute('data-look');
      else html.setAttribute('data-look', l);
      html.setAttribute('data-theme', t);
    },
    [look, theme],
  );
  await page.waitForTimeout(250);
}

async function openLines(page: Page, chat: string, mobile = false) {
  const url = `/en/app/lines/inbox/${chat}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await expect(async () => {
    if (!(await page.locator('.gr-thread-head').isVisible())) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await settle(page);
    }
    if (!(await hubspotRegion(page).isVisible())) {
      if (mobile) await page.locator('.gr-thread-head .wa-head-avatar').click();
      else await page.getByRole('button', { name: 'Details', exact: true }).click();
    }
    await baseExpect(hubspotRegion(page).getByTestId('hubspot-props-deal')).toBeVisible({ timeout: 5_000 });
  }).toPass();
}

async function openInbox(page: Page, thread: string) {
  const url = `/en/app/inbox?t=${thread}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await expect(async () => {
    // Con `next dev` una página puede quedar a medio cargar (el servidor se reinicia): se vuelve a pedir.
    if (!(await page.locator('.ib-wa-thread .wa-head-who').isVisible())) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await settle(page);
    }
    if (!(await inboxCard(page).isVisible())) await page.locator('.ib-wa-thread .wa-head-who').click({ timeout: 10_000 });
    await baseExpect(inboxCard(page).getByTestId('inbox-hs-deal')).toBeVisible({ timeout: 10_000 });
    await baseExpect(inboxCard(page).getByTestId('contact-hs-contact')).toBeVisible({ timeout: 10_000 });
  }).toPass();
}

/** Tamaño de letra y alto de cada control visible dentro de `root`. */
async function measure(root: Locator) {
  return root.evaluate((el) => {
    const px = (n: Element, p: 'fontSize' | 'height') => parseFloat(getComputedStyle(n)[p]);
    const visible = (n: Element) => (n as HTMLElement).offsetParent !== null && n.getBoundingClientRect().height > 0;
    const pick = (sel: string) => Array.from(el.querySelectorAll(sel)).filter(visible);
    const values = pick('.gr-hs-props dd').map((n) => px(n, 'fontSize'));
    const controls = pick('select, input:not([type="checkbox"]):not([type="radio"]), .btn').map((n) => ({
      what: `${n.tagName.toLowerCase()}.${(n.className || '').toString().split(' ').join('.')} "${(n.textContent || (n as HTMLInputElement).placeholder || '').trim().slice(0, 30)}"`,
      fontSize: px(n, 'fontSize'),
      height: n.getBoundingClientRect().height,
    }));
    return { values, controls };
  });
}

function expectOneScale(label: string, m: Awaited<ReturnType<typeof measure>>) {
  expect(m.values.length, `${label}: property values`).toBeGreaterThan(0);
  const base = m.values[0];
  for (const v of m.values) expect(Math.abs(v - base), `${label}: property value ${v}px vs ${base}px`).toBeLessThanOrEqual(1);
  expect(m.controls.length, `${label}: controls`).toBeGreaterThan(0);
  for (const c of m.controls) {
    expect(Math.abs(c.fontSize - base), `${label}: ${c.what} font ${c.fontSize}px vs values ${base}px`).toBeLessThanOrEqual(1);
    expect(c.height, `${label}: ${c.what} height`).toBeLessThanOrEqual(32);
  }
}

/** Capturas para la pasada visual, solo fuera de CI. */
async function shot(target: Locator, name: string) {
  if (process.env.CI) return;
  const dir = process.env.SHOTS_DIR;
  await target.screenshot({ path: dir ? `${dir}/${name}.png` : test.info().outputPath(`${name}.png`) });
}

test.afterAll(async ({ request }) => {
  await setLook(request, 'current').catch(() => null);
  await setCrm(request, 'all').catch(() => null);
  for (const type of ['company', 'contact', 'deal']) await request.post('/api/groups/hubspot/properties', { data: { type, mine: null } }).catch(() => null);
  await request.delete('/api/groups/hubspot').catch(() => null);
});

test('Lines e Inbox: el panel de detalles usa una escala de letra y controles compactos', async ({ page, request }) => {
  // Alto de sobra: el panel entero entra en la captura.
  await page.setViewportSize({ width: 1280, height: process.env.CI ? 900 : 2200 });
  await connect(request);
  const chat = await linesChat(request);
  const thread = await inboxThread(request);

  await openLines(page, chat);
  const lines = await measure(linesPanel(page));
  await openInbox(page, thread);
  const inbox = await measure(inboxCard(page));
  if (!process.env.CI) console.log(JSON.stringify({ lines, inbox }, null, 1));

  // Capturas: el aspecto y el tema se cambian en la página (son atributos de <html> y CSS), sin recargar.
  if (!process.env.CI) {
    const combos: Array<[Look, 'light' | 'dark']> = [
      ['current', 'light'],
      ['current', 'dark'],
      ['retro', 'light'],
      ['classic', 'light'],
      ['liquid', 'dark'],
      ['lines', 'light'],
    ];
    const shots = async (target: Locator, app: string) => {
      for (const [look, theme] of combos) {
        await applyLook(page, look, theme);
        await shot(target, `${app}-1280-${look}-${theme}`);
      }
      await applyLook(page, 'current', 'light');
    };
    await shots(inboxDetails(page), 'inbox');
    await openLines(page, chat);
    await shots(linesPanel(page), 'lines');
  }

  expectOneScale('lines', lines);
  expectOneScale('inbox', inbox);
});

test('Lines e Inbox a 390: el panel como hoja, sin desbordes', async ({ browser, request, baseURL }) => {
  await connect(request);
  const chat = await linesChat(request);
  const thread = await inboxThread(request);
  const phone = await browser.newContext({ baseURL, viewport: process.env.CI ? PHONE : { width: 390, height: 2200 }, hasTouch: true, isMobile: true });
  try {
    const page = await phone.newPage();
    await openLines(page, chat, true);
    await check(page, 'lines detalles 390', { ignore: /wa-head/ });
    for (const theme of ['light', 'dark'] as const) {
      await applyLook(page, 'current', theme);
      await shot(linesPanel(page), `lines-390-current-${theme}`);
    }
    await openInbox(page, thread);
    await check(page, 'inbox info 390', { ignore: /wa-head/ });
    for (const theme of ['light', 'dark'] as const) {
      await applyLook(page, 'current', theme);
      await shot(inboxDetails(page), `inbox-390-current-${theme}`);
    }
  } finally {
    await phone.close();
  }
});

test('Lines: la sección CRM solo con la app CRM prendida en el workspace', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await connect(request);
  const chat = await linesChat(request);
  try {
    await setCrm(request, 'off');
    await openLines(page, chat);
    await expect(linesPanel(page).getByTestId('chat-crm')).toHaveCount(0);
  } finally {
    await setCrm(request, 'all');
  }
  await openLines(page, chat);
  await expect(linesPanel(page).getByTestId('chat-crm')).toBeVisible();
});
