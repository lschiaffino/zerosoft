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
    // La app escribe en la misma base: un lock momentáneo se reintenta.
    for (let i = 0; ; i++) {
      try {
        return (await db.execute({ sql: q, args })).rows;
      } catch (err) {
        if (i >= 20 || !String(err).includes('SQLITE_BUSY')) throw err;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
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
  const streamed = page.waitForResponse((r) => r.url().includes('/api/chat/stream'));
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
  await page.getByRole('alertdialog').getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved', { exact: false })).toBeVisible();

  for (const url of [`/api/chat/widgets/${w.id}`, `/api/chat/conversations/${conv.conversation.id}`, `/api/chat/conversations/${conv.conversation.id}/messages`, `/api/chat/widgets/${w.id}/rules`]) {
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
  // Escribir en el chat con un email no suma a nadie: hace falta el consentimiento.
  await ok(request.patch(`/api/chat/visitors/${m.visitor.id}`, { data: { campaignOptIn: true } }));
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
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('1 persona.');
  // Teclado: el foco entra, Esc cierra y Enter confirma.
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await row.getByRole('button', { name: 'Enviar' }).click();
  await expect(dialog).toContainText('1 persona.');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
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

test('campaña: solo con consentimiento; el tope no es un callejón y borrar no libera cupo', async ({ page, request, baseURL }) => {
  const w = await widget(request);
  // Validación del import (sin email válido, sin 500).
  const res = await request.post('/api/chat/import', {
    multipart: {
      widgetId: w.id,
      file: {
        name: 'i.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify([
            { id: uid(), created_at: 1790000000, source: { body: 'a', author: { type: 'user', email: 'not an email <script>', name: 'Mala' } }, conversation_parts: { conversation_parts: [] } },
            { id: uid(), created_at: 1e20, source: { body: 'b', author: { type: 'user', email: `imp${uid()}@x.io`, name: 'Sin Permiso' } }, conversation_parts: { conversation_parts: [] } },
            { id: { raro: 1 }, created_at: 1, source: { body: 'c', author: { type: 'user' } } },
            { session_id: 'x'.repeat(5000), messages: [{ type: 'text', from: 'user', content: 'd' }] },
          ]),
        ),
      },
    },
  });
  expect(res.status()).toBe(201);
  expect(((await res.json()) as { imported: number }).imported).toBe(2);
  expect((await sql('SELECT email FROM chat_visitors WHERE widget_id = ? AND name = ?', [w.id, 'Mala']))[0].email).toBeNull();

  // El POST anónimo con un email ajeno no agrega a nadie a la audiencia.
  await ok(request.post('/api/chat/messages', { data: { widgetId: w.id, visitorId: `e2e-${uid()}`, body: 'hola', email: `ajeno${uid()}@x.io`, campaignOptIn: true } }));
  const name = `Consentimiento ${uid()}`;
  const c = await ok<{ id: string }>(request.post('/api/chat/campaigns', { data: { name, widget_id: w.id, subject: 'Hola', body: 'Texto' } }));
  await page.goto('/es/app/chat/campaigns');
  const row = page.locator('tr', { hasText: name });
  await row.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('2 personas no aceptaron');
  await expect(page.getByRole('alertdialog')).toContainText('Nadie de esta audiencia');
  await page.keyboard.press('Escape');
  expect((await request.post(`/api/chat/campaigns/${c.id}`, { data: { action: 'send' } })).status()).toBe(400);

  // Solo un admin lo marca, desde la ficha, y queda en el registro.
  const person = (await sql('SELECT id FROM chat_visitors WHERE widget_id = ? AND email IS NOT NULL LIMIT 1', [w.id]))[0].id as string;
  await page.goto(`/es/app/chat/people/${person}`);
  await page.getByRole('checkbox', { name: 'Aceptó recibir campañas' }).check();
  await expect.poll(async () => (await sql('SELECT campaign_opt_in_at FROM chat_visitors WHERE id = ?', [person]))[0].campaign_opt_in_at).toBeTruthy();
  expect(Number((await sql("SELECT COUNT(*) AS n FROM chat_audit_log WHERE action = 'visitor.opt_in' AND detail LIKE ?", [`%${person}%`]))[0].n)).toBe(1);

  // Sin cupo: se puede mandar igual, queda esperando y lo dice. Borrar no devuelve cupo.
  const day = new Date().toISOString().slice(0, 10);
  const previous = (await sql("SELECT used FROM chat_campaign_usage WHERE workspace_id = 'demo' AND day = ?", [day]))[0]?.used ?? 0;
  await sql("INSERT INTO chat_campaign_usage (workspace_id, day, used) VALUES ('demo', ?, 500) ON CONFLICT (workspace_id, day) DO UPDATE SET used = 500", [day]);
  try {
    await page.goto('/es/app/chat/campaigns');
    await page.locator('tr', { hasText: name }).getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('siguen cuando se renueva');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await fetch(`${baseURL}/api/cron/minute`, { headers: { authorization: 'Bearer e2e-cron' } });
    await page.reload();
    await expect(page.locator('tr', { hasText: name })).toContainText('sigue mañana');
    expect(Number((await sql("SELECT COUNT(*) AS n FROM chat_campaign_recipients WHERE campaign_id = ? AND status = 'pending'", [c.id]))[0].n)).toBe(1);
    await ok(request.delete(`/api/chat/campaigns/${c.id}`));
    expect(Number((await sql("SELECT used FROM chat_campaign_usage WHERE workspace_id = 'demo' AND day = ?", [day]))[0].used)).toBe(500);
  } finally {
    await sql("UPDATE chat_campaign_usage SET used = ? WHERE workspace_id = 'demo' AND day = ?", [previous as number, day]);
  }
});

