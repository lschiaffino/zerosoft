import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);

test.use({
  launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'] },
});

async function ok<T = Record<string, unknown>>(res: Promise<APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

async function sql(q: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: q, args })).rows;
  } finally {
    db.close();
  }
}

const widget = (request: APIRequestContext) => ok<{ id: string; name: string }>(request.post('/api/chat/widgets', { data: { name: `Close ${uid()}` } }));

async function host(page: Page, baseURL: string, widgetId: string, extra = '') {
  await page.route('http://localhost:3799/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="es"><head><title>Sitio</title></head><body><h1 id="titulo">Sitio</h1><p id="precios">Precios</p>${extra}<script src="${baseURL}/api/chat/widget.js?id=${widgetId}"></script></body></html>`,
    }),
  );
  await page.goto('http://localhost:3799/inicio');
}

const noScroll = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth + 1);

test('tiempo real: un mensaje del visitante aparece sin esperar el polling', async ({ page, request }) => {
  const w = await widget(request);
  const visitorId = `e2e-${uid()}`;
  const conv = await ok<{ conversation: { id: string } }>(request.post('/api/chat/messages', { data: { widgetId: w.id, visitorId, body: 'primero', name: 'Rita' } }));
  const streamed = page.waitForResponse((r) => r.url().includes(`/api/chat/stream?conversation=${conv.conversation.id}`));
  await page.goto(`/es/app/chat/inbox/${conv.conversation.id}`);
  expect((await streamed).headers()['content-type']).toContain('text/event-stream');
  await expect(page.locator('.chat-message-text', { hasText: 'primero' })).toBeVisible();
  await page.waitForTimeout(1500);
  await ok(request.post('/api/chat/messages', { data: { widgetId: w.id, visitorId, body: 'segundo en vivo' } }));
  // El respaldo con stream conectado corre cada 15 s: en 6 s solo pudo llegar por el aviso.
  await expect(page.locator('.chat-message-text', { hasText: 'segundo en vivo' })).toBeVisible({ timeout: 6000 });
});

