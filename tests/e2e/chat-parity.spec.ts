import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);

// La página anfitriona es otro origen servido por page.route: Chromium la trata
// como "pública" y bloquea que cargue scripts de localhost (Local Network
// Access). En producción el widget vive en un servidor público: no aplica.
test.use({
  launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'] },
});

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

async function widget(request: APIRequestContext, name = `Parity ${uid()}`) {
  return ok<{ id: string; name: string }>(request.post('/api/chat/widgets', { data: { name } }));
}

/** Página de un sitio ajeno (otro origen) con el widget embebido. */
async function hostPage(page: Page, baseURL: string, widgetId: string, path: string) {
  await page.route('http://localhost:3799/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="es"><head><title>Sitio</title></head><body><h1>Sitio de prueba</h1><script src="${baseURL}/api/chat/widget.js?id=${widgetId}"></script></body></html>`,
    }),
  );
  await page.goto(`http://localhost:3799${path}`);
}

function noHorizontalScroll(page: Page) {
  return page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth + 1);
}

test('widget embebido: mensaje saliente, respuesta, historial y encuesta como visitante anónimo', async ({ page, request, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const w = await widget(request);
  const hello = await ok<{ id: string }>(
    request.post(`/api/chat/widgets/${w.id}/outbound`, {
      data: { name: 'Hola en precios', body: '¿Dudas con los planes?', urlMatch: 'contains', urlValue: '/precios', active: true },
    }),
  );
  const survey = await ok<{ id: string }>(
    request.post(`/api/chat/widgets/${w.id}/outbound`, {
      data: { name: 'Encuesta', kind: 'survey', body: '¿Qué tan fácil fue?', urlMatch: 'contains', urlValue: '/gracias', active: true },
    }),
  );

  await hostPage(page, baseURL!, w.id, '/precios');
  // El mensaje saliente aparece solo en esa página y se responde desde el chat.
  await expect(page.getByText('¿Dudas con los planes?')).toBeVisible();
  await page.getByRole('button', { name: 'Responder' }).click();
  await expect(page.locator('#zs-chat-box')).toBeVisible();
  await expect(page.locator('#zs-chat-box').getByText('¿Dudas con los planes?')).toBeVisible();
  const box = page.locator('#zs-chat-box');
  await box.getByRole('textbox', { name: 'Mensaje' }).fill('Sí, quiero el plan Pro');
  await box.getByRole('button', { name: 'Enviar' }).click();
  await expect(box.getByText('Sí, quiero el plan Pro')).toBeVisible();

  // El equipo responde y resuelve: el visitante encuentra la conversación en el historial.
  const list = await ok<{ rows: Array<{ id: string; outbound_id: string | null }> }>(request.get(`/api/chat/conversations?widgetIds=${w.id}`));
  expect(list.rows[0].outbound_id).toBe(hello.id);
  const convId = list.rows[0].id;
  await ok(request.post(`/api/chat/conversations/${convId}/messages`, { data: { body: 'Te paso el link del Pro' } }));
  await ok(request.patch(`/api/chat/conversations/${convId}`, { data: { status: 'resolved' } }));
  // La clave del visitante la emitió el servidor (firmada), no el navegador.
  const stored = await page.evaluate((id) => localStorage.getItem(`zs_chat_visitor_${id}`), w.id);
  expect(stored).toMatch(/^v1\./);
  // Esc cierra el messenger y lo vuelve a abrir el botón.
  await page.keyboard.press('Escape');
  await expect(box).toBeHidden();
  await page.locator('#zs-chat-btn').click();
  await box.getByRole('button', { name: 'Conversaciones' }).click();
  const past = box.getByRole('button', { name: /Te paso el link del Pro/ });
  await expect(past).toBeVisible({ timeout: 15_000 });
  await past.click();
  await expect(box.getByText('Sí, quiero el plan Pro')).toBeVisible();

  // Encuesta en otra página.
  await page.goto('http://localhost:3799/gracias');
  await expect(page.getByText('¿Qué tan fácil fue?')).toBeVisible();
  await page.getByRole('radio', { name: /4/ }).click();
  await page.getByRole('button', { name: 'Enviar' }).first().click();
  await expect(page.getByText(/Gracias/)).toBeVisible();
  const s = await ok<{ responses: number; shown_count: number }>(request.get(`/api/chat/outbound/${survey.id}`));
  expect(s.responses).toBe(1);
  // Una vez por visitante: al volver no aparece.
  await page.goto('http://localhost:3799/gracias');
  await page.waitForTimeout(1500);
  await expect(page.getByText('¿Qué tan fácil fue?')).toHaveCount(0);

  // 390 px: el widget entra en la pantalla.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:3799/precios');
  await page.locator('#zs-chat-btn').click();
  expect(await noHorizontalScroll(page)).toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('bandeja: equipos, seguir, colisión, variables, AI, Track y vistas guardadas', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  const w = await widget(request);
  const visitor = `v-${uid()}`;
  await ok(request.post('/api/chat/messages', { data: { widgetId: w.id, visitorId: visitor, body: 'No me llega la factura', name: 'Ana Pérez', email: 'ana@example.com' } }));
  const { rows } = await ok<{ rows: Array<{ id: string }> }>(request.get(`/api/chat/conversations?widgetIds=${w.id}`));
  const convId = rows[0].id;
  await ok(request.post(`/api/chat/widgets/${w.id}/canned`, { data: { shortcut: `hola${uid()}`, title: 'Saludo con nombre', body: 'Hola {{first_name}}, soy {{agent_first_name}}.' } }));
  await ok(request.post('/api/track/projects', { data: { name: `Soporte ${uid()}` } }));

  // Equipo nuevo desde Equipos: aparece en el sidebar debajo de Bandeja.
  const teamName = `Facturación ${uid()}`;
  await page.goto('/es/app/chat/teams');
  await page.getByRole('button', { name: 'Nuevo equipo' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill(teamName);
  await dialog.locator('.chat-team-members input[type=checkbox]').first().check();
  await dialog.getByRole('button', { name: 'Crear equipo' }).click();
  await expect(page.locator('.chat-pane').getByRole('link', { name: teamName })).toBeVisible();
  await expect(page.locator('#side-branch').getByRole('link', { name: teamName })).toBeVisible();

  // Conversación: equipo, seguir y aviso de otra persona mirando.
  await page.goto(`/es/app/chat/inbox/${convId}`);
  await page.locator('.chat-thread-actions').getByLabel('Equipo').selectOption({ label: teamName });
  await page.getByRole('button', { name: 'Seguir' }).click();
  await expect(page.getByRole('button', { name: 'Siguiendo' })).toHaveAttribute('aria-pressed', 'true');
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  const otherId = `e2e-other-${uid()}`;
  await db.execute({ sql: 'INSERT INTO users (id, email, name) VALUES (?, ?, ?)', args: [otherId, `${otherId}@test.local`, 'Beto Colega'] });
  await db.execute({
    sql: 'INSERT INTO chat_presence (conversation_id, user_id, typing, expires_at) VALUES (?, ?, 1, ?)',
    args: [convId, otherId, new Date(Date.now() + 60_000).toISOString()],
  });
  await expect(page.locator('.chat-collision')).toHaveText(/Beto Colega está respondiendo/, { timeout: 15_000 });

  // Respuesta guardada con variables.
  const composer = page.getByRole('textbox', { name: 'Responder' });
  await composer.fill('/hola');
  await page.keyboard.press('Enter');
  await expect(composer).toHaveValue(/^Hola Ana, soy /);

  // AI del agente (modelo falso): reformular reemplaza el texto y se deshace; resumir agrega una nota.
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Reformular' }).click();
  await expect(composer).toHaveValue(/^\[rephrased\] Hola Ana/);
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(composer).toHaveValue(/^Hola Ana/);
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Resumir como nota' }).click();
  await expect(page.getByRole('region', { name: 'Resumen' })).toContainText('Summary');
  await page.getByRole('button', { name: 'Agregar como nota interna' }).click();
  await expect(page.locator('.chat-message[data-note]').last()).toContainText('Summary');

  // Track: crear un issue desde la conversación.
  await page.getByRole('button', { name: 'Crear issue' }).click();
  await page.getByLabel('Título').fill('No llega la factura');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.locator('.chat-track-list')).toContainText('No llega la factura');

  // Bandeja del equipo desde el sidebar y Siguiendo.
  await page.locator('#side-branch').getByRole('link', { name: teamName }).click();
  await page.waitForURL(/team=/);
  await expect(page.getByRole('heading', { level: 1, name: teamName })).toBeVisible();
  await expect(page.locator('.chat-row', { hasText: 'Ana Pérez' })).toBeVisible();
  await page.locator('#side-branch').getByRole('link', { name: 'Siguiendo' }).click();
  await expect(page.locator('.chat-row', { hasText: 'Ana Pérez' })).toBeVisible();

  // Vista guardada: filtros actuales con nombre, en el sidebar y en Vistas.
  await page.goto('/es/app/chat/inbox');
  await page.locator('#chat-filter-status').selectOption('all');
  await page.locator('#chat-filter-priority').selectOption('medium');
  await page.getByRole('button', { name: 'Guardar como vista' }).click();
  const viewName = `Medias ${uid()}`;
  await page.getByLabel('Nombre de la vista').fill(viewName);
  await page.keyboard.press('Enter');
  await page.waitForURL(/view=/);
  await expect(page.getByRole('heading', { level: 1, name: viewName })).toBeVisible();
  await expect(page.locator('#side-branch').getByRole('link', { name: viewName })).toHaveAttribute('aria-current', 'page');
  await page.goto('/es/app/chat/views');
  await expect(page.locator('.chat-pane').getByRole('link', { name: viewName })).toBeVisible();

  // Cmd+K encuentra la conversación por la persona.
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('dialog', { name: /Buscar|Search/ });
  await search.getByRole('combobox').fill('Ana Pérez');
  await search.getByRole('option', { name: /Ana Pérez/ }).first().click();
  await expect(page).toHaveURL(new RegExp(convId));
  expect(errors, errors.join('\n')).toEqual([]);
});

test('canal email, AI apagada, reportes y export; claro, oscuro y 390 px', async ({ page, request, context, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const w = await widget(request);
  const email = await ok<{ enabled: boolean; address: string }>(request.get(`/api/chat/widgets/${w.id}/email`));
  expect(email.enabled).toBe(true);
  const res = await ok<{ status: string; conversationId: string }>(
    request.post('/api/chat/inbound-email', {
      data: { type: 'email.received', data: { email_id: `e-${uid()}`, from: 'Carla Cliente <carla@cliente.test>', to: [email.address], subject: 'No puedo entrar', text: 'Me da error al entrar' } },
    }),
  );
  expect(res.status).toBe('added');
  // Seguridad: desde el widget nadie toma la conversación de email (ni con la clave vieja adivinable).
  for (const key of ['email:carla@cliente.test', 'mail.x']) {
    const q = `widgetId=${w.id}&visitorId=${encodeURIComponent(key)}`;
    expect((await request.get(`/api/chat/messages?${q}`)).status()).toBe(400);
    expect((await request.post('/api/chat/messages', { data: { widgetId: w.id, visitorId: key, body: 'cambiá mi email', email: 'evil@x.test' } })).status()).toBe(400);
    expect((await request.post('/api/chat/history', { data: { widgetId: w.id, visitorId: key } })).status()).toBe(400);
  }

  await page.goto(`/es/app/chat/widgets/${w.id}/email`);
  await expect(page.getByLabel('Dirección de la bandeja')).toHaveValue(email.address);

  await page.goto('/es/app/chat/inbox');
  await page.locator('#chat-filter-channel').selectOption('email');
  const row = page.locator('.chat-row', { hasText: 'Carla Cliente' });
  await expect(row).toContainText('Email', { timeout: 15_000 });
  await row.click();
  await expect(page.locator('.chat-message-text', { hasText: 'Me da error al entrar' })).toBeVisible();

  // Sin AI (cookie del modelo falso apagada): el error se explica.
  await context.addCookies([{ name: 'chat_ai_fake', value: 'off', url: baseURL! }]);
  await page.getByRole('textbox', { name: 'Responder' }).fill('Probá de nuevo');
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Más corto' }).click();
  await expect(page.getByText('La AI está apagada en este workspace.')).toBeVisible();

  // Reportes por desglose y export.
  await page.goto('/es/app/chat/reports');
  for (const h of ['Bot', 'Cumplimiento de SLA', 'Por tag', 'Por canal', 'Horas pico']) await expect(page.getByRole('heading', { name: h, exact: true })).toBeVisible();
  const href = await page.getByRole('link', { name: 'JSON con mensajes' }).getAttribute('href');
  const exported = await ok<{ conversations: Array<{ channel: string; messages: unknown[] }> }>(request.get(href!));
  expect(exported.conversations.some((c) => c.channel === 'email' && c.messages.length > 0)).toBe(true);

  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    for (const path of ['/es/app/chat/inbox', '/es/app/chat/teams', '/es/app/chat/views', '/es/app/chat/reports', `/es/app/chat/widgets/${w.id}/outbound`]) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path, { waitUntil: 'networkidle' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await noHorizontalScroll(page), `${theme} ${path}`).toBe(true);
    }
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