test('consentimiento: un miembro no lo puede marcar', async ({ request, browser, baseURL }) => {
  const w = await widget(request);
  const m = await ok<{ visitor: { id: string } }>(request.post('/api/chat/messages', { data: { widgetId: w.id, visitorId: `e2e-${uid()}`, body: 'hola', email: `m${uid()}@x.io` } }));
  const email = `chat-mem-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL! }]);
  const p = await ctx.newPage();
  await p.goto('/en/app', { waitUntil: 'domcontentloaded' });
  const me = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  const team = (await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0]?.id as string;
  await sql("UPDATE users SET onboarded_at = datetime('now'), active_team_id = ? WHERE id = ?", [team, me]);
  await sql("INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '[\"chat\"]')", [team, me]);
  await sql('UPDATE chat_widgets SET team_id = ? WHERE id = ?', [team, w.id]);
  expect((await ctx.request.patch(`/api/chat/visitors/${m.visitor.id}`, { data: { campaignOptIn: true } })).status()).toBe(403);
  await ctx.close();
});

test('layout: Resolver no pisa los detalles y el email corta antes de la arroba', async ({ page, request }) => {
  const w = await widget(request);
  const conv = await ok<{ conversation: { id: string } }>(request.post('/api/chat/messages', { data: { widgetId: w.id, visitorId: `e2e-${uid()}`, body: 'hola', name: 'Larga', email: `una.direccion.muy.larga.para.cortar${uid()}@subdominio.ejemplo-largo.com` } }));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/es/app/chat/inbox/${conv.conversation.id}`);
    const resolve = page.locator('.chat-thread-actions').getByRole('button').last();
    await expect(resolve).toBeVisible();
    const box = (await resolve.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    if (width === 1440) {
      const details = await page.getByRole('complementary', { name: 'Detalles' }).boundingBox();
      if (details) expect(box.x + box.width).toBeLessThanOrEqual(details.x + 1);
    }
    expect(await noScroll(page)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/es/app/chat/inbox/${conv.conversation.id}`);
  await expect(page.locator('dd.chat-email wbr')).toHaveCount(1);
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
  await add('Tour', 'tour', '#precios | Acá están los precios\n#otra | En la otra página\n#titulo | Y este es el título');
  await add('Lista', 'checklist', 'Primeros pasos\nCrear cuenta\nInvitar equipo');
  await add('Post', 'post', 'Novedad grande\nAhora hay más cosas.');
  await add('Barra', 'banner', 'Oferta de hoy');

  // Segunda página del sitio con el elemento del paso que falta en la primera.
  await page.route('http://localhost:3799/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="es"><head><title>Sitio</title></head><body><div id="cabecera" style="position:fixed;top:0;left:0;right:0;height:30px">Fija</div><div id="capa" style="position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none"></div><h1 id="titulo" style="margin-top:40px">Sitio</h1><p id="precios">Precios</p>${route.request().url().includes('/otra') ? '<p id="otra">Otra</p>' : ''}<script src="${baseURL}/api/chat/widget.js?id=${w.id}"></script></body></html>`,
    }),
  );
  await page.goto('http://localhost:3799/inicio');
  const banner = page.locator('[data-zs-banner]');
  await expect(banner).toContainText('Oferta de hoy');
  // La barra baja la página y la cabecera fija, sin mover un overlay a pantalla completa.
  const barBottom = await banner.evaluate((el) => el.getBoundingClientRect().bottom);
  expect(await page.locator('#titulo').evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(barBottom);
  expect(await page.locator('#cabecera').evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(barBottom - 1);
  expect(await page.locator('#capa').evaluate((el) => el.getBoundingClientRect().top)).toBe(0);
  // Al achicar la ventana la barra crece y el empuje acompaña.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(200);
  const narrow = await banner.evaluate((el) => el.getBoundingClientRect().bottom);
  expect(await page.locator('#cabecera').evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(narrow - 1);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Una lista abierta no frena post, tour ni mensajes.
  const checklist = page.locator('[data-zs-checklist]');
  await expect(checklist).toContainText('Invitar equipo');
  const post = page.locator('[data-zs-post]');
  await expect(post).toContainText('Novedad grande');
  await page.keyboard.press('Escape');
  await expect(post).toHaveCount(0);
  await checklist.getByRole('checkbox').first().check();
  await expect(checklist).toContainText('1 de 2');

  // El tour avanza, y el paso que está en otra página espera a esa página.
  const tour = page.locator('[data-zs-tour]');
  await expect(tour).toContainText('Acá están los precios');
  await tour.getByRole('button', { name: 'Siguiente' }).click();
  await expect(tour).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(800);
  await expect(tour).toHaveCount(0);
  await expect(banner).toBeVisible();
  await expect(post).toHaveCount(0);
  await expect(checklist).toContainText('1 de 2');
  await page.goto('http://localhost:3799/otra');
  await expect(tour).toContainText('En la otra página');
  await tour.getByRole('button', { name: 'Siguiente' }).click();
  await expect(tour).toContainText('Y este es el título');
  await tour.getByRole('button', { name: 'Listo' }).click();
  await expect(tour).toHaveCount(0);

  // Cerrar deja la solapa; descartar la saca para siempre.
  await checklist.getByRole('button', { name: /Cerrar|Close/ }).click();
  const tab = page.locator('[data-zs-checklist-tab]');
  await expect(tab).toContainText('1 de 2');
  await tab.click();
  await expect(checklist.getByRole('checkbox').first()).toBeChecked();
  await checklist.getByRole('button', { name: 'Descartar' }).click();
  await banner.getByRole('button').click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(banner).toHaveCount(0);
  await expect(checklist).toHaveCount(0);
  await expect(tab).toHaveCount(0);
  await expect(tour).toHaveCount(0);

  // Un banner vencido no aparece.
  const expired = await widget(request);
  await ok(request.post(`/api/chat/widgets/${expired.id}/outbound`, { data: { name: 'Vieja', format: 'banner', body: 'Vencida', active: true, expiresAt: '2020-01-01T00:00:00.000Z' } }));
  const list = await ok<{ messages: unknown[] }>(request.get(`/api/chat/outbound?widgetId=${expired.id}`));
  expect(list.messages).toEqual([]);
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
