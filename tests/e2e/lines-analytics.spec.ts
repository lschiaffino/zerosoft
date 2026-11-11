import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines, reportes: el tablero con pestañas (?tab=), filtros, comparación con
 * el período anterior, vacíos y CSV. Contra el proveedor falso; nada sale a
 * WhatsApp. La base es compartida con otras suites: se afirma sobre lo que
 * siembra este archivo (nombres con un tag propio y una línea propia).
 */

const uid = () => Math.random().toString(36).slice(2, 8);

interface NumberInfo {
  id: string;
  name: string;
  webhookUrl: string;
}

async function fakeNumber(request: APIRequestContext, name: string): Promise<NumberInfo> {
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

const message = (chatId: string, body: string, senderName: string, chatName?: string) => ({
  type: 'message',
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  chatName,
  fromMe: false,
  senderPhone: '5491155550000',
  senderName,
  providerMessageId: `la-${uid()}`,
  body,
});

async function chatByName(request: APIRequestContext, q: string): Promise<{ id: string; name: string }> {
  const res = (await (await request.get(`/api/groups/chats?q=${encodeURIComponent(q)}`)).json()) as { rows: Array<{ id: string; name: string }> };
  expect(res.rows.length, `chat ${q}`).toBeGreaterThan(0);
  return res.rows[0];
}

function watchErrors(page: Page): string[] {
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

/** El número de una tarjeta, ya terminado de contar. */
async function kpi(page: Page, label: string): Promise<number> {
  const tile = page.locator(`.la-kpi[data-kpi="${label}"]`);
  await expect(tile).toBeVisible();
  return Number(await tile.locator('.la-num').getAttribute('data-value'));
}

const TABS = [
  ['Overview', null, 'Messages per day'],
  ['Conversations', 'conversations', 'When messages arrive'],
  ['Response', 'response', 'How fast the replies were'],
  ['Team', 'team', 'By person'],
  ['Groups', 'groups', 'Most active groups'],
  ['Broadcasts', 'broadcasts', null],
  ['Tickets and tasks', 'tickets', 'Tickets by priority'],
  ['Labels', 'labels', 'By label'],
] as const;

test.describe.configure({ mode: 'serial' });

let seeded: { line: NumberInfo; tag: string; chatId: string; labelId: string } | null = null;

/** Una línea propia con dos chats, un grupo, una respuesta, un ticket y una etiqueta. */
async function seed(request: APIRequestContext) {
  if (seeded) return seeded;
  const tag = uid();
  const line = await fakeNumber(request, `Reportes ${tag}`);
  const stamp = Date.now().toString().slice(-7);
  await events(request, line, [
    message(`54911${stamp}1@c.us`, 'hola, quiero un presupuesto', `Ines ${tag}`),
    message(`54911${stamp}1@c.us`, 'para 40 unidades', `Ines ${tag}`),
    message(`54911${stamp}2@c.us`, 'buenas', `Joaquin ${tag}`),
    message(`12036${stamp}@g.us`, 'hola grupo', `Vecina ${tag}`, `Consorcio ${tag}`),
  ]);
  const chat = await chatByName(request, `Ines ${tag}`);
  const sent = await request.post(`/api/groups/chats/${chat.id}/messages`, { data: { body: 'Te paso el presupuesto en un rato.' } });
  expect(sent.ok(), await sent.text()).toBe(true);
  const label = (await (await request.post('/api/groups/labels', { data: { name: `Mayoristas ${tag}`, color: 'green' } })).json()) as { id: string };
  await request.patch(`/api/groups/chats/${chat.id}`, { data: { labelIds: [label.id] } });
  const ticket = await request.post('/api/groups/tickets', { data: { chatId: chat.id, title: `Presupuesto ${tag}`, priority: 'high' } });
  expect(ticket.ok(), await ticket.text()).toBe(true);
  seeded = { line, tag, chatId: chat.id, labelId: label.id };
  return seeded;
}

test('tablero: pestañas con URL propia, números de la línea filtrada y sin scroll horizontal', async ({ page, request }) => {
  // Recorre las ocho pestañas dos veces y cinco más a 390 px: más de veinte cargas.
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  const s = await seed(request);
  await page.goto(`/en/app/lines/analytics?number=${s.line.id}`, { waitUntil: 'networkidle' });

  const tabs = page.getByRole('navigation', { name: 'Report sections' });
  await expect(tabs.getByRole('link')).toHaveCount(TABS.length);
  await expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');

  // Resumen: lo que entró y salió por esta línea.
  expect(await kpi(page, 'Received')).toBe(4);
  expect(await kpi(page, 'Sent')).toBe(1);
  expect(await kpi(page, 'Active chats')).toBe(3);
  expect(await kpi(page, 'New chats')).toBe(3);
  expect(await kpi(page, 'Tickets created')).toBe(1);
  // El número termina de contar en el valor real.
  await expect(page.locator('.la-kpi[data-kpi="Received"] .la-num')).toHaveText('4');
  await expect(page.getByRole('img', { name: /^Messages per day/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Most active chats' }).getByRole('link', { name: `Ines ${s.tag}` })).toBeVisible();
  await expect(page.getByRole('region', { name: 'By line' })).toContainText(s.line.name);
  await expect(page.getByRole('status').filter({ hasText: 'Compared with the 30 days before' })).toBeVisible();

  // Cada pestaña tiene su URL, conserva el filtro y muestra lo suyo.
  for (const [name, key, panel] of TABS.slice(1)) {
    await tabs.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]tab=${key}(&|$)`));
    await expect(page).toHaveURL(new RegExp(`number=${s.line.id}`));
    await expect(tabs.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    if (panel) await expect(page.getByRole('region', { name: panel, exact: true })).toBeVisible();
  }

  await page.goto(`/en/app/lines/analytics?tab=conversations&number=${s.line.id}`, { waitUntil: 'networkidle' });
  expect(await kpi(page, 'Received')).toBe(4);
  expect(await kpi(page, 'New groups')).toBe(1);
  await expect(page.getByRole('region', { name: 'When messages arrive' }).getByText(/^Busiest hour: /)).toBeVisible();
  await expect(page.getByRole('region', { name: 'By line', exact: true }).getByRole('row', { name: new RegExp(s.line.name) })).toContainText('100%');

  await page.goto(`/en/app/lines/analytics?tab=response&number=${s.line.id}`, { waitUntil: 'networkidle' });
  expect(await kpi(page, 'First responses')).toBe(1);
  // Dos chats quedaron sin respuesta.
  expect(await kpi(page, 'Not answered in the period')).toBe(2);
  await expect(page.getByRole('region', { name: 'How fast the replies were' })).toContainText('Under 5 min');
  await expect(page.getByRole('region', { name: 'Waiting the longest' }).getByRole('link', { name: `Joaquin ${s.tag}` })).toBeVisible();

  await page.goto(`/en/app/lines/analytics?tab=team&number=${s.line.id}`, { waitUntil: 'networkidle' });
  expect(await kpi(page, 'People who replied')).toBe(1);
  expect(await kpi(page, 'Sent by people')).toBe(1);
  await expect(page.getByRole('region', { name: 'By person' }).getByRole('row')).toHaveCount(2);

  await page.goto(`/en/app/lines/analytics?tab=groups&number=${s.line.id}`, { waitUntil: 'networkidle' });
  expect(await kpi(page, 'Groups')).toBe(1);
  await expect(page.getByRole('region', { name: 'Most active groups' }).getByRole('link', { name: `Consorcio ${s.tag}` })).toBeVisible();

  await page.goto(`/en/app/lines/analytics?tab=tickets&number=${s.line.id}`, { waitUntil: 'networkidle' });
  expect(await kpi(page, 'Tickets created')).toBe(1);
  await expect(page.getByRole('region', { name: 'Tickets by priority' })).toContainText('High');

  await page.goto(`/en/app/lines/analytics?tab=labels&number=${s.line.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('region', { name: 'By label' }).getByRole('row', { name: new RegExp(`Mayoristas ${s.tag}`) })).toBeVisible();

  // Envíos: esta línea no mandó ninguno. Vacío honesto, sin números inventados.
  await page.goto(`/en/app/lines/analytics?tab=broadcasts&number=${s.line.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByText('Nothing in this range')).toBeVisible();
  await expect(page.locator('.la-kpi')).toHaveCount(0);

  // 390 px: las pestañas se desplazan dentro de su fila, la página no.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const key of ['', 'conversations', 'response', 'team', 'tickets']) {
    await page.goto(`/en/app/lines/analytics?number=${s.line.id}${key ? `&tab=${key}` : ''}`, { waitUntil: 'networkidle' });
    await noHorizontalScroll(page);
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('filtros: etiqueta, período, pestaña desconocida y rango sin datos', async ({ page, request }) => {
  const errors = watchErrors(page);
  const s = await seed(request);
  await page.goto('/en/app/lines/analytics?tab=conversations', { waitUntil: 'networkidle' });
  const form = page.getByRole('form', { name: 'Report filters' });
  await form.getByLabel('Label').selectOption(s.labelId);
  await form.getByRole('button', { name: 'Apply' }).click();
  // El filtro no saca de la pestaña.
  await expect(page).toHaveURL(/tab=conversations/);
  await expect(page).toHaveURL(new RegExp(`label=${s.labelId}`));
  expect(await kpi(page, 'Received')).toBe(2);
  expect(await kpi(page, 'Sent')).toBe(1);

  // Período: 7 días, con la etiqueta puesta.
  await page.getByRole('navigation', { name: 'Period' }).getByRole('link', { name: '7 days' }).click();
  await expect(page).toHaveURL(/days=7/);
  await expect(page).toHaveURL(new RegExp(`label=${s.labelId}`));
  await expect(page.getByRole('status').filter({ hasText: 'Compared with the 7 days before' })).toBeVisible();
  expect(await kpi(page, 'Received')).toBe(2);

  // Un rango viejo: vacío, con el aviso de que es por el filtro.
  await page.goto('/en/app/lines/analytics?from=2001-01-01&to=2001-01-31', { waitUntil: 'networkidle' });
  await expect(page.getByText('Showing 2001-01-01 to 2001-01-31')).toBeVisible();
  await expect(page.getByText('Nothing in this range')).toBeVisible();
  await expect(page.locator('.la-kpi')).toHaveCount(0);

  // Una pestaña que no existe abre el resumen; un filtro con un id ajeno se ignora.
  await page.goto('/en/app/lines/analytics?tab=nope&number=no-existe&agent=nadie', { waitUntil: 'networkidle' });
  await expect(page.getByRole('navigation', { name: 'Report sections' }).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('status').filter({ hasText: 'Compared with the 30 days before' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'end date' })).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('CSV de la pestaña y animaciones apagadas con prefers-reduced-motion', async ({ page, request }) => {
  const s = await seed(request);
  const res = await request.get(`/api/groups/analytics?tab=overview&number=${s.line.id}`);
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('text/csv');
  expect(res.headers()['content-disposition']).toMatch(/lines-overview-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv/);
  const lines = (await res.text()).trim().split('\n');
  expect(lines[0]).toBe('day,received,sent,previous_received,previous_sent');
  expect(lines).toHaveLength(31);
  expect(lines.slice(1).reduce((a, l) => a + Number(l.split(',')[1]), 0)).toBe(4);
  const team = await (await request.get(`/api/groups/analytics?tab=team&number=${s.line.id}`)).text();
  expect(team.split('\n')[0]).toContain('messages_sent');
  // El link de la página baja la pestaña que se está mirando.
  await page.goto(`/en/app/lines/analytics?tab=team&number=${s.line.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', new RegExp(`/api/groups/analytics\\?tab=team&number=${s.line.id}`));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/en/app/lines/analytics?number=${s.line.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.la-kpi[data-kpi="Received"] .la-num')).toHaveText('4');
  const animations = await page.evaluate(() =>
    ['.la-kpi', '.la-panel', '.la-line', '.la-bars-fill', '.la-spark'].map((sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).animationName : 'missing';
    }),
  );
  expect(animations).toEqual(['none', 'none', 'none', 'none', 'none']);
});

test('tema oscuro: el tablero se ve y no hay errores', async ({ page, request, context, baseURL }) => {
  const errors = watchErrors(page);
  const s = await seed(request);
  await context.addCookies([{ name: 'zs_theme', value: 'dark', url: baseURL! }]);
  await page.goto(`/en/app/lines/analytics?tab=conversations&number=${s.line.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('img', { name: /^Received and sent per day/ })).toBeVisible();
  // Las tarjetas usan el fondo del tema, no blanco fijo.
  const bg = await page.locator('.la-kpi').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgb(255, 255, 255)');
  expect(errors, errors.join('\n')).toEqual([]);
});