test('permisos: una bandeja restringida no se ve, no se abre y no sale en Cmd+K', async ({ page, request, browser, baseURL }) => {
  await page.goto('/en/app', { waitUntil: 'domcontentloaded' });
  const name = `Secret ${uid()}`;
  const w = await ok<{ id: string }>(request.post('/api/chat/widgets', { data: { name } }));
  const email = `chat-acc-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL! }]);
  const p = await ctx.newPage();
  await p.goto('/en/app', { waitUntil: 'domcontentloaded' });
  const me = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  let team = (await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0]?.id as string | undefined;
  if (!team) {
    team = `team-${uid()}`;
    await sql("INSERT INTO teams (id, name, owner_id) VALUES (?, 'Demo team', 'demo')", [team]);
  }
  await sql("UPDATE users SET onboarded_at = datetime('now'), active_team_id = ? WHERE id = ?", [team, me]);
  await sql("INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '[\"chat\"]')", [team, me]);
  await sql('UPDATE chat_widgets SET team_id = ? WHERE id = ?', [team, w.id]);
  const conv = await ok<{ conversation: { id: string } }>(request.post('/api/chat/messages', { data: { widgetId: w.id, visitorId: `e2e-${uid()}`, body: 'privado', name: 'Tito' } }));

  // Sin restricción, la persona la ve.
  expect((await ctx.request.get(`/api/chat/widgets/${w.id}`)).status()).toBe(200);

  // El admin la restringe desde la pantalla. La lista de personas sale del workspace activo.
  await page.goto(`/en/app/chat/widgets/${w.id}/access`);
  await page.getByRole('switch', { name: 'Restrict this inbox' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  for (const url of [`/api/chat/widgets/${w.id}`, `/api/chat/conversations/${conv.conversation.id}`, `/api/chat/conversations/${conv.conversation.id}/messages`, `/api/chat/widgets/${w.id}/rules`, `/api/chat/stream?conversation=${conv.conversation.id}`]) {
    expect((await ctx.request.get(url)).status(), url).toBe(404);
  }
  const list = await (await ctx.request.get('/api/chat/widgets')).json();
  expect(JSON.stringify(list)).not.toContain(w.id);
  const search = await (await ctx.request.get(`/api/search?q=${encodeURIComponent(name)}`)).text();
  expect(search).not.toContain(w.id);
  expect((await ctx.request.put(`/api/chat/widgets/${w.id}/access`, { data: { restricted: false, memberIds: [] } })).status()).toBe(403);

  // Con acceso vuelve a entrar.
  await ok(request.put(`/api/chat/widgets/${w.id}/access`, { data: { restricted: true, memberIds: [me] } }));
  await sql('UPDATE chat_widgets SET team_id = NULL WHERE id = ?', [w.id]);
  await sql('UPDATE chat_widgets SET team_id = ? WHERE id = ?', [team, w.id]);
  await ctx.close();
});

test('ruteo: habilidad y carga desde la pantalla de equipos y la regla', async ({ page, request }) => {
  const w = await widget(request);
  await page.goto('/es/app/chat/teams');
  const skills = page.getByRole('textbox', { name: /^Habilidades de/ }).first();
  await skills.fill('facturación, inglés');
  await skills.blur();
  await expect(page.getByRole('status').filter({ hasText: 'Guardado' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: /^Habilidades de/ }).first()).toHaveValue('facturación, inglés');

  const rule = await ok<{ id: string; required_skill: string }>(
    request.post(`/api/chat/widgets/${w.id}/rules`, { data: { name: 'Facturas', matchType: 'keyword', matchValue: 'factura', requiredSkill: 'Facturación' } }),
  );
  expect(rule.required_skill).toBe('facturación');
  const res = await ok<{ conversation: { id: string; assigned_to?: string } }>(request.post('/api/chat/messages', { data: { widgetId: w.id, visitorId: `e2e-${uid()}`, body: 'mi factura' } }));
  await page.goto(`/es/app/chat/widgets/${w.id}/rules`);
  await expect(page.getByText('Facturas')).toBeVisible();
  const conv = await ok<{ assigned_to: string | null }>(request.get(`/api/chat/conversations/${res.conversation.id}`));
  expect(conv.assigned_to).toBeTruthy();
});

test('empresas y atributos: crear, asignar a una persona y reflejarlo en la lista', async ({ page, request }) => {
  const w = await widget(request);
  const conv = await ok<{ visitor: { id: string } }>(request.post('/api/chat/messages', { data: { widgetId: w.id, visitorId: `e2e-${uid()}`, body: 'hola', name: 'Lola', email: `l${uid()}@x.io` } }));
  const name = `Acme ${uid()}`;
  await page.goto('/es/app/chat');
  await page.locator('a[href="/es/app/chat/companies"]').first().click();
  await page.waitForURL(/chat\/companies/);
  await expect(page.locator('a[href="/es/app/chat/companies"]').first()).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Nueva empresa' }).first().click();
  await page.getByLabel('Nombre').fill(name);
  await page.getByLabel('Dominio').fill('https://www.acme.com/x');
  await page.getByRole('button', { name: 'Crear empresa' }).click();
  const row = page.locator('tr', { hasText: name });
  await expect(row).toContainText('acme.com');

  await page.goto(`/es/app/chat/people/${conv.visitor.id}`);
  await page.getByLabel('Empresa').selectOption({ label: name });
  await page.getByRole('textbox', { name: 'Nombre' }).fill('plan');
  await page.getByRole('textbox', { name: 'Valor' }).fill('pro');
  await page.getByRole('button', { name: 'Agregar' }).click();
  await expect(page.getByText('pro', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Empresa').locator('option:checked')).toHaveText(name);
  await expect(page.getByText('pro', { exact: true })).toBeVisible();

  await page.goto('/es/app/chat/companies');
  await expect(page.locator('tr', { hasText: name }).locator('td').nth(3)).toHaveText('1');
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await noScroll(page)).toBe(true);
});

test('reporte propio: crearlo lo corre, se reabre desde el link y baja CSV', async ({ page, request }) => {
  const w = await widget(request);
  await ok(request.post('/api/chat/messages', { data: { widgetId: w.id, visitorId: `e2e-${uid()}`, body: 'consulta sobre envíos' } }));
  const name = `Por widget ${uid()}`;
  await page.goto('/es/app/chat/reports');
  await page.getByRole('link', { name: 'Reportes propios' }).click();
  await page.getByRole('button', { name: 'Nuevo reporte' }).first().click();
  await page.getByLabel('Nombre').fill(name);
  await page.getByLabel('Agrupar por').selectOption('widget');
  await page.getByRole('button', { name: 'Crear reporte' }).click();
  const result = page.getByRole('region', { name });
  await expect(result.locator('tr', { hasText: w.name })).toBeVisible();
  const id = (await ok<{ reports: Array<{ id: string; name: string }> }>(request.get('/api/chat/custom-reports'))).reports.find((r) => r.name === name)!.id;
  await page.goto(`/es/app/chat/reports/custom?report=${id}`);
  await expect(page.getByRole('region', { name }).locator('tr', { hasText: w.name })).toBeVisible();
  const csv = await request.get(`/api/chat/custom-reports/${id}?format=csv`);
  expect(await csv.text()).toContain(w.name);
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await noScroll(page)).toBe(true);
});

test('campaña: borrador, envío con confirmación, resultado y baja por el link', async ({ page, request, baseURL }) => {
  const w = await widget(request);
  const email = `camp-${uid()}@x.io`;
  const m = await ok<{ visitor: { id: string } }>(request.post('/api/chat/messages', { data: { widgetId: w.id, visitorId: `e2e-${uid()}`, body: 'hola', name: 'Cami', email } }));
  const name = `Novedades ${uid()}`;
  await page.goto('/es/app/chat/campaigns');
  await page.getByRole('button', { name: 'Nueva campaña' }).first().click();
  await page.getByLabel('Nombre').fill(name);
  await page.getByLabel('Widget').selectOption(w.id);
  await page.getByLabel('Asunto').fill('Hola {{first_name|che}}');
  await page.getByLabel('Mensaje').fill('Tenemos novedades.');
  await page.getByRole('button', { name: 'Crear borrador' }).click();
  const row = page.locator('tr', { hasText: name });
  await expect(row).toContainText('Borrador');
  await row.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByRole('dialog')).toContainText('1 persona.');
  await page.getByRole('dialog').getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row).toContainText(/Enviando|Enviada/);
  await expect(async () => {
    await page.reload();
    await expect(page.locator('tr', { hasText: name })).toContainText('1 de 1 enviados', { timeout: 1500 });
  }).toPass({ timeout: 20000 });

  // Baja: el link del token confirma por GET y da de baja por POST.
  const row2 = (await sql('SELECT id FROM chat_campaigns WHERE name = ?', [name]))[0];
  expect(row2).toBeTruthy();
  const mail = (await import('fs')).readFileSync(process.env.E2E_MAIL_FILE!, 'utf8').split('\n').filter((l) => l.includes(email)).pop()!;
  const parsed = JSON.parse(mail) as { subject: string; text: string };
  expect(parsed.subject).toBe('Hola Cami');
  const link = /Unsubscribe: (\S+)/.exec(parsed.text)![1].replace(/^https?:\/\/[^/]+/, baseURL!);
  await page.goto(link);
  await page.getByRole('button').click();
  await expect(page.locator('body')).toContainText(/Done|Listo|Pronto/);
  const v = await sql('SELECT unsubscribed_at FROM chat_visitors WHERE id = ?', [m.visitor.id]);
  expect(v[0].unsubscribed_at).toBeTruthy();
});

test('importar: un archivo de Intercom entra a la bandeja y dos veces no duplica', async ({ page, request }) => {
  const w = await widget(request);
  const marker = `pedido ${uid()}`;
  const file = {
    name: 'intercom.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        conversations: [
          { id: uid(), created_at: 1790000000, state: 'open', source: { body: `<p>${marker}</p>`, author: { type: 'user', name: 'Imp Ortada', email: 'imp@x.io' } }, conversation_parts: { conversation_parts: [] } },
        ],
      }),
    ),
  };
  await page.goto('/es/app/chat/import');
  await page.getByLabel('Al widget').selectOption(w.id);
  await page.getByLabel('Archivo JSON').setInputFiles(file);
  await page.getByRole('button', { name: 'Importar' }).click();
  await expect(page.getByText(/1 importadas, 0 ya estaban/)).toBeVisible();
  await page.getByRole('button', { name: 'Importar' }).click();
  await expect(page.getByText(/0 importadas, 1 ya estaban/)).toBeVisible();
  await page.getByLabel('Archivo JSON').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('nope') });
  await page.getByRole('button', { name: 'Importar' }).click();
  await expect(page.getByText('Ese archivo no es JSON válido.')).toBeVisible();
  await page.goto(`/es/app/chat/inbox?q=${encodeURIComponent(marker)}`);
  await expect(page.locator('.chat-row', { hasText: 'Imp Ortada' })).toBeVisible();
});

test('contenido en la página: banner, post, checklist y tour como visitante', async ({ page, request, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const w = await widget(request);
  const add = (name: string, format: string, body: string) =>
    ok(request.post(`/api/chat/widgets/${w.id}/outbound`, { data: { name, format, body, active: true } }));
  await add('Tour', 'tour', '#precios | Acá están los precios\n#noexiste | Se saltea\n#titulo | Y este es el título');
  await add('Lista', 'checklist', 'Primeros pasos\nCrear cuenta\nInvitar equipo');
  await add('Post', 'post', 'Novedad grande\nAhora hay más cosas.');
  await add('Barra', 'banner', 'Oferta de hoy');

  await host(page, baseURL!, w.id);
  await expect(page.locator('[data-zs-banner]')).toContainText('Oferta de hoy');
  const post = page.locator('[data-zs-post]');
  await expect(post).toContainText('Novedad grande');
  await page.keyboard.press('Escape');
  await expect(post).toHaveCount(0);
  const checklist = page.locator('[data-zs-checklist]');
  await expect(checklist).toContainText('Invitar equipo');
  await checklist.getByRole('checkbox').first().check();
  await expect(checklist).toContainText('1 de 2');
  await checklist.getByRole('button', { name: /Cerrar|Close/ }).click();

  await page.reload();
  // Cada cosa se muestra una vez por visitante: sigue el tour.
  const tour = page.locator('[data-zs-tour]');
  await expect(tour).toContainText('Acá están los precios');
  await tour.getByRole('button', { name: 'Siguiente' }).click();
  await expect(tour).toContainText('Y este es el título');
  await tour.getByRole('button', { name: 'Listo' }).click();
  await expect(tour).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);

  // Editor: los tipos nuevos se eligen en el formulario.
  await page.goto(`/es/app/chat/widgets/${w.id}/outbound`);
  await expect(page.locator('tr', { hasText: 'Barra' })).toContainText('Banner');
});

test('messenger en otro idioma: un navegador en francés lo ve en francés', async ({ browser, request, baseURL }) => {
  const w = await widget(request);
  const ctx = await browser.newContext({ locale: 'fr-FR' });
  const page = await ctx.newPage();
  await page.route('http://localhost:3799/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><script src="${baseURL}/api/chat/widget.js?id=${w.id}"></script></body></html>` }),
  );
  await page.goto('http://localhost:3799/');
  const label = await page.evaluate(() => (document.querySelector('button[aria-label]') as HTMLElement | null)?.getAttribute('aria-label'));
  expect(label).toBeTruthy();
  expect(label).not.toBe('Open chat');
  await ctx.close();
});
