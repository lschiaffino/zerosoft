import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Groups, pendientes menores de varias QA: hora del log de entregas en la zona
 * del navegador (SQLite guarda UTC sin Z), "Resolved just now", "se asignó el
 * chat" en el hilo, el CSV de plantillas dice qué variable falta, los
 * ConfirmDialog destructivos arrancan en Cancelar y el launcher de feedback no
 * tapa "Available" en Ajustes › Asignación a 390px.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

interface NumberInfo {
  id: string;
  name: string;
  webhookPath: string;
}

async function fakeNumber(request: APIRequestContext, name = `MX ${uid()}`): Promise<NumberInfo> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, name, webhookPath: new URL(info.webhookUrl).pathname };
}

async function inbound(request: APIRequestContext, n: NumberInfo, chatId: string, body: string, chatName: string) {
  const res = await request.post(n.webhookPath, {
    data: {
      events: [
        {
          type: 'message',
          chatId,
          isGroup: true,
          chatName,
          fromMe: false,
          senderPhone: '5491155550000',
          senderName: 'Ana',
          providerMessageId: `mx-${uid()}`,
          body,
        },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function chatByName(request: APIRequestContext, name: string) {
  const res = await request.get(`/api/groups/chats?q=${encodeURIComponent(name)}`);
  const data = (await res.json()) as { chats?: Array<{ id: string; name: string }>; rows?: Array<{ id: string; name: string }> };
  return (data.chats ?? data.rows ?? []).find((c) => c.name === name) ?? null;
}

async function sql(statement: string, args: Array<string | number | null>) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows;
  } finally {
    db.close();
  }
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

test.describe('log de entregas en la hora del navegador', () => {
  test.use({ timezoneId: 'America/Argentina/Buenos_Aires', locale: 'en-US' });

  test('una entrega guardada a las 15:00 UTC se ve a las 12:00 en Buenos Aires', async ({ page, request }) => {
    const created = await request.post('/api/groups/webhooks', { data: { url: `http://127.0.0.1:9/mx-${uid()}`, events: ['groups.chat.assigned'] } });
    expect(created.ok(), await created.text()).toBe(true);
    const { id } = (await created.json()) as { id: string };
    // Como datetime('now'): UTC sin zona.
    await sql("INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status, created_at) VALUES (?, ?, 'groups.chat.assigned', '{}', 'failed', '2026-01-15 15:00:00')", [
      `mxd-${uid()}`,
      id,
    ]);
    await page.goto('/en/app/groups/settings?tab=integrations', { waitUntil: 'networkidle' });
    await page.locator('li', { hasText: '127.0.0.1:9/mx-' }).getByRole('button', { name: 'Log' }).first().click();
    const log = page.getByRole('dialog', { name: 'Delivery log' });
    const time = log.locator('time[datetime="2026-01-15 15:00:00"]');
    await expect(time).toContainText('12:00');
    await expect(time).not.toContainText('3:00');
  });
});

test('ticket recién resuelto dice "Resolved just now" y asignarse el chat dice "assigned the chat to themselves"', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const name = `Misc ${uid()}`;
  await inbound(request, n, `120363${Date.now()}7@g.us`, 'Need help', name);
  const chat = (await chatByName(request, name))!;
  const tk = await request.post('/api/groups/tickets', { data: { chatId: chat.id, title: `Done ${uid()}` } });
  expect(tk.ok(), await tk.text()).toBe(true);
  const { id } = (await tk.json()) as { id: string };
  expect((await request.patch(`/api/groups/tickets/${id}`, { data: { status: 'resolved' } })).ok()).toBe(true);
  await page.goto('/en/app/groups/tickets', { waitUntil: 'networkidle' });
  await page.getByRole('combobox', { name: 'Status' }).first().selectOption('all');
  const row = page.locator('tr', { hasText: name });
  await expect(row.getByText('Resolved just now')).toBeVisible();
  await expect(page.getByText(/now ago/)).toHaveCount(0);

  await page.goto(`/en/app/groups/inbox/${chat.id}`, { waitUntil: 'networkidle' });
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('a');
  await expect(page.locator('.gr-thread, main').getByText(/assigned the chat to themselves/).first()).toBeVisible();
  await expect(page.getByText(/assigned this chat to Demo User/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('CSV de plantillas sin la columna de una variable dice cuál falta', async ({ page, request }) => {
  const n = await fakeNumber(request);
  const tpl = `Csv ${uid()}`;
  const created = await request.post('/api/groups/templates', { data: { name: tpl, groupName: '{{company}} · {{plan}}' } });
  expect(created.ok(), await created.text()).toBe(true);
  await page.goto('/en/app/groups/templates', { waitUntil: 'networkidle' });
  await page.locator('tr', { hasText: tpl }).getByRole('button', { name: 'Use' }).click();
  const use = page.getByRole('dialog', { name: `Create groups with ${tpl}` });
  await use.getByLabel('From number').selectOption(n.id);
  await use.getByRole('tab', { name: 'Many from a CSV' }).click();
  await use.getByRole('textbox').last().fill('company\nAcme');
  await use.getByRole('button', { name: 'Preview' }).click();
  await expect(use.getByText(/Missing: plan\./)).toBeVisible();
});

test('ConfirmDialog destructivo: el foco arranca en Cancelar (Enter no borra)', async ({ page, request }) => {
  const n = await fakeNumber(request);
  await page.goto('/en/app/groups/settings?tab=numbers', { waitUntil: 'networkidle' });
  const card = page.locator('.gr-number', { hasText: n.name });
  await card.getByRole('button', { name: 'Disconnect' }).click();
  const confirm = page.getByRole('alertdialog', { name: `Disconnect ${n.name}?` });
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirm).toBeHidden();
  await expect(card.getByText('Connected', { exact: true })).toBeVisible();
});

test('390px: el launcher de feedback no tapa "Available" en Ajustes › Asignación', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/groups/settings?tab=assignment', { waitUntil: 'networkidle' });
  const launcher = page.locator('.fl-root .fl-button');
  await expect(launcher).toBeVisible();
  const btn = (await launcher.boundingBox())!;
  // La pestaña cabe en el margen lateral de 16px: nada de la página queda debajo.
  expect(btn.x).toBeGreaterThanOrEqual(390 - 16);
  const available = (await page.getByText('Available', { exact: true }).first().boundingBox())!;
  expect(available.x + available.width).toBeLessThanOrEqual(btn.x);
});
