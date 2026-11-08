import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Groups, varias líneas y equipo (paridad con Periskope) contra el proveedor
 * falso: tabla de Líneas con color y acceso, el mismo grupo en dos líneas
 * listado una vez con "Responder desde" por API, filtro por línea, Equipo
 * (invitar, estado, acceso por línea), un miembro que solo ve su línea,
 * reglas de asignación por disponibilidad con historial y la importación
 * de Periskope. Nada sale a WhatsApp ni a internet.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

interface NumberInfo {
  id: string;
  name: string;
  webhookUrl: string;
}

async function fakeNumber(request: APIRequestContext, name = `Line ${uid()}`): Promise<NumberInfo> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, name, webhookUrl: info.webhookUrl };
}

async function events(request: APIRequestContext, n: NumberInfo, list: unknown[]) {
  const res = await request.post(new URL(n.webhookUrl).pathname, { data: { events: list } });
  expect(res.ok(), await res.text()).toBe(true);
}

const message = (chatId: string, body: string, id: string, chatName?: string) => ({
  type: 'message',
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  chatName: chatId.endsWith('@g.us') ? chatName : undefined,
  fromMe: false,
  senderPhone: '5491155550000',
  senderName: chatName ?? 'Ana',
  providerMessageId: id,
  body,
});

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function noHorizontalScroll(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
}

