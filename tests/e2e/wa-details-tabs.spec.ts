import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';
import { waLinkIp } from './helpers/wa-link';
import { ensureDetailsTab } from './helpers/details-tab';

/**
 * El panel de un chat en Lines y en Inbox con pestañas (components/groups/wa/DetailsTabs.tsx), como Periskope:
 * Info, Miembros (grupos), Archivos, Notas, Tareas, CRM y AI (Lines) o CRM y AI (Inbox). Se recorre con las
 * flechas, Inicio y Fin; la pestaña elegida queda guardada por persona; Esc cierra el panel; a 390 es una hoja a
 * pantalla completa sin desplazamiento lateral y con pestañas de 40px o más.
 * Cuenta propia: las notas y los ajustes no tocan a la cuenta demo compartida.
 *
 * Nombres, números y textos inventados.
 */

test.describe.configure({ timeout: 300_000 });

const email = ownWorkspace('wa-details-tabs');
const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
type Ev = Record<string, unknown>;

function groupEvents(title: string, tag: string): { gid: string; events: Ev[] } {
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const base = (o: Ev): Ev => ({ type: 'message', chatId: gid, isGroup: true, fromMe: false, senderPhone: phone(), senderName: `Beto ${tag}`, ...o });
  return {
    gid,
    events: [
      base({ chatName: title, providerMessageId: `t1-${tag}`, body: 'Hola equipo', timestamp: new Date(Date.now() - 120_000).toISOString() }),
      base({ providerMessageId: `t2-${tag}`, body: 'La receta: https://example.test/receta', timestamp: new Date(Date.now() - 60_000).toISOString() }),
    ],
  };
}
const dmEvents = (from: string, tag: string): Ev[] => [
  { type: 'message', chatId: `${from}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: from, senderName: `Paula ${tag}`, providerMessageId: `t3-${tag}`, body: 'Hola', timestamp: new Date().toISOString() },
];

async function seedLines(request: APIRequestContext, tag: string): Promise<{ group: string; dm: string }> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Pestañas ${tag}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
  const g = groupEvents(`Grupo ${tag}`, tag);
  const from = phone();
  for (const events of [g.events, dmEvents(from, tag)]) {
    const res = await request.post(new URL(webhookUrl).pathname, { data: { events } });
    expect(res.ok(), await res.text()).toBe(true);
  }
  const db = e2eDb();
  try {
    const id = async (jid: string) => String((await db.execute({ sql: 'SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', args: [numberId, jid] })).rows[0].id);
    return { group: await id(g.gid), dm: await id(`${from}@s.whatsapp.net`) };
  } finally {
    db.close();
  }
}

async function seedInbox(request: APIRequestContext, tag: string): Promise<{ group: string; dm: string }> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
  const db = e2eDb();
  try {
    const [acc] = (await db.execute({ sql: "SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = ?", args: [email] })).rows;
    const g = groupEvents(`Grupo ${tag}`, tag);
    const from = phone();
    for (const events of [g.events, dmEvents(from, tag)]) {
      const res = await request.post(`/api/inbox/webhook/${String(acc.id)}/${String(acc.webhook_secret)}`, { data: { events } });
      expect(res.ok(), await res.text()).toBe(true);
    }
    const id = async (jid: string) => String((await db.execute({ sql: 'SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', args: [String(acc.id), jid] })).rows[0].id);
    return { group: await id(g.gid), dm: await id(`${from}@s.whatsapp.net`) };
  } finally {
    db.close();
  }
}

const tabIds = (panel: Locator) => panel.locator('[role="tab"][data-details-tab]').evaluateAll((els) => els.map((el) => el.getAttribute('data-details-tab')));
const selected = (panel: Locator) => panel.locator('[role="tab"][aria-selected="true"]');

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}

/** Lo común a las dos apps: pestañas, teclado, guardado de la elegida, Esc y el ancho de 390. */
async function walk(page: Page, app: 'lines' | 'inbox', urls: { group: string; dm: string }, width: number, expected: { group: string[]; dm: string[] }) {
  const panelSel = app === 'lines' ? '.gr-details' : '.ib-wa-details';
  const open = async (url: string) => {
    await page.goto(url, { waitUntil: 'networkidle' });
    await expect(page.locator('.gr-msg').first()).toBeVisible({ timeout: 45_000 });
    // Hasta que la página hidrata, el clic en el encabezado todavía no abre nada: se reintenta.
    const panel = page.locator(panelSel);
    const head = page.locator(app === 'lines' ? '.gr-thread-head .wa-head-avatar' : '.ib-wa-thread .wa-head-who').first();
    await expect(async () => {
      if (!(await panel.getByRole('tablist').isVisible())) await head.click();
      await expect(panel.getByRole('tablist')).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    return panel;
  };

  let panel = await open(urls.group);
  expect(await tabIds(panel)).toEqual(expected.group);
  await expect(selected(panel)).toHaveAttribute('data-details-tab', 'info');
  // Tabs de 40px o más y, a 390, una hoja a pantalla completa.
  for (const box of await panel.getByRole('tab').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(40);
  if (width === 390) expect(Math.round((await panel.boundingBox())!.width)).toBe(390);
  await noSideScroll(page);

  // Teclado: foco itinerante con flechas, Inicio y Fin; Enter no hace falta (la flecha ya elige).
  await selected(panel).focus();
  await page.keyboard.press('ArrowRight');
  await expect(selected(panel)).toHaveAttribute('data-details-tab', 'members');
  await expect(panel.locator('[data-details-tab="members"]')).toBeFocused();
  await expect(panel.getByTestId(app === 'lines' ? 'lines-members-section' : 'inbox-members-section')).toBeVisible();
  await page.keyboard.press('End');
  await expect(selected(panel)).toHaveAttribute('data-details-tab', expected.group[expected.group.length - 1]);
  await page.keyboard.press('Home');
  await expect(selected(panel)).toHaveAttribute('data-details-tab', 'info');
  await page.keyboard.press('ArrowLeft');
  await expect(selected(panel)).toHaveAttribute('data-details-tab', expected.group[expected.group.length - 1]);

  // Archivos: lo compartido (el link del grupo) y los destacados.
  await panel.locator('[data-details-tab="media"]').click();
  const shared = panel.getByTestId('details-shared');
  await expect(shared).toBeVisible();
  await shared.getByRole('button', { name: 'Links', exact: true }).click();
  await expect(shared.getByRole('button', { name: 'Links', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(shared.getByRole('link', { name: /example\.test\/receta/ })).toBeVisible();
  await expect(panel.getByTestId('chat-starred')).toBeVisible();

  // Notas: queda elegida, también después de recargar.
  await panel.locator('[data-details-tab="notes"]').click();
  await expect(selected(panel)).toHaveAttribute('data-details-tab', 'notes');
  panel = await open(urls.group);
  await expect(selected(panel)).toHaveAttribute('data-details-tab', 'notes');

  // Esc cierra el panel (con el foco en las pestañas).
  await selected(panel).focus();
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('tablist')).toBeHidden();

  // Miembros elegida y un chat 1:1 (sin Miembros): abre en Info, con las pestañas del 1:1.
  panel = await open(urls.group);
  await panel.locator('[data-details-tab="members"]').click();
  panel = await open(urls.dm);
  expect(await tabIds(panel)).toEqual(expected.dm);
  await expect(selected(panel)).toHaveAttribute('data-details-tab', 'info');
  await noSideScroll(page);
}

for (const width of [1280, 390]) {
  test(`Lines: panel del chat con pestañas (${width}px)`, async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.setViewportSize({ width, height: 844 });
    const tag = uid();
    const chats = await seedLines(request, tag);
    const urls = { group: `/en/app/lines/inbox/${chats.group}`, dm: `/en/app/lines/inbox/${chats.dm}` };
    await walk(page, 'lines', urls, width, {
      group: ['info', 'members', 'media', 'notes', 'tasks', 'crm', 'ai'],
      dm: ['info', 'media', 'notes', 'tasks', 'crm', 'ai'],
    });

    // Notas internas: la que se escribe en el chat aparece en la pestaña, con su autor.
    const note = `Nota del equipo ${tag}`;
    expect((await request.post(`/api/groups/chats/${chats.dm}/messages`, { data: { body: note, note: true } })).ok()).toBe(true);
    await page.goto(urls.dm, { waitUntil: 'networkidle' });
    await ensureDetailsTab(page, 'notes', () => page.locator('.gr-thread-head .wa-head-avatar').first().click());
    const panel = page.locator('.gr-details');
    await expect(panel.getByTestId('details-note').filter({ hasText: note })).toBeVisible();
    // CRM: sin vínculo, el buscador para vincular un contacto o una empresa.
    await panel.locator('[data-details-tab="crm"]').click();
    await expect(panel.getByTestId('chat-crm')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`Inbox: panel del chat con pestañas (${width}px)`, async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.setViewportSize({ width, height: 844 });
    const tag = uid();
    const chats = await seedInbox(request, tag);
    const urls = { group: `/en/app/inbox?t=${chats.group}`, dm: `/en/app/inbox?t=${chats.dm}` };
    await walk(page, 'inbox', urls, width, { group: ['info', 'members', 'media', 'notes', 'crm', 'ai'], dm: ['info', 'media', 'notes', 'crm', 'ai'] });

    // Notas del chat (solo las ve quien es dueño de la bandeja): se guardan y vuelven.
    const panel = page.locator('.ib-wa-details');
    await panel.locator('[data-details-tab="notes"]').click();
    const notes = panel.getByRole('textbox', { name: 'Notes about this chat' });
    await notes.fill(`Prefiere que le escriban a la tarde ${tag}`);
    await panel.getByRole('button', { name: 'Save notes' }).click();
    await expect(panel.getByText('Saved')).toBeVisible();
    await page.goto(urls.dm, { waitUntil: 'networkidle' });
    await ensureDetailsTab(page, 'notes', () => page.locator('.ib-wa-thread .wa-head-who').first().click());
    await expect(page.locator('.ib-wa-details').getByRole('textbox', { name: 'Notes about this chat' })).toHaveValue(`Prefiere que le escriban a la tarde ${tag}`);
    // En la computadora, el botón Notas del encabezado abre esa pestaña.
    if (width === 1280) {
      await page.keyboard.press('Escape');
      await expect(page.locator('.ib-wa-details')).toHaveCount(0);
      await page.locator('.ib-wa-thread .gr-thread-actions').getByRole('button', { name: 'Notes' }).click();
      await expect(page.locator('.ib-wa-details [role="tab"][aria-selected="true"]')).toHaveAttribute('data-details-tab', 'notes');
    }
    expect(errors).toEqual([]);
  });
}
