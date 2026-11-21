import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines › Ajustes › Migrar de Periskope: vista previa que no escribe, importar
 * etiquetas y respuestas rápidas, y el aviso de una columna que falta. Datos
 * inventados; nada sale a internet.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function openMigrate(page: Page) {
  await page.goto('/en/app/lines/settings?tab=migrate', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('periskope-import')).toBeVisible();
}

async function paste(page: Page, kind: string, csv: string) {
  await page.getByTestId('periskope-kind').selectOption(kind);
  await page.locator('[data-testid="periskope-import"] details > summary').click();
  await page.getByTestId('periskope-csv').fill(csv);
}

/** Aprieta Vista previa o Importar y espera la respuesta del servidor. */
async function run(page: Page, testId: 'periskope-preview' | 'periskope-import-run') {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/groups/periskope') && r.request().method() === 'POST'),
    page.getByTestId(testId).click(),
  ]);
}

test('vista previa sin escribir y después importar etiquetas', async ({ page, request }) => {
  const tag = `Psk ${uid()}`;
  await openMigrate(page);
  await expect(page.getByTestId('periskope-import-run')).toBeDisabled();
  await paste(page, 'labels', `Name,Color\n${tag},#eb5757\n`);
  await run(page, 'periskope-preview');
  const result = page.getByTestId('periskope-result');
  await expect(result).toHaveAttribute('data-dry-run', '1');
  await expect(result).toHaveAttribute('data-applied', '1');
  const before = (await (await request.get('/api/groups/labels')).json()) as { labels?: Array<{ name: string }> } | Array<{ name: string }>;
  const names = (v: typeof before) => (Array.isArray(v) ? v : (v.labels ?? [])).map((l) => l.name);
  expect(names(before)).not.toContain(tag);

  await run(page, 'periskope-import-run');
  await expect(result).toHaveAttribute('data-dry-run', '0');
  await expect(result).toHaveAttribute('data-applied', '1');
  const after = (await (await request.get('/api/groups/labels')).json()) as typeof before;
  expect(names(after)).toContain(tag);
  // Ya importado: Importar queda apagado hasta otra vista previa.
  await expect(page.getByTestId('periskope-import-run')).toBeDisabled();
});

test('respuestas rápidas y una columna que falta', async ({ page }) => {
  const cmd = `psk${uid()}`;
  await openMigrate(page);
  await paste(page, 'quick_replies', `Command,Message\n/${cmd},Texto de prueba\n`);
  await run(page, 'periskope-preview');
  await expect(page.getByTestId('periskope-result')).toHaveAttribute('data-applied', '1');
  await run(page, 'periskope-import-run');
  await expect(page.getByTestId('periskope-result')).toHaveAttribute('data-dry-run', '0');

  // Cambiar el texto borra la vista previa: no se importa algo que no se vio.
  await page.getByTestId('periskope-csv').fill('Foo,Bar\n1,2\n');
  await expect(page.getByTestId('periskope-result')).toHaveCount(0);
  await page.getByTestId('periskope-kind').selectOption('chats');
  await page.getByTestId('periskope-csv').fill('Foo,Bar\n1,2\n');
  await run(page, 'periskope-preview');
  const result = page.getByTestId('periskope-result');
  await expect(result).toHaveAttribute('data-applied', '0');
  await expect(result.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByTestId('periskope-import-run')).toBeDisabled();
});

test('a 390 px no hay scroll lateral', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMigrate(page);
  await paste(page, 'labels', 'Name,Color\nUna etiqueta con un nombre largo para probar,#2f80ed\n');
  await run(page, 'periskope-preview');
  await expect(page.getByTestId('periskope-result')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

/** Un número falso conectado con un chat 1:1, para que la cuenta simulada de Periskope tenga sobre qué aplicarse. */
async function seedChat(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Psk ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const res = await request.post(new URL(webhookUrl).pathname, {
    data: {
      events: [
        { type: 'message', chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: phone, senderName: 'Psk', providerMessageId: `psk-${uid()}`, body: 'hola', timestamp: Date.now() },
      ],
    },
  });
  expect(res.ok()).toBe(true);
}

/** Aprieta un botón de la importación por API y espera la respuesta. */
async function runApi(page: Page, testId: 'periskope-api-preview' | 'periskope-api-run') {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/groups/periskope') && r.request().method() === 'POST'),
    page.getByTestId(testId).click(),
  ]);
}

test('por API: clave rechazada, vista previa, importar y repetir sin duplicar', async ({ page, request }) => {
  test.slow();
  await seedChat(request);
  await openMigrate(page);
  const key = page.getByTestId('periskope-api-key');
  await expect(key).toHaveAttribute('type', 'password');
  await expect(page.getByTestId('periskope-api-preview')).toBeDisabled();

  await key.fill('invalid-key');
  await runApi(page, 'periskope-api-preview');
  await expect(page.getByTestId('periskope-import').getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('periskope-api-result')).toHaveCount(0);

  // Otra clave es otra cuenta simulada: sus tickets y notas son nuevos.
  await key.fill(`psk-${uid()}`);
  await runApi(page, 'periskope-api-preview');
  const result = page.getByTestId('periskope-api-result');
  await expect(result).toHaveAttribute('data-dry-run', '1');
  await expect(result).toHaveAttribute('data-tickets', /[1-9]/);
  await expect(result).toHaveAttribute('data-notes', '1');

  await runApi(page, 'periskope-api-run');
  await expect(result).toHaveAttribute('data-dry-run', '0');
  await expect(result).toHaveAttribute('data-notes', '1');
  await expect(page.getByTestId('periskope-api-run')).toBeDisabled();

  // Otra vista previa con la misma clave: tickets y notas ya están, no se cuentan de nuevo.
  await runApi(page, 'periskope-api-preview');
  await expect(result).toHaveAttribute('data-dry-run', '1');
  await expect(result).toHaveAttribute('data-tickets', '0');
  await expect(result).toHaveAttribute('data-notes', '0');
});
