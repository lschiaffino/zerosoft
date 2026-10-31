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
  await expect(page.getByText('Saved')).toBeVisible();

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

test('campaña: los importados sin consentimiento quedan afuera, con el motivo en pantalla, y el tope corta el envío', async ({ page, request }) => {
  const w = await widget(request);
  const bad = 'not an email <script>';
  const res = await request.post('/api/chat/import', {
    multipart: {
      widgetId: w.id,
      file: {
        name: 'i.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify([
            { id: uid(), created_at: 1790000000, source: { body: 'a', author: { type: 'user', email: bad, name: 'Mala' } }, conversation_parts: { conversation_parts: [] } },
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

  const name = `Sin importados ${uid()}`;
  const c = await ok<{ id: string }>(request.post('/api/chat/campaigns', { data: { name, widget_id: w.id, subject: 'Hola', body: 'Texto' } }));
  await page.goto('/es/app/chat/campaigns');
  await page.locator('tr', { hasText: name }).getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByRole('dialog')).toContainText('1 persona importada queda afuera');
  await expect(page.getByRole('dialog')).toContainText('Nadie de esta audiencia');
  await page.keyboard.press('Escape');
  expect((await request.post(`/api/chat/campaigns/${c.id}`, { data: { action: 'send' } })).status()).toBe(400);

  // Con consentimiento entra.
  const imported = (await sql('SELECT id FROM chat_visitors WHERE widget_id = ? AND email IS NOT NULL', [w.id]))[0].id as string;
  await page.goto(`/es/app/chat/people/${imported}`);
  await page.getByRole('checkbox', { name: 'Aceptó recibir campañas' }).check();
  await expect.poll(async () => (await sql('SELECT campaign_opt_in_at FROM chat_visitors WHERE id = ?', [imported]))[0].campaign_opt_in_at).toBeTruthy();

  // Tope: una campaña enviada que ya usó todo el cupo de hoy frena la siguiente, con el motivo.
  await sql("INSERT INTO chat_campaigns (id, workspace_id, widget_id, name, status, total, sent_at) VALUES (?, 'demo', ?, 'Grande', 'sent', 500, ?)", [`big-${uid()}`, w.id, new Date().toISOString()]);
  const over = await request.post(`/api/chat/campaigns/${c.id}`, { data: { action: 'send' } });
  expect(over.status()).toBe(429);
  expect(((await over.json()) as { error: string }).error).toBe('daily_cap');
  await page.goto('/es/app/chat/campaigns');
  await page.locator('tr', { hasText: name }).getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByRole('dialog')).toContainText('pasa el límite');
  await sql("DELETE FROM chat_campaigns WHERE name = 'Grande' AND widget_id = ?", [w.id]);
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
  await add('Tour', 'tour', '#precios | Acá están los precios\n#noexiste | Se saltea\n#titulo | Y este es el título');
  await add('Lista', 'checklist', 'Primeros pasos\nCrear cuenta\nInvitar equipo');
  await add('Post', 'post', 'Novedad grande\nAhora hay más cosas.');
  await add('Barra', 'banner', 'Oferta de hoy');

  await host(page, baseURL!, w.id);
  const banner = page.locator('[data-zs-banner]');
  await expect(banner).toContainText('Oferta de hoy');
  // La barra baja la página en lugar de taparla.
  const titleTop = await page.locator('#titulo').evaluate((el) => el.getBoundingClientRect().top);
  const barHeight = await banner.evaluate((el) => el.getBoundingClientRect().bottom);
  expect(titleTop).toBeGreaterThanOrEqual(barHeight);
  const post = page.locator('[data-zs-post]');
  await expect(post).toContainText('Novedad grande');
  await page.keyboard.press('Escape');
  await expect(post).toHaveCount(0);

  // Checklist: el avance se guarda, cerrarla deja una solapa y sigue al recargar.
  const checklist = page.locator('[data-zs-checklist]');
  await expect(checklist).toContainText('Invitar equipo');
  await checklist.getByRole('checkbox').first().check();
  await expect(checklist).toContainText('1 de 2');
  await checklist.getByRole('button', { name: /Cerrar|Close/ }).click();
  const tab = page.locator('[data-zs-checklist-tab]');
  await expect(tab).toContainText('1 de 2');

  // La tour se muestra después y se retoma donde quedó.
  const tour = page.locator('[data-zs-tour]');
  await expect(tour).toContainText('Acá están los precios');
  await tour.getByRole('button', { name: 'Siguiente' }).click();
  await expect(tour).toContainText('Y este es el título');
  await page.reload();
  // La barra sigue, la lista sigue minimizada y el tour vuelve en el paso donde estaba.
  await expect(banner).toBeVisible();
  await expect(tab).toContainText('1 de 2');
  await expect(post).toHaveCount(0);
  await expect(tour).toContainText('Y este es el título');
  await tour.getByRole('button', { name: 'Listo' }).click();
  await expect(tour).toHaveCount(0);

  // Reabrir la lista muestra el avance y descartarla la saca para siempre.
  await tab.click();
  await expect(checklist).toContainText('1 de 2');
  await expect(checklist.getByRole('checkbox').first()).toBeChecked();
  await checklist.getByRole('button', { name: 'Descartar' }).click();
  await banner.getByRole('button').click();
  await expect(banner).toHaveCount(0);
  const after = await page.locator('#titulo').evaluate((el) => el.getBoundingClientRect().top);
  expect(after).toBeLessThan(titleTop);
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
