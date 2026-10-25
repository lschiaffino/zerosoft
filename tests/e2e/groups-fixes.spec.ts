import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Groups, arreglos de la QA de int-4 (contra el proveedor falso): desconectar
 * pide confirmación, pestañas de ajustes a 390px, ⌘K sobre un modal, rango de
 * reportes invertido, desplegable dependiente sin opciones, ticket desde un
 * mensaje que saca el "Vencido" de la fila, auditoría legible, ajustes en lote
 * con mensajes temporales y campos obligatorios del ticket sin 400.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

interface NumberInfo {
  id: string;
  name: string;
  webhookPath: string;
}

async function fakeNumber(request: APIRequestContext, name = `FX ${uid()}`): Promise<NumberInfo> {
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
          senderName: chatName ?? 'Ana',
          providerMessageId: `fx-${uid()}`,
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

test('desconectar un número pide confirmación', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  await page.goto('/en/app/groups/settings?tab=numbers', { waitUntil: 'networkidle' });
  const card = page.locator('.gr-number', { hasText: n.name });
  await card.getByRole('button', { name: 'Disconnect' }).click();
  const confirm = page.getByRole('alertdialog', { name: `Disconnect ${n.name}?` });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(card.getByText('Connected', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Disconnect' }).click();
  await page.getByRole('alertdialog', { name: `Disconnect ${n.name}?` }).getByRole('button', { name: 'Disconnect' }).click();
  await expect(card.getByText('Disconnected', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('390px: la pestaña activa de Ajustes queda a la vista y Asignación sin huecos', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ['tickets', 'audit', 'apps']) {
    await page.goto(`/en/app/groups/settings?tab=${tab}`);
    const active = page.locator('.ui-settings-nav [aria-current="page"]');
    await expect(active).toBeInViewport({ ratio: 0.95 });
  }
  await page.goto('/en/app/groups/settings?tab=assignment');
  const nav = await page.locator('.ui-settings-nav').boundingBox();
  const teams = await page.getByRole('heading', { name: 'Teams' }).boundingBox();
  expect(teams!.y - (nav!.y + nav!.height)).toBeLessThan(60);
  // Entre bloques, solo el espacio de la grilla (sin el padding de <section> de la landing).
  const blocks = page.locator('.gr-settings-block');
  const first = (await blocks.nth(0).boundingBox())!;
  const second = (await blocks.nth(1).boundingBox())!;
  expect(second.y - (first.y + first.height)).toBeLessThan(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('⌘K con un modal abierto cierra el modal y abre la búsqueda arriba', async ({ page }) => {
  await page.goto('/en/app/groups/settings?tab=numbers', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add number' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a WhatsApp number' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('dialog', { name: 'Search' });
  await expect(search).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Add a WhatsApp number' })).toHaveCount(0);
  await search.getByRole('combobox').fill('tickets');
  await expect(search.getByRole('combobox')).toHaveValue('tickets');
});

test('reportes: rango invertido avisa y no se aplica', async ({ page }) => {
  await page.goto('/en/app/groups/analytics', { waitUntil: 'networkidle' });
  await page.getByLabel('From', { exact: true }).fill('2026-10-20');
  await page.getByLabel('To', { exact: true }).fill('2026-10-10');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('alert')).toContainText('The end date is before the start date');
  await expect(page.getByLabel('From', { exact: true })).toHaveAttribute('aria-invalid', 'true');
});

test('desplegable dependiente sin opciones: aviso en el campo y botón debajo', async ({ page }) => {
  await page.goto('/en/app/groups/settings?tab=properties', { waitUntil: 'networkidle' });
  await page.getByLabel('Property name', { exact: true }).fill(`City ${uid()}`);
  await page.getByLabel('Type', { exact: true }).selectOption('cascade');
  const tree = page.locator('#gr-prop-tree');
  const add = page.getByRole('button', { name: 'Add property' });
  expect((await add.boundingBox())!.y).toBeGreaterThan((await tree.boundingBox())!.y);
  await add.click();
  await expect(page.getByText('Write the options, one per line.')).toBeVisible();
  await expect(tree).toBeFocused();
  await expect(page.getByText('comma separated')).toHaveCount(0);
  await tree.fill('Argentina\n  Buenos Aires');
  await add.click();
  await expect(page.getByText('Write the options, one per line.')).toHaveCount(0);
});

test('ticket desde un mensaje: la fila deja de decir Overdue sin recargar; auditoría legible', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const name = `Late ${uid()}`;
  await inbound(request, n, `120363${Date.now()}3@g.us`, 'The export is broken', name);
  const chat = (await chatByName(request, name))!;
  const past = new Date(Date.now() - 3600_000).toISOString();
  await sql('UPDATE groups_chats SET awaiting_since = ?, flagged_at = ? WHERE id = ?', [past, past, chat.id]);
  await page.goto(`/en/app/groups/inbox/${chat.id}`, { waitUntil: 'networkidle' });
  const row = page.locator('.gr-row', { hasText: name });
  await expect(row.locator('.badge', { hasText: 'Overdue' })).toBeVisible();
  const msg = page.locator('.gr-msg-in', { hasText: 'The export is broken' });
  await msg.hover();
  await msg.getByRole('button', { name: 'Ticket' }).click();
  await page.getByRole('dialog', { name: 'New ticket' }).getByRole('button', { name: 'Create ticket' }).click();
  await expect(msg.getByRole('link', { name: 'Ticket' })).toBeVisible();
  await expect(row.locator('.badge', { hasText: 'Overdue' })).toHaveCount(0);

  // Asignarse el chat (A) y sumar una etiqueta: el log dice "to themselves" y no muestra "removed: " vacío.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('a');
  await expect
    .poll(async () => {
      const d = (await (await request.get(`/api/groups/chats/${chat.id}`)).json()) as { chat?: { assignedTo: string | null }; assignedTo?: string | null };
      return d.chat?.assignedTo ?? d.assignedTo ?? null;
    })
    .not.toBeNull();
  const label = (await (await request.post('/api/groups/labels', { data: { name: `Vip${uid()}` } })).json()) as { id: string; name: string };
  expect((await request.patch(`/api/groups/chats/${chat.id}`, { data: { labelIds: [label.id] } })).ok()).toBe(true);
  await page.goto('/en/app/groups/settings?tab=audit', { waitUntil: 'networkidle' });
  const log = page.locator('.gr-audit');
  await expect(log.getByText('assigned the chat to themselves').first()).toBeVisible();
  await expect(log.getByText(`added labels: ${label.name}`)).toBeVisible();
  await expect(log.getByText(/removed: \)/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('ajustes en lote ofrecen mensajes temporales; la zona del recurrente tiene nombre propio', async ({ page }) => {
  await page.goto('/en/app/groups/list', { waitUntil: 'networkidle' });
  const boxes = page.locator('tbody').getByRole('checkbox');
  if ((await boxes.count()) > 0) {
    await boxes.first().check();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: /^Settings of / });
    await expect(dlg.getByLabel('Disappearing messages')).toBeVisible();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
  }
  await page.goto('/en/app/groups/broadcasts/new?repeat=1', { waitUntil: 'networkidle' });
  await expect(page.getByRole('combobox', { name: 'Time zone', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Mon' })).not.toBeChecked();
});
