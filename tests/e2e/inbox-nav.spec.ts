import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Inbox: moverse por la bandeja no recarga la pantalla. Cambiar de vista o de
 * carpeta solo cambia la lista: el chat abierto y lo escrito en el composer
 * quedan como están, la URL refleja dónde se está (atrás, adelante y un link
 * directo funcionan) y la lista trae más chats al bajar. Contra el proveedor
 * falso de WhatsApp.
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

async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return { id: String(row.id), secret: String(row.webhook_secret) };
}

async function inbound(request: APIRequestContext, acc: { id: string; secret: string }, chats: Array<{ phone: string; name: string; body: string }>, at: Date = new Date()) {
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, {
    data: {
      events: chats.map((c) => ({
        type: 'message',
        chatId: `${c.phone}@s.whatsapp.net`,
        isGroup: false,
        fromMe: false,
        senderPhone: c.phone,
        senderName: c.name,
        providerMessageId: `nav-${uid()}`,
        body: c.body,
        timestamp: at.toISOString(),
      })),
    },
  });
  expect(res.ok()).toBe(true);
}

/** Pedidos de página al servidor (documento o RSC) para una vista o carpeta de la bandeja. */
function watchPageLoads(page: Page): string[] {
  const loads: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!/\/app\/inbox(\/(v|f)\/[^/]+)?$/.test(url.pathname)) return;
    // Un prefetch (pasar el mouse por un link) no es una navegación.
    if (req.headers()['next-router-prefetch']) return;
    if (req.resourceType() === 'document' || req.headers()['rsc'] === '1') loads.push(url.pathname);
  });
  return loads;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('cambiar de carpeta o de vista solo cambia la lista: el chat abierto y lo escrito siguen; atrás y adelante vuelven', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const tag = uid();
  const ana = `Ana ${tag}`;
  const beto = `Beto ${tag}`;
  await inbound(request, acc, [
    { phone: phone(), name: ana, body: 'Hola, ¿tenés un minuto?' },
    { phone: phone(), name: beto, body: 'Te mando el presupuesto' },
  ]);
  const folderName = `Clientes ${tag}`;
  const folder = ((await (await request.post('/api/inbox/folders', { data: { name: folderName } })).json()) as { folder: { id: string } }).folder;
  const found = (await (await request.get(`/api/inbox/threads?q=${encodeURIComponent(ana)}`)).json()) as { threads: Array<{ id: string; title: string }> };
  const anaId = found.threads.find((t) => t.title === ana)!.id;
  const added = await request.post('/api/inbox/threads', { data: { ids: [anaId], action: 'addFolder', folderId: folder.id } });
  expect(added.ok(), await added.text()).toBe(true);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: beto }).locator('.ib-row-btn').click();
  const field = page.getByRole('textbox', { name: 'Message' });
  await expect(field).toBeVisible();
  await field.fill('borrador sin mandar');
  const threadHead = page.locator('.ib-convo-pane .gr-thread-head');
  await expect(threadHead).toContainText(beto);
  // Marcas en la pantalla y en el encabezado del chat: si algo se vuelve a montar, se pierden.
  const head = await threadHead.elementHandle();
  expect(head).not.toBeNull();
  await page.evaluate(() => {
    (document.querySelector('.ib-app') as HTMLElement).dataset.mark = 'app';
    (document.querySelector('.ib-convo-pane .gr-thread-head') as HTMLElement).dataset.mark = 'head';
  });
  const marks = () =>
    page.evaluate(() => [
      (document.querySelector('.ib-app') as HTMLElement | null)?.dataset.mark ?? '',
      (document.querySelector('.ib-convo-pane .gr-thread-head') as HTMLElement | null)?.dataset.mark ?? '',
    ]);
  /** Nada se volvió a montar y lo escrito sigue. */
  const untouched = async () => {
    await expect(field).toHaveValue('borrador sin mandar');
    expect(await marks()).toEqual(['app', 'head']);
    expect(await head!.evaluate((el) => el.isConnected)).toBe(true);
    await expect(threadHead).toContainText(beto);
  };
  const loads = watchPageLoads(page);
  const side = page.locator('#side-branch');
  const tabs = page.locator('.ib-tabs');
  const list = page.locator('.ib-list');

  // Carpeta del sidebar: la URL cambia, la lista es la de la carpeta y nada más se toca.
  await side.getByRole('link', { name: folderName }).click();
  await expect(page).toHaveURL(new RegExp(`/en/app/inbox/f/${folder.id}\\?t=`));
  await expect(page.getByRole('heading', { level: 1, name: folderName })).toBeVisible();
  await expect(side.getByRole('link', { name: folderName })).toHaveAttribute('aria-current', 'page');
  await expect(list).toHaveAttribute('data-list', `f:${folder.id}|`);
  await expect(page.locator('.ib-item', { hasText: ana })).toBeVisible();
  await expect(page.locator('.ib-item', { hasText: beto })).toHaveCount(0);
  await expect(page).toHaveTitle(new RegExp(folderName));
  await untouched();

  // Atrás: la bandeja.
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/app\/inbox(\?|$)/);
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await expect(list).toHaveAttribute('data-list', 'v:inbox|');
  await expect(page.locator('.ib-item', { hasText: beto })).toBeVisible();
  await untouched();

  // Una pestaña (otra vista): lo mismo. El chat abierto ya está leído, así que no está en "No leídos" y sigue abierto.
  await tabs.getByRole('link', { name: 'Unread' }).click();
  await expect(page).toHaveURL(/\/en\/app\/inbox\/v\/unread\?t=/);
  await expect(tabs.getByRole('link', { name: 'Unread' })).toHaveAttribute('aria-current', 'page');
  await expect(list).toHaveAttribute('data-list', 'v:unread|');
  await expect(page.locator('.ib-item', { hasText: ana })).toBeVisible();
  await expect(page.locator('.ib-item', { hasText: beto })).toHaveCount(0);
  await untouched();

  // De la vista a la carpeta (ya vista: queda en memoria) y de vuelta con atrás y adelante.
  await side.getByRole('link', { name: folderName }).click();
  await expect(list).toHaveAttribute('data-list', `f:${folder.id}|`);
  await expect(page.locator('.ib-item', { hasText: ana })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/app\/inbox\/v\/unread/);
  await expect(tabs.getByRole('link', { name: 'Unread' })).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/app\/inbox(\?|$)/);
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/en\/app\/inbox\/v\/unread/);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/en/app/inbox/f/${folder.id}`));
  await expect(page.getByRole('heading', { level: 1, name: folderName })).toBeVisible();
  await expect(list).toHaveAttribute('data-list', `f:${folder.id}|`);
  await expect(page.locator('.ib-item', { hasText: beto })).toHaveCount(0);
  await untouched();
  // En todo el recorrido no se pidió ninguna página al servidor.
  expect(loads).toEqual([]);

  // El link directo a la carpeta, con el chat abierto, también funciona.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: folderName })).toBeVisible();
  await expect(page.locator('.ib-item', { hasText: ana })).toBeVisible();
  await expect(threadHead).toContainText(beto);
  await request.delete(`/api/inbox/folders/${folder.id}`);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('la lista trae más chats al bajar, hasta el final', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const tag = uid();
  const base = 54_911_300_000_000 + Math.floor(Math.random() * 90_000) * 100;
  await inbound(
    request,
    acc,
    Array.from({ length: 75 }, (_, i) => ({ phone: String(base + i), name: `Largo ${tag} ${String(i).padStart(2, '0')}`, body: `mensaje ${i}` })),
    // Viejos: la cuenta es compartida y 75 chats de hoy dejarían fuera de la primera página a los de otros specs.
    new Date('2016-03-01T12:00:00Z'),
  );
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('#ib-search').fill(`Largo ${tag}`);
  const list = page.locator('.ib-list');
  // La lista en pantalla ya es la de la búsqueda.
  await expect(list).toHaveAttribute('data-list', `v:inbox|Largo ${tag}`);
  const rows = page.locator('.ib-list > .ib-item');
  // Primera página: 60. El resto llega al bajar.
  await expect(rows).toHaveCount(60);
  await expect(page.getByTestId('inbox-list-more')).toHaveCount(1);
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(rows).toHaveCount(75);
  await expect(page.getByTestId('inbox-list-more')).toHaveCount(0);
  // La API pagina igual: 60 y el cursor, después los 15 que faltan, sin repetidos.
  const q = encodeURIComponent(`Largo ${tag}`);
  const first = (await (await request.get(`/api/inbox/threads?q=${q}&cursor=`)).json()) as { threads: Array<{ id: string }>; next: string | null };
  expect(first.threads).toHaveLength(60);
  expect(first.next).toBeTruthy();
  const second = (await (await request.get(`/api/inbox/threads?q=${q}&cursor=${encodeURIComponent(first.next!)}`)).json()) as { threads: Array<{ id: string }>; next: string | null };
  expect(second.threads).toHaveLength(15);
  expect(second.next).toBeNull();
  expect(new Set([...first.threads, ...second.threads].map((t) => t.id)).size).toBe(75);
  // Sin cambios, lo que la pantalla consulta cada pocos segundos responde 304 (otra prueba puede cambiar algo en el medio: se reintenta).
  await expect
    .poll(async () => {
      const res = await request.get(`/api/inbox/threads?q=${q}&cursor=&limit=5`);
      const etag = res.headers()['etag'] ?? '';
      return (await request.get(`/api/inbox/threads?q=${q}&cursor=&limit=5`, { headers: { 'if-none-match': etag } })).status();
    })
    .toBe(304);
  expect(errors, errors.join('\n')).toEqual([]);
});