test('el mismo grupo en dos líneas: una fila, hilo junto, Responder desde y filtro por línea', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const a = await fakeNumber(request, `Ventas ${tag}`);
  const b = await fakeNumber(request, `Soporte ${tag}`);
  const gid = `120363${Date.now()}@g.us`;
  const name = `Clientes ${tag}`;
  await events(request, a, [message(gid, `hola ${tag}`, `ln-${tag}-1`, name)]);
  await events(request, b, [message(gid, `hola ${tag}`, `ln-${tag}-1`, name), message(gid, `segundo ${tag}`, `ln-${tag}-2`, name)]);

  const list = (await (await request.get(`/api/groups/chats?q=${encodeURIComponent(name)}`)).json()) as { rows: Array<{ id: string; lines?: Array<{ numberId: string }> }> };
  expect(list.rows).toHaveLength(1);
  expect(list.rows[0].lines?.map((l) => l.numberId).sort()).toEqual([a.id, b.id].sort());
  const chatId = list.rows[0].id;

  // Hilo: el mensaje que llegó por las dos líneas se ve una vez.
  const thread = (await (await request.get(`/api/groups/chats/${chatId}/messages`)).json()) as { messages: Array<{ body: string; direction: string }> };
  expect(thread.messages.filter((m) => m.body === `hola ${tag}`)).toHaveLength(1);
  expect(thread.messages.some((m) => m.body === `segundo ${tag}`)).toBe(true);

  // Responder desde: las dos líneas, y enviar por la otra.
  const lines = (await (await request.get(`/api/groups/lines?chat=${chatId}`)).json()) as { lines: Array<{ numberId: string; chatId: string; isDefault: boolean; canSend: boolean }> };
  expect(lines.lines).toHaveLength(2);
  const other = lines.lines.find((l) => !l.isDefault)!;
  const sent = await request.post(`/api/groups/chats/${chatId}/messages`, { data: { body: `desde la otra ${tag}`, numberId: other.numberId } });
  expect(sent.status()).toBe(201);
  const msg = (await sent.json()) as { chatId: string; numberId: string; authorName: string };
  expect(msg).toMatchObject({ chatId: other.chatId, numberId: other.numberId });
  expect(msg.authorName).toBeTruthy();

  // Filtro por línea en el panel de filtros.
  await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Filters and lists' }).click();
  const filter = page.getByLabel('Line', { exact: true });
  await expect(filter).toBeVisible();
  await filter.selectOption(a.id);
  await expect(page.locator('.gr-row', { hasText: name })).toBeVisible();
  // El thread muestra lo enviado por la otra línea.
  await page.locator('.gr-row', { hasText: name }).click();
  await expect(page.getByText(`desde la otra ${tag}`)).toBeVisible();
  // "Responder desde" en el composer: se elige la línea A y el mensaje sale por ahí.
  const from = page.getByLabel('Reply from');
  await expect(from).toBeVisible();
  await from.selectOption(a.id);
  const composer = page.getByLabel('WhatsApp', { exact: true });
  await composer.fill(`por la A ${tag}`);
  await composer.press('Enter');
  await expect(page.getByText(`por la A ${tag}`)).toBeVisible();
  await expect
    .poll(async () => {
      const r = (await (await request.get(`/api/groups/chats/${chatId}/messages`)).json()) as { messages: Array<{ body: string; numberId?: string }> };
      return r.messages.find((m) => m.body === `por la A ${tag}`)?.numberId;
    })
    .toBe(a.id);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Ajustes › Líneas: tabla con estado, color y quién ve cada línea; en oscuro y a 390px', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const a = await fakeNumber(request, `Color ${tag}`);
  await page.goto('/en/app/groups/settings?tab=numbers', { waitUntil: 'networkidle' });
  const row = page.locator('.gr-line-row', { hasText: a.name });
  await expect(row.getByText('Connected', { exact: true })).toBeVisible();
  // La fila es una fila de tabla: las celdas arrancan a la misma altura y las acciones de la última fila se ven.
  const tops = await row.locator('td').evaluateAll((tds) => tds.map((td) => Math.round(td.getBoundingClientRect().top)));
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
  await expect(page.locator('.gr-line-row').last().getByRole('button', { name: 'Delete' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Who sees it' })).toBeVisible();

  // Color.
  await row.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit number' });
  await edit.getByLabel('#9b51e0').check();
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  const lines = (await (await request.get('/api/groups/lines')).json()) as { lines: Array<{ id: string; color: string }> };
  expect(lines.lines.find((l) => l.id === a.id)?.color).toBe('#9b51e0');

  // Quién la ve.
  await row.locator('.gr-line-access').click();
  const dlg = page.getByRole('dialog', { name: `Who sees ${a.name}` });
  await dlg.getByRole('checkbox').first().check();
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(dlg).toBeHidden();
  await expect(row.locator('.gr-line-access')).not.toHaveText('Everyone');

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/groups/settings?tab=numbers', { waitUntil: 'networkidle' });
  await noHorizontalScroll(page);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Equipo: invitar, estado y ajustes de acceso; un miembro solo ve su línea', async ({ page, request }) => {
  const errors = watchErrors(page);
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  const demo = String((await db.execute("SELECT id FROM users WHERE email = 'demo@zerosoft.ai'")).rows[0].id);
  const boss = `ln-boss-${uid()}`;
  const team = `ln-team-${uid()}`;
  await db.execute({ sql: 'INSERT INTO users (id, email, name) VALUES (?, ?, ?)', args: [boss, `${boss}@test.local`, 'Boss'] });
  await db.execute({ sql: 'INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)', args: [team, 'Lines team', boss] });
  await db.execute({ sql: 'INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)', args: [team, boss, 'owner'] });
  await db.execute({ sql: 'INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)', args: [team, demo, 'admin'] });
  await db.execute({ sql: 'UPDATE users SET active_team_id = ? WHERE id = ?', args: [team, demo] });
  try {
    const tag = uid();
    const mine = await fakeNumber(request, `Mine ${tag}`);
    const theirs = await fakeNumber(request, `Theirs ${tag}`);
    await events(request, mine, [message(`5491170${Date.now().toString().slice(-6)}@c.us`, 'hola', `m-${tag}`)]);
    await events(request, theirs, [message(`5491171${Date.now().toString().slice(-6)}@c.us`, 'hola', `t-${tag}`)]);

    await page.goto('/en/app/groups/settings?tab=team', { waitUntil: 'networkidle' });
    await expect(page.getByRole('row', { name: /Boss/ })).toBeVisible();
    // Invitar (la invitación del workspace).
    await page.getByRole('button', { name: 'Invite' }).click();
    const inv = page.getByRole('dialog', { name: 'Invite to the workspace' });
    await inv.getByLabel('Emails').fill(`ln-${tag}@test.local`);
    await inv.getByRole('button', { name: 'Send invites' }).click();
    await expect(inv).toBeHidden();
    await expect(page.getByText(/invite sent|No new invites sent/)).toBeVisible();
    // Estado propio.
    await page.getByRole('row', { name: /demo@zerosoft\.ai/ }).getByRole('combobox', { name: /^Status of / }).selectOption('away');
    await expect.poll(async () => ((await (await request.get('/api/groups/availability')).json()) as { status: string }).status).toBe('away');
    await request.put('/api/groups/availability', { data: { status: 'online' } });
    // Acceso por línea: se prende y la línea "Mine" es para demo.
    await page.getByLabel('Line access: members see only their lines').check();
    await expect(page.getByText('Saved').first()).toBeVisible();
    expect((await request.put('/api/groups/lines', { data: { numberId: mine.id, personIds: [demo] } })).ok()).toBe(true);

    // Pasa a miembro: ve solo la línea suya.
    await db.execute({ sql: "UPDATE team_members SET role = 'member' WHERE team_id = ? AND user_id = ?", args: [team, demo] });
    const chats = (await (await request.get('/api/groups/chats?limit=200')).json()) as { rows: Array<{ id: string; numberId: string }> };
    expect(chats.rows.length).toBeGreaterThan(0);
    expect(chats.rows.every((c) => c.numberId === mine.id)).toBe(true);
    const hidden = await db.execute({ sql: 'SELECT id FROM groups_chats WHERE number_id = ?', args: [theirs.id] });
    expect((await request.get(`/api/groups/chats/${String(hidden.rows[0].id)}`)).status()).toBe(404);
    const myLines = (await (await request.get('/api/groups/lines')).json()) as { lines: Array<{ id: string }> };
    expect(myLines.lines.map((l) => l.id)).toEqual([mine.id]);
    // No puede responder por la línea ajena.
    const own = chats.rows[0];
    expect((await request.post(`/api/groups/chats/${own.id}/messages`, { data: { body: 'x', numberId: theirs.id } })).status()).toBe(403);
    await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
    await expect(page.locator('body')).not.toContainText(`Theirs ${tag}`);
    // La línea ajena no existe para esta persona, ni su conexión.
    expect((await request.get(`/api/groups/numbers/${theirs.id}`)).status()).toBe(404);
    expect((await request.get(`/api/groups/numbers/${theirs.id}/connect`)).status()).toBe(404);
    // Tareas de chats de la línea ajena: ni en la lista ni para crear.
    const hiddenChat = String(hidden.rows[0].id);
    expect((await request.post('/api/groups/tasks', { data: { chatId: hiddenChat, title: 'x' } })).status()).toBe(404);
    const tasks = (await (await request.get('/api/groups/tasks?status=all')).json()) as { tasks: Array<{ chatId: string }> };
    expect(tasks.tasks.some((x) => x.chatId === hiddenChat)).toBe(false);
    // El equipo, sin emails ni líneas.
    const teamView = (await (await request.get('/api/groups/team')).json()) as { people: Array<{ email: string; lineIds: unknown }> };
    expect(teamView.people.every((p) => p.email === '')).toBe(true);
    // Estado inválido.
    expect((await request.put('/api/groups/availability', { data: { status: 'nope' } })).status()).toBe(400);
  } finally {
    await db.execute({ sql: 'UPDATE users SET active_team_id = NULL WHERE id = ?', args: [demo] });
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('reglas de asignación por disponibilidad, con historial', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const n = await fakeNumber(request, `Rules ${tag}`);
  const me = ((await (await request.get('/api/groups/team')).json()) as { me: string }).me;
  await page.goto('/en/app/groups/settings?tab=assignment', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New rule' }).click();
  const dlg = page.getByRole('dialog', { name: 'New rule' });
  await dlg.getByLabel('Rule name').fill(`Rule ${tag}`);
  await dlg.getByLabel('Number').selectOption(n.id);
  await dlg.getByLabel('Some people').check();
  await dlg.getByRole('checkbox').first().check();
  await dlg.getByLabel('Who is in the rotation').selectOption('online_away');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByText(/Online or away/)).toBeVisible();

  // Ausente igual recibe con esta regla.
  await request.put('/api/groups/availability', { data: { status: 'away' } });
  await events(request, n, [message(`5491172${Date.now().toString().slice(-6)}@c.us`, `asignar ${tag}`, `r-${tag}`)]);
  const row = ((await (await request.get(`/api/groups/chats?number=${n.id}`)).json()) as { rows: Array<{ id: string; assignedTo: string | null }> }).rows[0];
  expect(row.assignedTo).toBe(me);
  const history = (await (await request.get(`/api/groups/assignments?chat=${row.id}`)).json()) as { events: Array<{ event: string; rule: string | null }> };
  expect(history.events[0]).toMatchObject({ event: 'auto_assigned', rule: `Rule ${tag}` });
  await request.put('/api/groups/availability', { data: { status: 'online' } });
  // Apagar la regla para no afectar otras pruebas.
  const rules = (await (await request.get('/api/groups/rules')).json()) as { rules: Array<{ id: string; name: string }> };
  const mineRule = rules.rules.find((r) => r.name === `Rule ${tag}`);
  if (mineRule) await request.delete(`/api/groups/rules/${mineRule.id}`);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('migrar de Periskope: vista previa e importación de etiquetas y respuestas rápidas', async ({ page }) => {
  const errors = watchErrors(page);
  const tag = uid();
  await page.goto('/en/app/groups/settings?tab=migrate', { waitUntil: 'networkidle' });
  await page.getByLabel('What the file has').selectOption('labels');
  await page.getByText('Or paste the CSV').click();
  await page.getByLabel('Or paste the CSV').fill(`Name,Color\nPsk ${tag},#eb5757\n`);
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText('1 of 1 rows would be applied.')).toBeVisible();
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('Imported: 1 of 1 rows.')).toBeVisible();
  await page.goto('/en/app/groups/settings?tab=labels', { waitUntil: 'networkidle' });
  await expect(page.getByText(`Psk ${tag}`)).toBeVisible();

  await page.goto('/en/app/groups/settings?tab=migrate', { waitUntil: 'networkidle' });
  await page.getByLabel('What the file has').selectOption('quick_replies');
  await page.getByText('Or paste the CSV').click();
  await page.getByLabel('Or paste the CSV').fill(`Command,Message\n/psk${tag},Hola desde Periskope\n`);
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('Imported: 1 of 1 rows.')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
