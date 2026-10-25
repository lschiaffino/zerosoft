import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Groups, organización y tickets (tanda G2), de punta a punta contra el
 * proveedor falso (GROUPS_FAKE=1) y el modelo falso (GROUPS_AI_FAKE=1):
 * reconectar un número por QR, ajustes del grupo, entrar y salir, plantillas,
 * propiedades nuevas, listas guardadas, marcado de preguntas con el cron,
 * email del SLA, campos de ticket y tareas con recordatorio.
 *
 * Los tests que cambian ajustes del workspace (modo de marcado, email del
 * SLA, campos obligatorios) los dejan como estaban: el usuario demo es el
 * mismo para toda la suite.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const CRON = { authorization: 'Bearer e2e-cron' };

// Recorridos largos (varias pantallas y el cron): más margen que el de la suite.
test.describe.configure({ timeout: 150_000 });

interface NumberInfo {
  id: string;
  webhookPath: string;
}

async function fakeNumber(request: APIRequestContext, name = `G2 ${uid()}`): Promise<NumberInfo> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookPath: new URL(info.webhookUrl).pathname };
}

async function inbound(request: APIRequestContext, n: NumberInfo, chatId: string, body: string, chatName?: string) {
  const res = await request.post(n.webhookPath, {
    data: {
      events: [
        {
          type: 'message',
          chatId,
          isGroup: chatId.endsWith('@g.us'),
          chatName,
          fromMe: false,
          senderPhone: '5491155550000',
          senderName: 'Ana',
          providerMessageId: `g2-${uid()}`,
          body,
        },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function chatByName(request: APIRequestContext, name: string) {
  const res = (await (await request.get(`/api/groups/chats?q=${encodeURIComponent(name)}&limit=5`)).json()) as {
    rows: Array<{ id: string; name: string; awaitingSince: string | null; flagged: boolean }>;
  };
  return res.rows.find((r) => r.name === name) ?? null;
}

async function createGroup(request: APIRequestContext, numberId: string, name: string, phones: string[] = []) {
  const res = (await (await request.post('/api/groups/create', { data: { numberId, name, phones } })).json()) as { results: Array<{ chatId: string }> };
  return res.results[0].chatId;
}

async function sql(statement: string, args: Array<string | number | null>) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    await db.execute({ sql: statement, args });
  } finally {
    db.close();
  }
}

async function runCron(request: APIRequestContext) {
  const res = await request.get('/api/cron/minute', { headers: CRON, timeout: 120_000 });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { groups: { flagged: number; breached: number; reminders: number } };
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

test('QR: un número que se desvincula muestra Reconectar y vuelve con un QR nuevo', async ({ page, request }) => {
  const errors = watchErrors(page);
  const name = `Reconnect ${uid()}`;
  const n = await fakeNumber(request, name);
  // La sesión se cerró (en el gateway real lo avisa el webhook de sesión).
  await request.post(`/api/groups/numbers/${n.id}/connect`, { data: { action: 'disconnect' } });
  await page.goto('/en/app/groups/settings?tab=numbers', { waitUntil: 'networkidle' });
  const row = page.locator('.gr-number', { hasText: name });
  await expect(row.getByText('Disconnected', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Reconnect' }).click();
  const dialog = page.getByRole('dialog', { name: `Connect ${name}` });
  await expect(dialog.getByRole('img', { name: 'QR code to link WhatsApp' })).toBeVisible();
  await expect(dialog.getByText('The QR refreshes by itself.')).toBeVisible();
  await expect(dialog.getByText(/^Connected/)).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(row.getByText('Connected', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('ajustes del grupo, salir y entrar por link', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const name = `Settings ${uid()}`;
  const id = await createGroup(request, n.id, name, ['+15550004001']);
  await page.goto(`/en/app/groups/list/${id}`, { waitUntil: 'networkidle' });
  const announce = page.getByLabel('Only admins can send messages');
  await announce.check();
  await expect(page.getByText('Saved').first()).toBeVisible();
  await page.getByLabel('Disappearing messages').selectOption('604800');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByLabel('Only admins can send messages')).toBeChecked();
  await expect(page.getByLabel('Disappearing messages')).toHaveValue('604800');

  await page.getByRole('button', { name: 'Leave group' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Leave group' }).click();
  await expect(page.getByText(/This number left the group/)).toBeVisible();

  // Entrar con un link desde la lista de grupos.
  await page.goto('/en/app/groups/list', { waitUntil: 'networkidle' });
  await expect(page.locator('tr', { hasText: name }).getByText('Left')).toBeVisible();
  await page.getByRole('button', { name: 'Join with link' }).click();
  const join = page.getByRole('dialog', { name: 'Join a group by invite' });
  await join.getByLabel('From number').selectOption(n.id);
  await join.getByLabel('Invite link').fill('https://chat.whatsapp.com/badLink999');
  await join.getByRole('button', { name: 'Join group' }).click();
  await expect(join.getByText(/expired or was reset/)).toBeVisible();
  await join.getByLabel('Invite link').fill('https://chat.whatsapp.com/E2eJoin42');
  await join.getByRole('button', { name: 'Join group' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Invited E2eJoi' })).toBeVisible();
  await expect(page.getByText('2 members').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('plantillas: crear, usar con variables y encontrarla con ⌘K', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const tpl = `Onboarding ${uid()}`;
  const company = `Acme${uid()}`;
  await page.goto('/en/app/groups/templates', { waitUntil: 'networkidle' });
  await page.keyboard.press('c');
  const form = page.getByRole('dialog', { name: 'New group template' });
  await form.getByLabel('Template name', { exact: true }).fill(tpl);
  await form.getByRole('textbox', { name: /^Group name/ }).fill('{{company}} · Support');
  await form.getByRole('textbox', { name: /^Fixed members/ }).fill('+15550005001\n+15550005002');
  await form.getByRole('textbox', { name: /^Admins/ }).fill('+15550005003');
  await form.getByRole('textbox', { name: /^Welcome message/ }).fill('Hi {{company}}, welcome.');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Template created')).toBeVisible();
  const row = page.locator('tr', { hasText: tpl });
  await expect(row.getByText('3', { exact: true })).toBeVisible();

  await row.getByRole('button', { name: 'Use' }).click();
  const use = page.getByRole('dialog', { name: `Create groups with ${tpl}` });
  await use.getByLabel('From number').selectOption(n.id);
  await use.getByLabel('{{company}}').fill(company);
  await use.getByRole('button', { name: 'Preview' }).click();
  await expect(use.getByText('1 group ready to create')).toBeVisible();
  await expect(use.getByText(`${company} · Support`)).toBeVisible();
  await use.getByRole('button', { name: 'Create 1 group' }).click();
  await expect(use.getByText('1 of 1 groups created.')).toBeVisible({ timeout: 20_000 });
  await use.getByRole('link', { name: `${company} · Support` }).click();
  await expect(page.getByRole('heading', { level: 1, name: `${company} · Support` })).toBeVisible();
  await expect(page.getByText('+15550005003').first()).toBeVisible();
  await expect(page.getByText('Hi ' + company + ', welcome.')).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('dialog', { name: 'Search' });
  await search.getByRole('combobox').fill(tpl);
  await search.getByRole('option', { name: new RegExp(tpl) }).first().click();
  await expect(page.getByRole('dialog', { name: `Create groups with ${tpl}` })).toBeVisible();
  expect(errors).toEqual([]);
});

test('propiedades nuevas: multiselección en el grupo, filtro y columna en la lista', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const prop = `Tier${uid()}`;
  const gold = `Gold ${uid()}`;
  const silver = `Silver ${uid()}`;
  const a = await createGroup(request, n.id, gold);
  await createGroup(request, n.id, silver);
  await page.goto('/en/app/groups/settings?tab=properties', { waitUntil: 'networkidle' });
  await page.getByLabel('Property name').fill(prop);
  await page.getByLabel('Type').selectOption('multiselect');
  await page.getByLabel('Options, comma separated').fill('Gold, Silver');
  await page.getByRole('button', { name: 'Add property' }).click();
  await expect(page.locator('.gr-mini-list li', { hasText: prop })).toContainText('Multi-select: Gold, Silver');
  const created = (await (await request.get('/api/groups/properties')).json()) as { properties: Array<{ id: string; label: string; key: string }> };
  const def = created.properties.find((p) => p.label === prop)!;
  try {
    await page.goto(`/en/app/groups/list/${a}`, { waitUntil: 'networkidle' });
    await page.getByRole('group', { name: prop }).getByRole('button', { name: 'Gold' }).click();
    await expect(page.getByRole('group', { name: prop }).getByRole('button', { name: 'Gold' })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.gr-detail-section', { hasText: 'Properties' }).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved').first()).toBeVisible();

    await page.goto('/en/app/groups/list', { waitUntil: 'networkidle' });
    await page.getByLabel('Property').selectOption(def.key);
    await page.getByLabel('Value').selectOption('Gold');
    await expect(page.getByRole('link', { name: gold })).toBeVisible();
    await expect(page.getByRole('link', { name: silver })).toHaveCount(0);
    await page.getByRole('button', { name: 'Columns' }).click();
    const col = page.getByRole('group', { name: 'Columns' }).getByLabel(prop);
    if (!(await col.isChecked())) await col.check();
    await expect(page.getByRole('columnheader', { name: prop })).toBeVisible();
    await expect(page.locator('tr', { hasText: gold }).getByText('Gold', { exact: true })).toBeVisible();
  } finally {
    await request.delete(`/api/groups/properties?id=${def.id}`);
  }
  expect(errors).toEqual([]);
});

test('listas guardadas: guardar los filtros, sidebar, renombrar y borrar', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const who = `Lisa${uid()}`;
  await inbound(request, n, `120363${Date.now()}3@g.us`, 'hola', `Cliente ${who}`);
  await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Unanswered' }).click();
  await page.getByLabel('Type').selectOption('group');
  await page.getByRole('button', { name: 'Save as list' }).click();
  const save = page.getByRole('dialog', { name: 'Save as list' });
  const list = `Waiting groups ${uid()}`;
  await save.getByLabel('List name').fill(list);
  await save.getByLabel('Share with the team').check();
  await save.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\?list=/);
  await expect(page.getByRole('heading', { level: 1, name: list })).toBeVisible();
  await expect(page.locator('.gr-row', { hasText: `Cliente ${who}` })).toBeVisible();
  const branch = page.locator('#side-branch');
  await expect(branch.getByRole('link', { name: new RegExp(list) })).toHaveAttribute('aria-current', 'page');

  // Desde otra vista, la lista vuelve a cargar sus filtros.
  await page.getByRole('link', { name: 'All chats' }).click();
  await expect(page.getByRole('tab', { name: 'Open' })).toHaveAttribute('aria-selected', 'true');
  await branch.getByRole('link', { name: new RegExp(list) }).click();
  await expect(page.getByRole('tab', { name: 'Unanswered' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename list' });
  const renamed = `${list} (team)`;
  await rename.getByLabel('List name').fill(renamed);
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible();
  await expect(branch.getByRole('link', { name: new RegExp(renamed.replace(/[()]/g, '\\$&')) })).toBeVisible();

  // Audiencia de un envío masivo.
  await page.locator('.gr-list-meta').getByRole('link', { name: 'Broadcast', exact: true }).click();
  await expect(page).toHaveURL(/broadcasts\/new\?list=/);
  await expect(page.getByRole('button', { name: /Send to [1-9]\d* chats?/ })).toBeVisible();
  await page.goBack();

  await page.locator('.gr-list-meta').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).not.toHaveURL(/\?list=/);
  await expect(branch.getByRole('link', { name: new RegExp(list) })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('sin responder con AI: un "gracias" no espera, una pregunta sí y el cron la marca vencida', async ({ page, request }) => {
  const n = await fakeNumber(request);
  const tag = uid();
  await request.patch('/api/groups/settings', { data: { flagMode: 'questions', unansweredMin: 5 } });
  try {
    await inbound(request, n, `120363${Date.now()}4@g.us`, 'Thanks a lot!', `Thanks ${tag}`);
    await inbound(request, n, `120363${Date.now()}5@g.us`, 'Can you resend the invoice?', `Question ${tag}`);
    await expect.poll(async () => (await chatByName(request, `Question ${tag}`))?.awaitingSince ?? null, { timeout: 10_000 }).not.toBeNull();
    expect((await chatByName(request, `Thanks ${tag}`))?.awaitingSince).toBeNull();
    const q = (await chatByName(request, `Question ${tag}`))!;
    // Diez minutos esperando, más que el umbral: el cron (con claim) lo marca.
    await sql('UPDATE groups_chats SET awaiting_since = ? WHERE id = ?', [new Date(Date.now() - 10 * 60_000).toISOString(), q.id]);
    const cron = await runCron(request);
    expect(cron.groups.flagged).toBeGreaterThanOrEqual(1);
    await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Overdue' }).click();
    await expect(page.locator('.gr-row', { hasText: `Question ${tag}` })).toBeVisible();
    await expect(page.locator('.gr-row', { hasText: `Thanks ${tag}` })).toHaveCount(0);
    await page.locator('.gr-row', { hasText: `Question ${tag}` }).click();
    await expect(page.locator('.gr-msg-in', { hasText: 'Can you resend the invoice?' }).getByText('Needs reply')).toBeVisible();
    // Una segunda corrida no la vuelve a marcar.
    await runCron(request);
    expect((await chatByName(request, `Question ${tag}`))!.flagged).toBe(true);
  } finally {
    await request.patch('/api/groups/settings', { data: { flagMode: 'time', unansweredMin: 30 } });
  }
});

test('email del SLA: se activa en Ajustes y el vencimiento avisa una vez', async ({ page, request }) => {
  const n = await fakeNumber(request);
  const tag = uid();
  await inbound(request, n, `120363${Date.now()}6@g.us`, 'Down again', `Sla ${tag}`);
  await page.goto('/en/app/groups/settings?tab=tickets', { waitUntil: 'networkidle' });
  try {
    await page.getByLabel('Send an email when a ticket is past its first response or resolution time').check();
    await expect(page.getByLabel('To the person assigned to the ticket')).toBeChecked();
    await page.getByLabel('Other emails').fill('oncall@example.com');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved').first()).toBeVisible();
    const chat = (await chatByName(request, `Sla ${tag}`))!;
    const ticket = (await (await request.post('/api/groups/tickets', { data: { chatId: chat.id, title: `Outage ${tag}`, priority: 'urgent', assigneeId: 'demo' } })).json()) as { id: string };
    const past = new Date(Date.now() - 60_000).toISOString();
    await sql('UPDATE groups_tickets SET first_response_due_at = ?, due_at = ? WHERE id = ?', [past, past, ticket.id]);
    await runCron(request);
    await runCron(request);
    const notes = (await (await request.get('/api/notifications?limit=100')).json()) as { notifications?: Array<{ type: string; title: string }>; rows?: Array<{ type: string; title: string }> };
    const list = notes.notifications ?? notes.rows ?? [];
    expect(list.filter((x) => x.type === 'groups_sla' && x.title.includes(`Outage ${tag}`))).toHaveLength(1);
    await page.goto('/en/app/groups/tickets', { waitUntil: 'networkidle' });
    await expect(page.locator('tr', { hasText: `Outage ${tag}` }).getByText('Overdue')).toBeVisible();
  } finally {
    await request.patch('/api/groups/settings', { data: { slaEmail: false, slaEmailExtra: [] } });
  }
});

test('campos de ticket: obligatorio para resolver, filtro y export', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const tag = uid();
  const field = `Area ${tag}`;
  await inbound(request, n, `120363${Date.now()}7@g.us`, 'Broken export', `Fields ${tag}`);
  const chat = (await chatByName(request, `Fields ${tag}`))!;
  await page.goto('/en/app/groups/settings?tab=ticketFields', { waitUntil: 'networkidle' });
  await page.getByLabel('Property name').fill(field);
  await page.getByLabel('Type').selectOption('select');
  await page.getByLabel('Options, comma separated').fill('Billing, Product');
  await page.getByLabel('Required to close').check();
  await page.getByRole('button', { name: 'Add property' }).click();
  await expect(page.locator('.gr-mini-list li', { hasText: field }).getByText('Required')).toBeVisible();
  const defs = (await (await request.get('/api/groups/properties?scope=ticket')).json()) as { properties: Array<{ id: string; key: string; label: string }> };
  const def = defs.properties.find((d) => d.label === field)!;
  try {
    const title = `Export fails ${tag}`;
    await request.post('/api/groups/tickets', { data: { chatId: chat.id, title } });
    await request.post('/api/groups/tickets', { data: { chatId: chat.id, title: `Other ${tag}` } });
    await page.goto('/en/app/groups/tickets', { waitUntil: 'networkidle' });
    const row = page.locator('tr', { hasText: title });
    await row.getByLabel('Status').selectOption('resolved');
    const modal = page.getByRole('dialog', { name: new RegExp(title) });
    await expect(modal.getByText('Complete the required fields to change the status.')).toBeVisible();
    await modal.getByLabel(`${field} *`).selectOption('Billing');
    await modal.getByRole('button', { name: 'Save and mark Resolved' }).click();
    await expect(row.getByLabel('Status')).toHaveValue('resolved');
    await page.getByLabel('Status').first().selectOption('all');
    await page.getByLabel('Filter by field').selectOption(def.key);
    await page.getByLabel('Value').selectOption('Billing');
    await expect(page.locator('tr', { hasText: title })).toBeVisible();
    await expect(page.locator('tr', { hasText: `Other ${tag}` })).toHaveCount(0);
    const href = await page.getByRole('link', { name: 'Export CSV' }).getAttribute('href');
    expect(href).toContain('fields=');
    const csv = await (await request.get(href!)).text();
    expect(csv.split('\n')[0]).toContain(field);
    expect(csv).toContain(title);
    expect(csv).not.toContain(`Other ${tag}`);
  } finally {
    await request.delete(`/api/groups/properties?id=${def.id}`);
  }
  expect(errors).toEqual([]);
});

test('tareas: desde un mensaje, en el chat y en Tareas, con aviso a su hora', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const tag = uid();
  const body = `Send me the proposal ${tag}`;
  await inbound(request, n, `120363${Date.now()}8@g.us`, body, `Tasks ${tag}`);
  const chat = (await chatByName(request, `Tasks ${tag}`))!;
  await page.goto(`/en/app/groups/inbox/${chat.id}`, { waitUntil: 'networkidle' });
  const msg = page.locator('.gr-msg-in', { hasText: body });
  await msg.hover();
  await msg.getByRole('button', { name: 'Task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Task from message' });
  await expect(dialog.getByLabel('Task')).toHaveValue(body);
  await dialog.getByRole('button', { name: 'In 1 hour' }).click();
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText('Task created')).toBeVisible();
  // En la página del grupo, la sección Tareas del chat.
  await page.goto(`/en/app/groups/list/${chat.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByText('Tasks (1)')).toBeVisible();
  await expect(page.locator('.gr-task-title', { hasText: body })).toBeVisible();

  await page.goto('/en/app/groups/tasks', { waitUntil: 'networkidle' });
  const row = page.locator('tr', { hasText: body });
  await expect(row).toBeVisible();
  await expect(row.getByRole('link', { name: `Tasks ${tag}` })).toBeVisible();
  const tasks = (await (await request.get(`/api/groups/tasks?chat=${chat.id}`)).json()) as { tasks: Array<{ id: string; activityId: string }> };
  // Llegó la hora: el cron avisa una vez.
  await sql('UPDATE crm_activities SET due_at = ? WHERE id = ?', [new Date(Date.now() - 60_000).toISOString(), tasks.tasks[0].activityId]);
  await runCron(request);
  await runCron(request);
  const notes = (await (await request.get('/api/notifications?limit=100')).json()) as { notifications?: Array<{ type: string; title: string }>; rows?: Array<{ type: string; title: string }> };
  const list = notes.notifications ?? notes.rows ?? [];
  expect(list.filter((x) => x.type === 'groups_reminder' && x.title.includes(body))).toHaveLength(1);
  // También está en CRM › Tareas.
  const crmRows: Array<{ subject: string }> = [];
  for (const bucket of ['overdue', 'today', 'upcoming']) {
    crmRows.push(...((await (await request.get(`/api/crm/activities?bucket=${bucket}`)).json()) as { rows: Array<{ subject: string }> }).rows);
  }
  expect(crmRows.some((r) => r.subject === body)).toBe(true);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('tr', { hasText: body }).getByRole('checkbox').check();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('tr', { hasText: body })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('390px y oscuro: plantillas, tareas y bandeja con listas sin scroll horizontal', async ({ page, request, context, baseURL }) => {
  await fakeNumber(request);
  await request.post('/api/groups/lists', { data: { name: `Mobile list ${uid()}`, filters: { kind: 'group' } } });
  await context.addCookies([{ name: 'zs_theme', value: 'dark', url: baseURL! }]);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/en/app/groups/templates', '/en/app/groups/tasks', '/en/app/groups/inbox', '/en/app/groups/list', '/en/app/groups/settings?tab=ticketFields']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main.app-content h1').first()).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
    expect(scroll, path).toBeLessThanOrEqual(inner + 1);
  }
});
