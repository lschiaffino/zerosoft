import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * @menciones al escribir en un grupo de WhatsApp (Lines e Inbox), con el
 * WhatsApp falso (GROUPS_FAKE=1): "@" abre los participantes con avatar,
 * filtra, se elige con el teclado, la mención se ve en verde dentro del campo
 * y sale como mención real ("@<teléfono>" con la lista de mencionados). En la
 * burbuja vuelve como "@Nombre". Nombres y números inventados.
 * Con WA_MENTION_SHOTS=<carpeta> guarda capturas para la pasada visual.
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
const groupId = () => `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function shot(page: Page, name: string) {
  const dir = process.env.WA_MENTION_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
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

/** La capa de las menciones cae exactamente sobre el texto del campo: mismo ancho de renglón, mismo alto y mismo scroll. */
async function expectMirrorAligned(input: Locator) {
  const m = await input.evaluate((el) => {
    const ta = el as HTMLTextAreaElement;
    const mirror = ta.parentElement?.querySelector('.wa-input-mirror') as HTMLElement | null;
    if (!mirror) return null;
    const a = ta.getBoundingClientRect();
    const b = mirror.getBoundingClientRect();
    return {
      dx: Math.abs(a.left + ta.clientLeft - b.left),
      dy: Math.abs(a.top + ta.clientTop - b.top),
      dw: Math.abs(ta.clientWidth - b.width),
      dh: Math.abs(ta.scrollHeight - mirror.scrollHeight),
      ds: Math.abs(ta.scrollTop - mirror.scrollTop),
    };
  });
  expect(m).not.toBeNull();
  expect(m!.dx).toBeLessThan(1);
  expect(m!.dy).toBeLessThan(1);
  expect(m!.dw).toBeLessThan(1);
  expect(m!.dh).toBeLessThan(2);
  expect(m!.ds).toBeLessThan(1);
}

async function fakeLinesNumber(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Mentions ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const post = async (list: unknown[]) => {
    const res = await request.post(new URL(info.webhookUrl).pathname, { data: { events: list } });
    expect(res.ok(), await res.text()).toBe(true);
  };
  return { id, post };
}

test('Lines: @ en un grupo de WhatsApp elige a la persona, la pinta en verde y la manda como mención', async ({ page, request }) => {
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  const n = await fakeLinesNumber(request);
  const tag = uid();
  const eze = phone();
  const dani = phone();
  const gid = groupId();
  const title = `Obra ${tag}`;
  await n.post([{ type: 'fake_contacts', contacts: [{ phone: eze, name: `Ezequiel Sculli ${tag}`, groups: [gid] }, { phone: dani, name: `Dani Paz ${tag}`, groups: [gid] }] }]);
  await n.post([message(gid, { chatName: title, senderPhone: dani, senderName: `Dani Paz ${tag}`, body: 'Mañana arrancamos' })]);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: title }).click({ timeout: 90_000 });
  await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.wa-head-sub')).toContainText(`Ezequiel Sculli ${tag}`, { timeout: 20_000 });

  const input = page.getByRole('textbox', { name: 'WhatsApp' });
  await input.click();
  await input.pressSequentially('Hola @');
  const pop = page.getByRole('listbox', { name: 'Mention someone' });
  await expect(pop).toBeVisible();
  await expect(pop).toContainText(`Ezequiel Sculli ${tag}`);
  await expect(pop).toContainText(`Dani Paz ${tag}`);
  await expect(pop.locator('.wa-avatar').first()).toBeVisible();
  // Esc la cierra; seguir escribiendo filtra (nombre o apellido).
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await page.keyboard.press('Backspace');
  await input.pressSequentially('@scul');
  await expect(pop).toBeVisible();
  await expect(pop.getByRole('option')).toHaveCount(1);
  await expect(pop.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  // El teléfono con el formato de WhatsApp Web, como en la lista de miembros.
  await expect(pop).toContainText(`+54 9 11 ${eze.slice(5, 9)}-${eze.slice(9)}`);
  await shot(page, 'lines-picker-1280');
  await page.keyboard.press('Enter');
  await expect(pop).toBeHidden();
  await expect(input).toHaveValue(`Hola @Ezequiel Sculli ${tag} `);
  // En el campo: la mención en verde, alineada con el texto.
  const mark = page.locator('.wa-input-mirror .wa-input-mention');
  await expect(mark).toHaveText(`@Ezequiel Sculli ${tag}`);
  await expect(mark).toHaveCSS('color', 'rgb(0, 128, 105)');
  await expectMirrorAligned(input);

  // Borrar contra la mención la saca entera.
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(input).toHaveValue('Hola ');
  await expect(mark).toHaveCount(0);
  // Otra vez con el teclado (↓ y Tab), y texto largo que pasa a varios renglones y hace scroll.
  await input.pressSequentially('@');
  await expect(pop).toBeVisible();
  const order = await pop.getByRole('option').allTextContents();
  const target = order.findIndex((o) => o.includes(`Ezequiel Sculli ${tag}`));
  for (let i = 0; i < target; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(mark).toHaveText(`@Ezequiel Sculli ${tag}`);
  await input.pressSequentially('mirá esto que es largo para que el campo pase a varios renglones y la capa siga igual. ');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+Enter');
  await input.pressSequentially('fin');
  await expectMirrorAligned(input);
  await shot(page, 'lines-highlight-1280');

  // Sale como mención real: "@<teléfono>" en el texto y la lista de mencionados.
  const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/groups\/chats\/[^/]+\/messages$/.test(r.url()));
  await page.keyboard.press('Enter');
  const payload = (await sent).postDataJSON() as { body: string; mentions?: string[] };
  expect(payload.body.startsWith(`Hola @${eze} mirá esto`)).toBe(true);
  expect(payload.mentions).toEqual([eze]);
  await expect(input).toHaveValue('');
  // En la burbuja: "@Nombre", con estilo de mención, sin el teléfono.
  const bubble = page.locator('.gr-msg', { hasText: 'mirá esto' });
  await expect(bubble.locator('.wa-mention')).toHaveText(`@Ezequiel Sculli ${tag}`);
  await expect(bubble).not.toContainText(eze);
  // Guardado con la mención (como las que llegan de WhatsApp).
  await expect
    .poll(async () => String((await sql("SELECT meta FROM groups_messages WHERE number_id = ? AND direction = 'out' AND body LIKE ?", [n.id, `Hola @${eze}%`]))[0]?.meta ?? ''))
    .toContain(eze);
  expect(errors).toEqual([]);
});

test('Lines: en una nota interna la mención al equipo también se pinta, y en el teléfono la lista entra en la pantalla', async ({ page, request }) => {
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  const n = await fakeLinesNumber(request);
  const tag = uid();
  const gid = groupId();
  const title = `Equipo ${tag}`;
  await n.post([message(gid, { chatName: title, senderPhone: phone(), senderName: `Lu ${tag}`, body: 'hola' })]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: title }).click({ timeout: 90_000 });
  await page.getByRole('tab', { name: 'Internal note' }).click();
  const input = page.getByRole('textbox', { name: 'Internal note' });
  await input.click();
  await input.pressSequentially('Revisar con @');
  const pop = page.getByRole('listbox', { name: 'Mention someone' });
  await expect(pop).toBeVisible();
  const box = await pop.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Enter');
  await expect(page.locator('.wa-input-mirror .wa-input-mention')).toHaveCount(1);
  await expectMirrorAligned(input);
  await shot(page, 'lines-note-390');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('Inbox: la mención se pinta en el campo y sale como mención de WhatsApp', async ({ page, request }) => {
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const post = async (list: unknown[]) => {
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: list } });
    expect(res.ok()).toBe(true);
  };
  const tag = uid();
  const eze = phone();
  const gid = groupId();
  const title = `Consorcio ${tag}`;
  await post([{ type: 'fake_contacts', contacts: [{ phone: eze, name: `Ezequiel Sculli ${tag}`, groups: [gid] }] }]);
  await post([message(gid, { chatName: title, senderPhone: eze, senderName: `Ezequiel Sculli ${tag}`, body: 'Buenas' })]);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click({ timeout: 90_000 });
  const input = page.locator('.ib-wa-composer textarea.wa-input');
  // Con `next dev` la primera vez que se abre la conversación compila: si el pedido se corta, "Try again".
  await expect(async () => {
    const retry = page.getByRole('button', { name: 'Try again' });
    if (await retry.isVisible()) await retry.click();
    await expect(input).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 180_000 });
  await input.click();
  await input.pressSequentially('Gracias @ezeq');
  const pop = page.locator('.ib-wa-mentions');
  await expect(pop).toBeVisible({ timeout: 20_000 });
  await expect(pop).toContainText(`Ezequiel Sculli ${tag}`);
  await page.keyboard.press('Enter');
  const mark = page.locator('.wa-input-mirror .wa-input-mention');
  await expect(mark).toHaveText(`@Ezequiel Sculli ${tag}`);
  await expectMirrorAligned(input);
  await shot(page, 'inbox-highlight-1280');
  const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/inbox\/threads\/[^/]+\/messages$/.test(r.url()));
  await page.keyboard.press('Enter');
  const payload = (await sent).postDataJSON() as { body: string; mentions?: string[] };
  expect(payload.body).toBe(`Gracias @${eze}`);
  expect(payload.mentions).toEqual([eze]);
  await expect(page.locator('.ib-wa-thread .wa-mention', { hasText: `@Ezequiel Sculli ${tag}` }).last()).toBeVisible();
  expect(errors).toEqual([]);
});

test('Lines: un mensaje programado con mención en un grupo por lid sale como mención (por lid)', async ({ page, request }) => {
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  const n = await fakeLinesNumber(request);
  const tag = uid();
  const ana = phone();
  const lid = `1${Math.floor(1e13 + Math.random() * 8e13)}`;
  const gid = groupId();
  const title = `Programado ${tag}`;
  // Un grupo que WhatsApp direcciona por lid: Ana tiene teléfono y lid.
  await n.post([{ type: 'fake_contacts', contacts: [{ phone: ana, lid, name: `Ana Prueba ${tag}`, groups: [gid] }], lidGroups: [gid] }]);
  await n.post([message(gid, { chatName: title, senderPhone: ana, senderName: `Ana Prueba ${tag}`, body: 'hola' })]);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: title }).click({ timeout: 90_000 });
  await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.wa-head-sub')).toContainText(`Ana Prueba ${tag}`, { timeout: 20_000 });
  const input = page.getByRole('textbox', { name: 'WhatsApp' });
  await input.click();
  await input.pressSequentially('cómo estás @ana');
  const pop = page.getByRole('listbox', { name: 'Mention someone' });
  await expect(pop).toBeVisible();
  await page.keyboard.press('Enter');
  await input.pressSequentially('?');
  await expect(input).toHaveValue(`cómo estás @Ana Prueba ${tag} ?`);

  // Programar: el pedido lleva a quién es la mención.
  const created = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/groups\/broadcasts$/.test(r.url()));
  await page.getByTestId('lines-send-later').click();
  await page.getByRole('dialog', { name: 'Send later' }).locator('[data-preset="tomorrow"]').click();
  const body = (await created).postDataJSON() as { body: string; mentions?: Array<{ phone: string; label: string }> };
  expect(body.body).toBe(`cómo estás @Ana Prueba ${tag} ?`);
  expect(body.mentions).toEqual([{ phone: ana, label: `Ana Prueba ${tag}` }]);
  // En la tira de programados se lee con el nombre.
  const item = page.getByTestId('lines-scheduled-strip').getByTestId('lines-scheduled-item');
  await expect(item).toContainText(`@Ana Prueba ${tag}`);
  await item.getByRole('button', { name: 'Send now' }).click();

  // Sale como mención: guardado con "@<teléfono>" y la mención; al servidor (falso) le llegó el lid de Ana.
  await expect
    .poll(async () => (await sql("SELECT body, meta, provider_message_id FROM groups_messages WHERE number_id = ? AND direction = 'out'", [n.id]))[0] ?? null, { timeout: 30_000 })
    .not.toBeNull();
  const [out] = await sql("SELECT body, meta, provider_message_id FROM groups_messages WHERE number_id = ? AND direction = 'out'", [n.id]);
  expect(out.body).toBe(`cómo estás @${ana} ?`);
  expect(JSON.parse(String(out.meta)).mentions).toEqual([ana]);
  expect(String(out.provider_message_id).split('~')[1]).toBe(`${lid}@lid`);
  // En la burbuja: "@Nombre".
  const bubble = page.locator('.gr-msg', { hasText: 'cómo estás' });
  await expect(bubble.locator('.wa-mention')).toHaveText(`@Ana Prueba ${tag}`, { timeout: 20_000 });
  await expect(bubble).not.toContainText(ana);
  expect(errors).toEqual([]);
});

test('Inbox: un mensaje programado con mención en un grupo sale como mención', async ({ page, request }) => {
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const post = async (list: unknown[]) => {
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: list } });
    expect(res.ok()).toBe(true);
  };
  const tag = uid();
  const ana = phone();
  const gid = groupId();
  const title = `Programado ${tag}`;
  await post([{ type: 'fake_contacts', contacts: [{ phone: ana, name: `Ana Prueba ${tag}`, groups: [gid] }] }]);
  await post([message(gid, { chatName: title, senderPhone: ana, senderName: `Ana Prueba ${tag}`, body: 'hola' })]);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click({ timeout: 90_000 });
  const input = page.locator('.ib-wa-composer textarea.wa-input');
  await expect(async () => {
    const retry = page.getByRole('button', { name: 'Try again' });
    if (await retry.isVisible()) await retry.click();
    await expect(input).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 180_000 });
  await input.click();
  await input.pressSequentially('cómo estás @ana');
  await expect(page.locator('.ib-wa-mentions')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await input.pressSequentially('?');

  const created = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/inbox\/scheduled$/.test(r.url()));
  await page.getByTestId('inbox-send-later').click();
  await page.getByRole('dialog', { name: 'Send later' }).getByRole('button', { name: /Tomorrow morning/ }).click();
  const req = (await created).postDataJSON() as { parts: Array<{ body: string; mentions?: Array<{ phone: string; label: string }> }> };
  expect(req.parts[0]).toMatchObject({ body: `cómo estás @Ana Prueba ${tag} ?`, mentions: [{ phone: ana, label: `Ana Prueba ${tag}` }] });
  const list = page.locator('.ib-scheduled');
  await expect(list).toContainText(`@Ana Prueba ${tag}`);
  await list.getByRole('button', { name: 'Send now' }).click();

  // Guardado con "@<teléfono>" (el hilo muestra el nombre) y al servidor (falso) le llegó el JID completo de Ana.
  const sentRow = async () =>
    (await sql("SELECT m.body, m.external_id FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id WHERE t.external_id = ? AND m.from_me = 1", [gid]))[0] ?? null;
  await expect.poll(sentRow, { timeout: 30_000 }).not.toBeNull();
  const out = (await sentRow())!;
  expect(out.body).toBe(`cómo estás @${ana} ?`);
  expect(String(out.external_id).split('~')[1]).toBe(`${ana}@s.whatsapp.net`);
  await expect(page.locator('.ib-wa-thread .wa-mention', { hasText: `@Ana Prueba ${tag}` }).last()).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});
