import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Lines: dueño y visibilidad por línea, selector de línea ("Todas las líneas"),
 * carpetas compartidas. Contra el proveedor falso; nada sale a WhatsApp.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function fakeNumber(request: APIRequestContext, name: string): Promise<{ id: string; webhookUrl: string }> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookUrl: info.webhookUrl };
}

async function inbound(request: APIRequestContext, url: string, name: string) {
  const res = await request.post(new URL(url).pathname, {
    data: {
      events: [{ type: 'message', chatId: `54911${Math.floor(Math.random() * 1e7)}@c.us`, isGroup: false, fromMe: false, senderPhone: '5491155550000', senderName: name, providerMessageId: `ln-${uid()}`, body: `hola ${name}` }],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

test('dueño, selector de línea y carpetas', async ({ page, request }) => {
  const tag = uid();
  const a = await fakeNumber(request, `Linea A ${tag}`);
  const b = await fakeNumber(request, `Linea B ${tag}`);
  await inbound(request, a.webhookUrl, `Alfa ${tag}`);
  await inbound(request, b.webhookUrl, `Beta ${tag}`);

  // Dueño: la línea lo muestra y se filtra.
  const people = (await (await request.get('/api/groups/numbers')).json()) as { numbers: Array<{ id: string; ownerId: string | null }> };
  expect(people.numbers.find((n) => n.id === a.id)?.ownerId).toBeNull();
  const me = (await (await request.get('/api/groups/availability')).json()) as { me: boolean };
  expect(me).toBeTruthy();
  const patched = await request.patch(`/api/groups/numbers/${a.id}`, { data: { visibility: 'restricted', personIds: [], teamIds: [] } });
  expect(patched.ok(), await patched.text()).toBe(true);
  expect(((await patched.json()) as { visibility: string }).visibility).toBe('restricted');
  const bad = await request.patch(`/api/groups/numbers/${a.id}`, { data: { ownerId: 'no-existe' } });
  expect(bad.status()).toBe(400);
  await request.patch(`/api/groups/numbers/${a.id}`, { data: { visibility: 'all' } });

  // Carpetas.
  const folder = (await (await request.post('/api/groups/folders', { data: { name: `Clientes ${tag}` } })).json()) as { id: string };
  const sub = await request.post('/api/groups/folders', { data: { name: 'VIP', parentId: folder.id } });
  expect(sub.status()).toBe(201);
  const dup = await request.post('/api/groups/folders', { data: { name: `clientes ${tag}` } });
  expect(dup.status()).toBe(409);
  const chats = (await (await request.get(`/api/groups/chats?q=${encodeURIComponent(`Alfa ${tag}`)}`)).json()) as { rows: Array<{ id: string }> };
  const moved = await request.post('/api/groups/chats/bulk', { data: { ids: [chats.rows[0].id], action: 'folder', folderId: folder.id } });
  expect(((await moved.json()) as { updated: number }).updated).toBe(1);
  const inFolder = (await (await request.get(`/api/groups/chats?folder=${folder.id}`)).json()) as { rows: Array<{ id: string }> };
  expect(inFolder.rows.map((r) => r.id)).toEqual([chats.rows[0].id]);

  // Línea elegida: se guarda.
  const put = await request.put('/api/groups/prefs', { data: { line: b.id } });
  expect(((await put.json()) as { line: string }).line).toBe(b.id);

  // Pantalla: selector, solo la línea B, carpetas en el sidebar, sin scroll horizontal a 390px.
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const select = page.getByLabel('Line', { exact: true });
  await expect(select).toHaveValue(b.id);
  await expect(page.getByText(`Beta ${tag}`).first()).toBeVisible();
  await expect(page.getByText(`Alfa ${tag}`)).toHaveCount(0);
  await select.selectOption('all');
  await expect(page.getByText(`Alfa ${tag}`).first()).toBeVisible();
  // Las carpetas cuelgan de "Inbox" en el sidebar; abrir una filtra la bandeja y queda en la URL.
  const side = page.locator('#side-branch').getByTestId('lines-folders');
  await expect(side).toBeVisible();
  await side.getByTestId('lines-folder').filter({ hasText: `Clientes ${tag}` }).click();
  await expect(page).toHaveURL(new RegExp(`folder=${folder.id}`));
  await expect(page.getByTestId('lines-folder-current')).toContainText(`Clientes ${tag}`);
  await expect(page.getByText(`Alfa ${tag}`).first()).toBeVisible();
  await expect(page.getByText(`Beta ${tag}`)).toHaveCount(0);
  // En el teléfono no hay sidebar a la vista: la bandeja ofrece un selector con la misma carpeta.
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByTestId('lines-folder-select')).toHaveValue(folder.id);
  await page.getByTestId('lines-folder-select').selectOption('');
  await expect(page.getByText(`Beta ${tag}`).first()).toBeVisible();
  const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(w.scroll).toBeLessThanOrEqual(w.inner + 1);
  await request.put('/api/groups/prefs', { data: { line: 'all' } });
  await request.delete(`/api/groups/folders?id=${folder.id}`);
});

test('ajustes: dueño y acceso de una línea', async ({ page, request }) => {
  const tag = uid();
  const n = await fakeNumber(request, `Linea Acceso ${tag}`);
  await page.goto('/en/app/lines/settings?tab=numbers', { waitUntil: 'networkidle' });
  const card = page.locator('li.gr-number', { hasText: `Linea Acceso ${tag}` });
  await card.getByTestId('line-access-btn').click();
  await expect(page.getByTestId('line-owner')).toBeVisible();
  await page.getByTestId('line-restricted').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByTestId('line-owner-label')).toContainText('Restricted');
  const row = (await (await request.get(`/api/groups/numbers/${n.id}`)).json()) as { visibility: string };
  expect(row.visibility).toBe('restricted');
});
