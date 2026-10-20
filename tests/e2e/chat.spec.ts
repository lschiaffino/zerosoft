import { expect, test } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);

/**
 * Chat rediseñado: crear un widget es un modal mínimo (también desde
 * /widgets/new), el editor tiene pestañas con un Guardar por pestaña, la
 * bandeja es de tres columnas y las respuestas guardadas derivan el atajo.
 */
test('chat: widget nuevo por modal, editor en pestañas y bandeja de tres columnas', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });

  // /widgets/new abre el modal de nombre y color, no el formulario completo.
  const name = `Soporte ${uid()}`;
  await page.goto('/es/app/chat/widgets/new');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radiogroup')).toBeVisible();
  await expect(dialog.getByLabel('Mensaje de bienvenida')).toHaveCount(0);
  await dialog.getByLabel('Nombre').fill(name);
  await dialog.getByRole('button', { name: 'Crear widget' }).click();
  await page.waitForURL(/\/es\/app\/chat\/widgets\/(?!new$)[^/?]+$/);
  const widgetId = page.url().split('/').pop()!;

  // Editor: pestañas, código arriba, y un Guardar por pestaña.
  const tabs = page.getByRole('navigation', { name: 'Ajustes del widget' });
  await expect(tabs.getByRole('link')).toHaveText(['Apariencia', 'Formulario previo', 'Atributos', 'Bot', 'Horario']);
  await expect(page.locator('.chat-embed-code')).toContainText(`/api/chat/widget.js?id=${widgetId}`);
  await tabs.getByRole('link', { name: 'Bot' }).click();
  await page.waitForURL(/tab=bot/);
  await page.getByRole('switch', { name: 'Bot activado' }).check();
  // La fuente del bot vive en Avanzado.
  await expect(page.getByLabel('Fuente de conocimiento')).toBeHidden();
  await page.getByRole('button', { name: /Avanzado/ }).click();
  await expect(page.getByLabel('Fuente de conocimiento')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Cambios guardados')).toBeVisible();
  const saved = await (await request.get(`/api/chat/widgets/${widgetId}`)).json();
  expect(saved.bot_enabled).toBe(1);

  // La lista se llama Widgets y el sidebar también.
  await page.goto('/es/app/chat/widgets');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Widgets');
  await expect(page.locator('.side-line [aria-current="page"]')).toHaveText(/Widgets/);
  await expect(page.getByRole('link', { name }).first()).toBeVisible();

  // Un visitante escribe: la conversación aparece en la bandeja.
  const visitorBody = `Necesito ayuda con la factura ${uid()}`;
  const res = await request.post('/api/chat/messages', {
    data: { widgetId, visitorId: `e2e-${uid()}`, body: visitorBody, name: 'Ana Prueba', email: 'ana@example.com' },
  });
  expect(res.ok()).toBe(true);

  await page.goto('/es/app/chat/inbox');
  await expect(page.getByRole('heading', { level: 1, name: 'Bandeja' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Elegí una conversación' })).toBeVisible();
  const row = page.locator('.chat-row', { hasText: 'Ana Prueba' });
  await row.click();
  await page.waitForURL(/\/es\/app\/chat\/inbox\/[^/]+$/);
  // Tres columnas: la lista sigue ahí, con la fila marcada; el hilo y los detalles al lado.
  await expect(page.locator('.chat-row[aria-current="page"]')).toContainText('Ana Prueba');
  await expect(page.locator('.chat-message-text', { hasText: visitorBody })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Detalles' })).toBeVisible();

  // Filtros: estado y asignación son independientes.
  await expect(page.locator('.chat-thread-actions').getByRole('combobox', { name: 'Asignada a' })).toHaveValue('');
  await page.locator('#chat-filter-status').selectOption('resolved');
  await expect(page.locator('.chat-row', { hasText: 'Ana Prueba' })).toHaveCount(0);
  await page.locator('#chat-filter-status').selectOption('open');
  await expect(page.locator('.chat-row', { hasText: 'Ana Prueba' })).toBeVisible();

  expect(errors, errors.join('\n')).toEqual([]);
});

test('chat: respuesta guardada con atajo derivado y acciones en Avanzado', async ({ page, request }) => {
  const created = await request.post('/api/chat/widgets', { data: { name: `Canned ${uid()}`, color: '#2f6bff' } });
  const { id } = (await created.json()) as { id: string };

  await page.goto(`/es/app/chat/widgets/${id}/canned`);
  await expect(page.getByRole('heading', { name: 'Todavía no hay respuestas guardadas' })).toBeVisible();
  await page.getByRole('button', { name: 'Crear respuesta' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill('Saludo inicial');
  await expect(dialog.getByLabel('Atajo')).toHaveValue('/saludo-inicial');
  await dialog.getByLabel('Texto').fill('Hola, ¿en qué te ayudo?');
  await expect(dialog.getByLabel('Estado')).toBeHidden();
  await dialog.getByRole('button', { name: /Acciones automáticas/ }).click();
  await expect(dialog.getByLabel('Estado')).toBeVisible();
  await dialog.getByRole('button', { name: 'Crear respuesta' }).click();
  await expect(page.locator('.chat-canned-table')).toContainText('/saludo-inicial');
});

test('chat mobile: la bandeja muestra una columna por vez', async ({ page, request }) => {
  const created = await request.post('/api/chat/widgets', { data: { name: `Mobile ${uid()}` } });
  const { id } = (await created.json()) as { id: string };
  await request.post('/api/chat/messages', { data: { widgetId: id, visitorId: `m-${uid()}`, body: 'Hola desde el celu', name: 'Leo Móvil' } });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/es/app/chat/inbox');
  await expect(page.getByRole('heading', { name: 'Elegí una conversación' })).toBeHidden();
  await page.locator('.chat-row', { hasText: 'Leo Móvil' }).click();
  await page.waitForURL(/\/inbox\/[^/]+$/);
  await expect(page.locator('.chat-inbox-list')).toBeHidden();
  await expect(page.locator('.chat-message-text', { hasText: 'Hola desde el celu' })).toBeVisible();
  // Detalles es un panel que abre y cierra con Esc.
  await page.getByRole('button', { name: 'Detalles' }).click();
  await expect(page.locator('#chat-details')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#chat-details')).toBeHidden();
  await page.getByRole('link', { name: 'Volver a la bandeja' }).click();
  await expect(page.locator('.chat-inbox-list')).toBeVisible();
});
