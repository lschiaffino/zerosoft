import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines: moverse por la bandeja no recarga la pantalla. Abrir una carpeta del
 * sidebar (o una lista guardada) solo cambia la lista de chats: el chat
 * abierto y lo escrito en el composer quedan como están, la URL lleva la
 * carpeta (atrás y adelante funcionan) y la lista trae más chats al bajar.
 * Contra el proveedor falso; nada sale a WhatsApp.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/favicon|Failed to load resource/i.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

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

async function inbound(request: APIRequestContext, url: string, names: string[]) {
  const res = await request.post(new URL(url).pathname, {
    data: {
      events: names.map((name, i) => ({
        type: 'message',
        chatId: `54911${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}${String(i).padStart(2, '0')}@c.us`,
        isGroup: false,
        fromMe: false,
        senderPhone: '5491155550000',
        senderName: name,
        providerMessageId: `nav-${uid()}-${i}`,
        body: `hola ${name}`,
      })),
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Pedidos de página al servidor (documento o RSC) dentro de la bandeja de Lines. */
function watchPageLoads(page: Page): string[] {
  const loads: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!/\/app\/lines\/inbox(\/[^/]+)?$/.test(url.pathname)) return;
    // Un prefetch (pasar el mouse por un link) no es una navegación.
    if (req.headers()['next-router-prefetch']) return;
    if (req.resourceType() === 'document' || req.headers()['rsc'] === '1') loads.push(`${url.pathname}${url.search}`);
  });
  return loads;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('abrir una carpeta solo cambia la lista: el chat abierto y lo escrito siguen; atrás y adelante vuelven', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const n = await fakeNumber(request, `Linea Nav ${tag}`);
  const alfa = `Alfa ${tag}`;
  const beta = `Beta ${tag}`;
  await inbound(request, n.webhookUrl, [alfa, beta]);
  const folderName = `Clientes ${tag}`;
  const folder = (await (await request.post('/api/groups/folders', { data: { name: folderName } })).json()) as { id: string };
  const chats = (await (await request.get(`/api/groups/chats?q=${encodeURIComponent(alfa)}`)).json()) as { rows: Array<{ id: string }> };
  const moved = await request.post('/api/groups/chats/bulk', { data: { ids: [chats.rows[0].id], action: 'folder', folderId: folder.id } });
  expect(((await moved.json()) as { updated: number }).updated).toBe(1);
  await request.put('/api/groups/prefs', { data: { line: 'all' } });

  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: beta }).first().click();
  await expect(page).toHaveURL(/\/en\/app\/lines\/inbox\/[^/?]+/);
  const threadHead = page.locator('.gr-thread .gr-thread-head');
  await expect(threadHead).toContainText(beta);
  const field = page.locator('textarea.wa-input');
  await field.fill('texto a medio escribir');
  const chatUrl = new URL(page.url()).pathname;
  // Marcas en la bandeja y en el encabezado del chat: si algo se vuelve a montar, se pierden. (Lo escrito se
  // guarda como borrador y volvería igual: por eso se mira el nodo y no solo el texto.)
  const head = await threadHead.elementHandle();
  expect(head).not.toBeNull();
  await page.evaluate(() => {
    (document.querySelector('.gr-inbox') as HTMLElement).dataset.mark = 'shell';
    (document.querySelector('.gr-thread .gr-thread-head') as HTMLElement).dataset.mark = 'head';
    (document.querySelector('textarea.wa-input') as HTMLElement).dataset.mark = 'composer';
  });
  const marks = () =>
    page.evaluate(() => [
      (document.querySelector('.gr-inbox') as HTMLElement | null)?.dataset.mark ?? '',
      (document.querySelector('.gr-thread .gr-thread-head') as HTMLElement | null)?.dataset.mark ?? '',
      (document.querySelector('textarea.wa-input') as HTMLElement | null)?.dataset.mark ?? '',
    ]);
  const untouched = async () => {
    await expect(field).toHaveValue('texto a medio escribir');
    expect(await marks()).toEqual(['shell', 'head', 'composer']);
    expect(await head!.evaluate((el) => el.isConnected)).toBe(true);
    await expect(threadHead).toContainText(beta);
    expect(new URL(page.url()).pathname).toBe(chatUrl);
  };
  const loads = watchPageLoads(page);
  const side = page.locator('#side-branch').getByTestId('lines-folders');
  const rows = page.locator('.gr-rows');

  // Carpeta del sidebar: queda en la URL, la lista es la de la carpeta y el chat abierto no se toca.
  await side.getByTestId('lines-folder').filter({ hasText: folderName }).click();
  await expect(page).toHaveURL(new RegExp(`folder=${folder.id}`));
  await expect(page.getByTestId('lines-folder-current')).toContainText(folderName);
  await expect(rows).toHaveAttribute('data-list', new RegExp(`folder=${folder.id}`));
  await expect(page.locator('.gr-row', { hasText: alfa })).toBeVisible();
  await expect(page.locator('.gr-row', { hasText: beta })).toHaveCount(0);
  await untouched();

  // Atrás: todos los chats otra vez (la lista ya vista aparece de memoria). Adelante: la carpeta.
  await page.goBack();
  await expect(page).not.toHaveURL(/folder=/);
  await expect(page.getByTestId('lines-folder-current')).toHaveCount(0);
  await expect(page.locator('.gr-row', { hasText: beta }).first()).toBeVisible();
  await untouched();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`folder=${folder.id}`));
  await expect(page.getByTestId('lines-folder-current')).toContainText(folderName);
  await expect(page.locator('.gr-row', { hasText: beta })).toHaveCount(0);
  await untouched();

  // Un filtro (pestaña "Unread") tampoco toca el chat abierto; "All chats" saca la carpeta.
  await page.getByRole('tab', { name: 'Unread', exact: true }).click();
  await expect(rows).toHaveAttribute('data-list', /unread/);
  await untouched();
  await page.getByRole('tab', { name: 'All', exact: true }).click();
  await page.getByTestId('lines-folder-current').getByRole('button', { name: 'All chats' }).click();
  await expect(page).not.toHaveURL(/folder=/);
  await expect(page.locator('.gr-row', { hasText: beta }).first()).toBeVisible();
  await untouched();
  // En todo el recorrido no se pidió ninguna página al servidor.
  expect(loads).toEqual([]);

  // El link directo (chat abierto y carpeta) también funciona.
  await page.goto(`${chatUrl}?folder=${folder.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('lines-folder-current')).toContainText(folderName);
  await expect(page.locator('.gr-row', { hasText: alfa })).toBeVisible();
  await expect(threadHead).toContainText(beta);
  await request.delete(`/api/groups/folders?id=${folder.id}`);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('la lista trae más chats al bajar, hasta el final', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const n = await fakeNumber(request, `Linea Larga ${tag}`);
  await inbound(
    request,
    n.webhookUrl,
    Array.from({ length: 75 }, (_, i) => `Largo ${tag} ${String(i).padStart(2, '0')}`),
  );
  // Solo esta línea: 75 chats.
  await request.put('/api/groups/prefs', { data: { line: n.id } });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const rows = page.locator('.gr-rows > .gr-row-item');
  // Primera página: 60. Ya no hay un tope con "Showing 100 of…": el resto llega al bajar.
  await expect(rows).toHaveCount(60);
  await expect(page.getByTestId('lines-list-more')).toHaveCount(1);
  await expect(page.getByText(/Showing \d+ of/)).toHaveCount(0);
  await page.locator('.gr-rows').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(rows).toHaveCount(75);
  await expect(page.getByTestId('lines-list-more')).toHaveCount(0);
  // La API pagina igual: 60 y el cursor, después los 15 que faltan, sin repetidos.
  const first = (await (await request.get(`/api/groups/chats?number=${n.id}&cursor=&limit=60`)).json()) as { rows: Array<{ id: string }>; next: string | null };
  expect(first.rows).toHaveLength(60);
  expect(first.next).toBeTruthy();
  const second = (await (await request.get(`/api/groups/chats?number=${n.id}&cursor=${encodeURIComponent(first.next!)}&limit=60&meta=0`)).json()) as { rows: Array<{ id: string }>; next: string | null };
  expect(second.rows).toHaveLength(15);
  expect(second.next).toBeNull();
  expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(75);
  // Sin ?cursor= sigue como siempre (limit, offset y total).
  const legacy = (await (await request.get(`/api/groups/chats?number=${n.id}&limit=10&offset=70`)).json()) as { rows: unknown[]; total: number };
  expect(legacy.total).toBe(75);
  expect(legacy.rows).toHaveLength(5);
  // Sin cambios, lo que la pantalla consulta cada pocos segundos responde 304.
  await expect
    .poll(async () => {
      const res = await request.get(`/api/groups/chats?number=${n.id}&cursor=&limit=5&meta=0`);
      const etag = res.headers()['etag'] ?? '';
      return (await request.get(`/api/groups/chats?number=${n.id}&cursor=&limit=5&meta=0`, { headers: { 'if-none-match': etag } })).status();
    })
    .toBe(304);
  await request.put('/api/groups/prefs', { data: { line: 'all' } });
  expect(errors, errors.join('\n')).toEqual([]);
});
