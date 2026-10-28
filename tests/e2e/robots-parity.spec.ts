import { createServer, type Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';

/**
 * Robots, tanda de paridad: galería de plantillas, armado con IA (modelo
 * falso de lib/robots-ai.ts, cookie robots_ai_fake=off → ai_disabled),
 * corridas reales en el Chromium local contra un sitio de prueba
 * (ALLOW_PRIVATE_WEBHOOKS=true deja abrir 127.0.0.1), tabla acumulada,
 * envío al CRM, corrida en lote desde un CSV y exportar / importar.
 */

const BASE = Number(process.env.E2E_PORT) || 3210;
const MOCK_PORT = BASE + 13;
const SITE = `http://127.0.0.1:${MOCK_PORT}`;
let server: Server;
/** Versión de los productos: cambia el precio del primero y agrega uno. */
let version = 1;

function products(): Array<{ name: string; price: string; email: string }> {
  const list = [
    { name: 'Product one', price: version === 1 ? '$10' : '$12', email: 'one@shop.test' },
    { name: 'Product two', price: '$20', email: 'two@shop.test' },
    { name: 'Product three', price: '$30', email: 'three@shop.test' },
  ];
  if (version > 1) list.push({ name: 'Product four', price: '$40', email: 'four@shop.test' });
  return list;
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', SITE);
    if (url.pathname === '/shop') {
      const q = url.searchParams.get('q') ?? '';
      const cards = products()
        .map((p) => `<li class="product"><h2 class="name"><a href="/item/${encodeURIComponent(p.name)}">${p.name}</a></h2><span class="price">${p.price}</span><span class="mail">${p.email}</span></li>`)
        .join('');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><head><title>Test shop ${q}</title></head><body><main><h1>Shop ${q}</h1><ul class="products">${cards}</ul></main></body></html>`);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((r) => server.listen(MOCK_PORT, '127.0.0.1', () => r()));
});

test.afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

test.beforeEach(() => {
  version = 1;
});

async function runAndWait(page: Page) {
  await page.getByRole('button', { name: 'Correr robot' }).click();
  const dialogRun = page.getByRole('button', { name: 'Correr ahora' });
  if (await dialogRun.isVisible().catch(() => false)) await dialogRun.click();
  await expect(page.locator('.robots-run-detail .badge').first()).toHaveText(/Exitosa|Con advertencias/, { timeout: 60_000 });
}

test('robots: galería de plantillas con categorías y búsqueda', async ({ page }) => {
  await page.goto('/es/app/robots', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Sitios populares' }).click();
  await expect(page.getByRole('heading', { name: 'Portada de Hacker News' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Llenar un formulario web' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Todas' }).click();
  await page.getByLabel('Buscar plantillas').fill('github');
  await expect(page.getByRole('heading', { name: /GitHub/ })).toHaveCount(2);
  await page.getByLabel('Buscar plantillas').fill('zzzz');
  await expect(page.getByText('Ninguna plantilla coincide')).toBeVisible();
});

test('robots: armar con IA desde una URL, correr y ver la tabla acumulada con cambios', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/es/app/robots', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Armar con IA' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('URL de la página').fill(`${SITE}/shop`);
  await dialog.getByLabel('¿Qué querés de la página?').fill('name and price');
  await dialog.getByRole('button', { name: 'Leer la página' }).click();
  await expect(dialog.getByRole('cell', { name: 'Product one' })).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Crear robot' }).click();
  await expect(page).toHaveURL(/\/app\/robots\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { name: 'Extraer lista' })).toBeVisible();

  await runAndWait(page);
  await page.getByRole('tab', { name: 'Datos' }).click();
  await expect(page.getByRole('cell', { name: 'Product one' })).toBeVisible();
  await expect(page.getByText('3 de 3 filas')).toBeVisible();

  version = 2;
  await page.getByRole('tab', { name: /Corridas/ }).click();
  await runAndWait(page);
  await expect(page.getByText(/Tabla: 1 nuevas · 1 cambiadas · 0 no estaban · 4 en total/)).toBeVisible();
  await page.getByRole('tab', { name: 'Datos' }).click();
  await page.getByRole('button', { name: 'Nuevas' }).click();
  await expect(page.getByRole('cell', { name: 'Product four' })).toBeVisible();
  await expect(page.locator('.robots-data-table tbody tr')).toHaveCount(1);
  const csv = await page.request.get(page.url().replace(/\/es\/app\/robots\/([^/?]+).*/, '/api/robots/$1/rows?filter=all&format=csv'));
  expect(await csv.text()).toContain('Product four');
});

test('robots: la IA apagada muestra ai_disabled al escribir pasos', async ({ page, context, baseURL }) => {
  const res = await page.request.post('/api/robots', { data: { name: 'NL off' } });
  const { id } = (await res.json()) as { id: string };
  await context.addCookies([{ name: 'robots_ai_fake', value: 'off', url: baseURL! }]);
  await page.goto(`/es/app/robots/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Escribir con IA' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('¿Qué tiene que hacer el robot?').fill('Open the shop and extract the products');
  await dialog.getByRole('button', { name: 'Escribir pasos' }).click();
  await expect(dialog.getByRole('alert')).toContainText('La IA está apagada');
});

test('robots: escribir pasos con IA y agregarlos', async ({ page }) => {
  const res = await page.request.post('/api/robots', { data: { name: 'NL on' } });
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/es/app/robots/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Escribir con IA' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('¿Qué tiene que hacer el robot?').fill(`Go to ${SITE}/shop and extract the products, then take a screenshot`);
  await dialog.getByLabel('Página para leer (opcional)').fill('');
  await dialog.getByRole('button', { name: 'Escribir pasos' }).click();
  await expect(dialog.getByText(/pasos listos para agregar/)).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Agregar al final' }).click();
  await expect(page.getByText(/pasos agregados/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Captura' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
});

test('robots: corrida en lote desde un CSV y envío de filas al CRM', async ({ page }) => {
  test.setTimeout(180_000);
  const res = await page.request.post('/api/robots', {
    data: {
      name: 'Shop leads',
      steps: [
        { type: 'goto', url: `${SITE}/shop?q={{inputs.q}}` },
        {
          type: 'extract_list',
          selector: 'li.product',
          name: 'items',
          fields: [
            { name: 'name', selector: 'h2', attribute: '' },
            { name: 'email', selector: '.mail', attribute: '' },
          ],
        },
      ],
      inputs: [{ name: 'q', label: 'Query', kind: 'text', default: '', required: true }],
    },
  });
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/es/app/robots/${id}?tab=integrations`, { waitUntil: 'networkidle' });
  await page.getByLabel('Tipo de destino').selectOption('crm');
  await page.getByRole('button', { name: 'Agregar destino' }).click();
  await page.getByLabel('Email', { exact: true }).fill('email');
  await page.getByLabel('Nombre', { exact: true }).fill('name');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Guardado', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: /Corridas/ }).click();
  await page.getByRole('button', { name: 'Correr en lote' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('O pegá el CSV').fill('q\nshoes\nhats\n');
  await expect(dialog.getByText('2 filas encontradas')).toBeVisible();
  await dialog.getByRole('button', { name: 'Poner 2 corridas en cola' }).click();
  await expect(page.getByText('2 corridas en cola')).toBeVisible();
  await expect(page.locator('.robots-run-item').filter({ hasText: 'Lote' })).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator('.robots-run-item .badge').filter({ hasText: 'Exitosa' })).toHaveCount(2, { timeout: 120_000 });
  await page.locator('.robots-run-item').last().click();
  await expect(page.getByText(/CRM: 3 filas/)).toBeVisible();

  const contacts = await page.request.get('/api/crm/contacts?q=two%40shop.test');
  expect(await contacts.text()).toContain('two@shop.test');
});

test('robots: exportar e importar un robot', async ({ page }) => {
  const res = await page.request.post('/api/robots', { data: { name: 'Exportable', template: 'hackerNews' } });
  const { id } = (await res.json()) as { id: string };
  const file = await page.request.get(`/api/robots/${id}/export`);
  expect(file.headers()['content-disposition']).toContain('.robot.json');
  const body = await file.text();
  expect(JSON.parse(body)).toMatchObject({ zerosoftRobot: 1, name: 'Exportable' });

  await page.goto('/es/app/robots', { waitUntil: 'networkidle' });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar robot' }).click();
  await (await chooser).setFiles({ name: 'exportable.robot.json', mimeType: 'application/json', buffer: Buffer.from(body.replace('"Exportable"', '"Imported copy"')) });
  await expect(page).toHaveURL(/\/app\/robots\/[0-9a-f-]{36}/);
  await expect(page.getByLabel('Nombre del robot')).toHaveValue('Imported copy');
  await expect(page.getByRole('heading', { name: 'Extraer lista' })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`robots: Datos e Integraciones en ${theme} y a 390px sin scroll horizontal`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    const res = await page.request.post('/api/robots', { data: { name: `Mobile ${theme}`, template: 'booksCatalog' } });
    const { id } = (await res.json()) as { id: string };
    await page.setViewportSize({ width: 390, height: 844 });
    for (const tab of ['data', 'integrations', 'advanced', 'steps']) {
      await page.goto(`/es/app/robots/${id}?tab=${tab}`, { waitUntil: 'networkidle' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
      expect(scroll, `${tab}: scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
    }
  });
}
