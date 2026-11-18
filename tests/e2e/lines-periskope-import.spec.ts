import { expect, test, type Page } from '@playwright/test';

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
