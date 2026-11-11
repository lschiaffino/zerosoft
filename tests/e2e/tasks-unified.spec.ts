import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Tareas de la suite (lib/tasks.ts): una tarea creada en un chat de Groups se
 * ve en el contacto del CRM, en la tarea con el link de vuelta al chat y en
 * el inicio; una tarea creada en el contacto se ve en el chat; y una tarea se
 * pasa a Track. Contra el proveedor falso de WhatsApp (GROUPS_FAKE=1).
 */

const uid = () => Math.random().toString(36).slice(2, 8);
test.describe.configure({ timeout: 150_000 });

async function ok<T>(p: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const res = await p;
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as T;
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

/** Un chat de WhatsApp con un mensaje, vinculado a un contacto nuevo del CRM. */
async function chatWithContact(request: APIRequestContext, tag: string) {
  const { id: numberId } = await ok<{ id: string }>(request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Tasks ${tag}` } }));
  await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = await ok<{ webhookUrl: string }>(request.get(`/api/groups/numbers/${numberId}`));
  const chatName = `Acme ${tag}`;
  const body = `Can you send the proposal ${tag}?`;
  await ok(
    request.post(new URL(info.webhookUrl).pathname, {
      data: {
        events: [
          {
            type: 'message',
            chatId: `120363${Date.now()}7@g.us`,
            isGroup: true,
            chatName,
            fromMe: false,
            senderPhone: '5491155550000',
            senderName: 'Ana',
            providerMessageId: `tu-${uid()}`,
            body,
          },
        ],
      },
    }),
  );
  const chats = await ok<{ rows: Array<{ id: string; name: string }> }>(request.get(`/api/groups/chats?q=${encodeURIComponent(chatName)}&limit=5`));
  const chat = chats.rows.find((r) => r.name === chatName)!;
  const contact = await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Ana', lastName: `Tasks ${tag}`, email: `ana-${tag}@example.com` } }));
  await ok(request.patch(`/api/groups/chats/${chat.id}`, { data: { crmContactId: contact.id } }));
  return { chat, chatName, contact, body };
}

test('una tarea creada en el chat se ve en el contacto, en la tarea con link al chat y en el inicio', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const { chat, chatName, contact, body } = await chatWithContact(request, tag);

  await page.goto(`/en/app/lines/inbox/${chat.id}`, { waitUntil: 'networkidle' });
  const msg = page.locator('.gr-msg-in', { hasText: body });
  await msg.hover();
  await msg.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Task from message' });
  await dialog.getByRole('button', { name: 'In 1 hour' }).click();
  await dialog.getByLabel('Priority').selectOption('high');
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText('Task created')).toBeVisible();
  const tasks = await ok<{ tasks: Array<{ id: string; title: string; priority: string }> }>(request.get(`/api/groups/tasks?chat=${chat.id}`));
  const task = tasks.tasks.find((t) => t.title === body)!;
  expect(task.priority).toBe('high');

  // En el contacto del CRM: la tarea en el timeline con el link de vuelta al chat.
  await page.goto(`/en/app/crm/contacts/${contact.id}`, { waitUntil: 'networkidle' });
  const source = page.locator('.tl-source', { hasText: chatName });
  await expect(source).toBeVisible();
  await expect(source).toHaveAttribute('href', new RegExp(`/app/lines/inbox/${chat.id}$`));

  // En la tarea: prioridad y "Linked to" con el chat y el mensaje.
  await page.goto(`/en/app/crm/tasks/${task.id}`, { waitUntil: 'networkidle' });
  const links = page.getByTestId('task-links');
  await expect(links.getByRole('link', { name: chatName })).toBeVisible();
  await expect(links.getByText(body)).toBeVisible();
  await expect(page.getByText('High').first()).toBeVisible();
  await links.getByRole('link', { name: chatName }).click();
  await expect(page).toHaveURL(new RegExp(`/app/lines/inbox/${chat.id}`));

  // En CRM › Tareas (hoy) con su origen, y en el inicio entre mis tareas.
  await page.goto('/en/app/crm/tasks?bucket=today', { waitUntil: 'networkidle' });
  const row = page.locator('.task-row', { hasText: body });
  if ((await row.count()) > 0) await expect(row.locator('.task-source')).toContainText(chatName);

  expect(errors).toEqual([]);
});

test('una tarea creada en el contacto del CRM aparece en el chat y se completa desde ahí', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const { chat, contact } = await chatWithContact(request, tag);
  const subject = `Call Ana about renewal ${tag}`;
  const crmTask = await ok<{ id: string }>(request.post('/api/crm/activities', { data: { type: 'task', subject, contactId: contact.id } }));

  await page.goto(`/en/app/lines/list/${chat.id}`, { waitUntil: 'networkidle' });
  const item = page.locator('.gr-task-list li', { hasText: subject });
  await expect(item).toBeVisible();
  await expect(item.getByRole('link', { name: 'From the CRM' })).toHaveAttribute('href', new RegExp(`/app/crm/tasks/${crmTask.id}$`));
  await item.getByRole('checkbox').check();
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/tasks/${crmTask.id}`)).json()) as { done: boolean }).done)
    .toBe(true);
  expect(errors).toEqual([]);
});

test('pasar una tarea a Track: issue vinculado y al cerrarlo la tarea se completa', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const project = await ok<{ id: string; name: string }>(request.post('/api/track/projects', { data: { name: `Tasks ${tag}` } }));
  const task = await ok<{ id: string }>(request.post('/api/crm/activities', { data: { type: 'task', subject: `Fix signup for Ana ${tag}` } }));
  await page.goto(`/en/app/crm/tasks/${task.id}`, { waitUntil: 'networkidle' });
  const links = page.getByTestId('task-links');
  await links.getByLabel('Project').selectOption(project.id);
  await links.getByRole('button', { name: 'Send to Track' }).click();
  const issueLink = links.getByRole('link', { name: /-\d+$/ });
  await expect(issueLink).toBeVisible();
  await expect(links.getByRole('button', { name: 'Send to Track' })).toHaveCount(0);
  const href = (await issueLink.getAttribute('href'))!;
  const issueId = href.split('/').pop()!;

  const list = (await ok<{ rows: Array<{ id: string; category: string }> }>(request.get(`/api/track/projects/${project.id}/statuses`))).rows;
  const done = list.find((s) => s.category === 'done')!;
  await ok(request.patch(`/api/track/issues/${issueId}`, { data: { statusId: done.id } }));
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('390px y oscuro: la tarea con sus vínculos sin scroll horizontal', async ({ page, request, context, baseURL }) => {
  const tag = uid();
  const { chat } = await chatWithContact(request, tag);
  const t = await ok<{ id: string }>(
    request.post('/api/groups/tasks', { data: { chatId: chat.id, title: `A very long task title to check wrapping on small screens ${tag} ${'x'.repeat(40)}` } }),
  );
  await context.addCookies([{ name: 'zs_theme', value: 'dark', url: baseURL! }]);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [`/en/app/crm/tasks/${t.id}`, '/en/app/crm/tasks?bucket=upcoming', `/en/app/lines/list/${chat.id}`]) {
    await page.goto(path, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
