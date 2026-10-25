import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Talk (mensajería de equipo como Slack): canales, mensajes con formato,
 * hilos, menciones, reacciones, edición, búsqueda, DMs, archivos, guardados,
 * tiempo real (webhook entrante que aparece sin recargar), programados por
 * cron, issue de Track desde un mensaje y la tarjeta rica del link, teclado,
 * claro/oscuro y 390px. El servidor corre con TALK_REALTIME=poll (polling
 * corto); el stream SSE se prueba aparte con EventSource.
 */

const CRON = { authorization: 'Bearer e2e-cron' };
const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** Una persona más en el workspace del usuario demo. */
async function teammate(name: string): Promise<string> {
  const id = `talk-${uid()}`;
  await sql('INSERT INTO users (id, email, name, handle) VALUES (?, ?, ?, ?)', [id, `${id}@example.com`, name, id]);
  let team = (await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at LIMIT 1"))[0]?.id as string | undefined;
  if (!team) {
    team = `team-${uid()}`;
    await sql("INSERT INTO teams (id, name, owner_id) VALUES (?, 'Demo team', 'demo')", [team]);
  }
  await sql("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')", [team, id]);
  return id;
}

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

async function newChannel(request: APIRequestContext, name = `e2e-${uid()}`, extra: Record<string, unknown> = {}) {
  return ok<{ id: string; name: string }>(request.post('/api/talk/channels', { data: { name, kind: 'public', ...extra } }));
}

function composer(page: Page) {
  return page.locator('.talk-channel .talk-input').last();
}

async function openChannel(page: Page, id: string) {
  await page.goto(`/en/app/talk/${id}`, { waitUntil: 'networkidle' });
  await expect(composer(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('crear un canal desde el sidebar, ponerle tema y verlo marcado', async ({ page }) => {
  await page.goto('/en/app/talk', { waitUntil: 'networkidle' });
  // Arranca en #general.
  await expect(page.getByRole('link', { name: 'general' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Create a channel' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create a channel' });
  const name = `Launch Plan ${uid()}`;
  await dialog.getByLabel('Name').fill(name);
  const slug = name.toLowerCase().replace(/ /g, '-');
  await expect(dialog.getByText(`It will be #${slug}`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/app\/talk\/[\w-]+$/);
  await expect(page.getByRole('link', { name: slug })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.talk-head-title')).toContainText(slug);
  // Tema desde el encabezado.
  await page.getByRole('button', { name: 'Add a topic' }).click();
  const details = page.getByRole('dialog', { name: new RegExp(slug) });
  await details.getByLabel('Topic').fill('Q4 launch');
  await details.getByRole('button', { name: 'Save' }).click();
  await details.press('Escape');
  await expect(page.locator('.talk-head-topic')).toHaveText('Q4 launch');
  // Renombrar: el sidebar cambia sin recargar.
  await page.getByRole('button', { name: 'Details' }).click();
  const again = page.getByRole('dialog', { name: new RegExp(slug) });
  await again.getByLabel('Name').fill(`${slug}-v2`);
  await again.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('link', { name: `${slug}-v2` })).toHaveAttribute('aria-current', 'page');
  await again.press('Escape');
  await expect(page.locator('.talk-head-title')).toContainText(`${slug}-v2`);
});

test('mensajes: formato, editar con ↑, reaccionar, hilo con también al canal, guardar', async ({ page, request }) => {
  const ch = await newChannel(request);
  await openChannel(page, ch.id);
  await composer(page).fill('hola *equipo* `npm i` https://example.com/x');
  await composer(page).press('Enter');
  const msg = page.locator('.talk-channel').getByTestId('talk-message').filter({ hasText: 'hola' });
  await expect(msg.locator('strong')).toHaveText('equipo');
  await expect(msg.locator('code')).toHaveText('npm i');
  await expect(msg.getByRole('link', { name: 'https://example.com/x' })).toHaveAttribute('target', '_blank');

  // ↑ con el campo vacío edita el último mensaje.
  await composer(page).press('ArrowUp');
  const edit = page.getByRole('textbox', { name: 'Edit message' });
  await expect(edit).toBeFocused();
  await edit.fill('hola *equipo* editado');
  await edit.press('Enter');
  await expect(msg).toContainText('editado');
  await expect(msg.getByText('(edited)')).toBeVisible();

  // Reacción rápida desde la barra del mensaje.
  await msg.hover();
  await msg.getByRole('button', { name: 'React with white_check_mark' }).click();
  await expect(msg.getByRole('button', { name: /white_check_mark: 1/ })).toHaveAttribute('aria-pressed', 'true');

  // Hilo.
  await msg.hover();
  await msg.getByRole('button', { name: 'Reply in thread' }).click();
  const thread = page.getByRole('complementary', { name: 'Thread' });
  await expect(thread).toBeVisible();
  await expect(page).toHaveURL(/thread=/);
  await thread.getByRole('textbox', { name: 'Reply in thread' }).fill('respuesta al hilo');
  await thread.getByLabel(/Also send to/).check();
  await thread.getByRole('textbox', { name: 'Reply in thread' }).press('Enter');
  await expect(thread.getByTestId('talk-message').filter({ hasText: 'respuesta al hilo' })).toBeVisible();
  await expect(thread.getByRole('textbox', { name: 'Reply in thread' })).toHaveValue('');
  await expect(msg.getByRole('button', { name: /1 reply/ })).toBeVisible();
  // También quedó en el canal.
  await expect(page.locator('.talk-channel').getByTestId('talk-message').filter({ hasText: 'respuesta al hilo' })).toBeVisible();
  await thread.getByRole('button', { name: 'Close thread' }).click();
  await expect(thread).toHaveCount(0);

  // Guardar para más tarde y verlo en Later.
  await msg.hover();
  await msg.getByRole('button', { name: 'Save for later' }).click();
  await page.getByRole('button', { name: /^Later/ }).click();
  await expect(page.locator('.talk-view').getByText('editado')).toBeVisible();
});

test('menciones con autocompletado, aviso en la campana y DM', async ({ page, request }) => {
  const mate = await teammate('Teo Talk');
  const ch = await newChannel(request, `e2e-${uid()}`, { memberIds: [mate] });
  await openChannel(page, ch.id);
  await composer(page).pressSequentially('che @Teo');
  const option = page.getByRole('option', { name: /Teo Talk/ });
  await expect(option).toBeVisible();
  await composer(page).press('Enter');
  await expect(composer(page)).toHaveValue('che @Teo Talk ');
  await composer(page).press('Enter');
  await expect(page.locator('.talk-mention').filter({ hasText: '@Teo Talk' })).toBeVisible();
  await expect
    .poll(async () => (await sql("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'talk_mention'", [mate]))[0].n)
    .toBe(1);

  // DM nuevo con esa persona.
  await page.getByRole('button', { name: 'New message' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New message' });
  await dlg.getByLabel('To').first().fill('Teo');
  await dlg.getByRole('checkbox').first().check();
  await dlg.getByRole('button', { name: 'Open conversation' }).click();
  await expect(page.locator('.talk-head-title')).toHaveText('Teo Talk');
  await expect(page.getByRole('navigation', { name: 'Channels and messages' }).getByRole('link', { name: 'Teo Talk' })).toHaveAttribute('aria-current', 'page');
});

test('tiempo real: un webhook entrante aparece sin recargar', async ({ page, request }) => {
  const ch = await newChannel(request);
  await openChannel(page, ch.id);
  const { url } = await ok<{ url: string }>(request.post(`/api/talk/channels/${ch.id}/hooks`, { data: { name: 'CI bot' } }));
  const path = new URL(url).pathname;
  await ok(request.post(path, { data: { text: 'build *verde* listo' } }));
  const bot = page.getByTestId('talk-message').filter({ hasText: 'build' });
  await expect(bot).toBeVisible({ timeout: 15_000 });
  await expect(bot.getByText('CI bot')).toBeVisible();
  await expect(bot.locator('strong')).toHaveText('verde');
  // Token inválido.
  const bad = await request.post('/api/talk/hooks/zth_nope', { data: { text: 'x' } });
  expect(bad.status()).toBe(404);
});

test('el stream SSE manda ready y eventos', async ({ page, request }) => {
  const ch = await newChannel(request);
  await page.goto('/en/app/talk?view=threads', { waitUntil: 'domcontentloaded' });
  const got = page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const kinds: string[] = [];
        const es = new EventSource('/api/talk/stream?cursor=0');
        es.addEventListener('ready', () => kinds.push('ready'));
        es.addEventListener('events', () => {
          kinds.push('events');
          es.close();
          resolve(kinds);
        });
        setTimeout(() => {
          es.close();
          resolve(kinds);
        }, 12_000);
      }),
  );
  await page.waitForTimeout(1500);
  await ok(request.post(`/api/talk/channels/${ch.id}/messages`, { data: { body: 'por sse' } }));
  expect(await got).toEqual(['ready', 'events']);
});

test('búsqueda con filtros y ⌘K salta al canal', async ({ page, request }) => {
  const name = `buscar-${uid()}`;
  const ch = await newChannel(request, name);
  await ok(request.post(`/api/talk/channels/${ch.id}/messages`, { data: { body: 'el presupuesto final https://example.com' } }));
  await ok(request.post(`/api/talk/channels/${ch.id}/messages`, { data: { body: 'otro presupuesto sin link' } }));
  await page.goto('/en/app/talk', { waitUntil: 'networkidle' });
  const search = page.getByTestId('talk-search-input');
  await search.fill(`presupuesto in:#${name} has:link`);
  await search.press('Enter');
  const view = page.locator('.talk-view');
  await expect(view.getByText('1 message')).toBeVisible();
  await expect(view.getByText('el presupuesto final')).toBeVisible();
  await expect(view.getByText('otro presupuesto')).toHaveCount(0);
  await view.locator('.talk-card-open').first().click();
  await expect(page).toHaveURL(new RegExp(`${ch.id}\\?m=`));

  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox').fill(name);
  await palette.getByRole('option', { name: new RegExp(`#${name}`) }).first().click();
  await expect(page).toHaveURL(new RegExp(`/app/talk/${ch.id}`));
});

test('teclado: Alt+↓ cambia de canal y Esc marca leído', async ({ page, request }) => {
  const a = await newChannel(request, `aa-${uid()}`);
  await newChannel(request, `ab-${uid()}`);
  await openChannel(page, a.id);
  const before = await page.locator('.talk-side-item[aria-current="page"]').getAttribute('data-channel-id');
  await page.locator('.talk-head').click();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('.talk-side-item[aria-current="page"]')).not.toHaveAttribute('data-channel-id', before!);
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.locator('.talk-side-item[aria-current="page"]')).toHaveAttribute('data-channel-id', before!);
  await page.keyboard.press('ControlOrMeta+/');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
});

test('archivos: subir una imagen y verla en el mensaje y en Archivos', async ({ page, request }) => {
  const ch = await newChannel(request);
  await openChannel(page, ch.id);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.locator('.talk-channel input[type="file"]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.talk-attachment').getByText('pixel.png')).toBeVisible();
  // Enter mientras sube: se manda cuando termina.
  await composer(page).fill('mirá la imagen');
  await composer(page).press('Enter');
  await expect(page.locator('.talk-attachment')).toHaveCount(0);
  const img = page.getByTestId('talk-message').filter({ hasText: 'mirá la imagen' }).locator('img[alt="pixel.png"]');
  await expect(img).toBeVisible();
  const src = await img.getAttribute('src');
  const res = await request.get(src!);
  expect(res.status()).toBe(200);
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.locator('.talk-view').getByRole('link', { name: 'pixel.png' })).toBeVisible();
});

test('programado por cron, issue de Track desde el mensaje y tarjeta del link', async ({ page, request }) => {
  const ch = await newChannel(request);
  const sendAt = new Date(Date.now() + 120_000).toISOString();
  const s = await ok<{ id: string }>(request.post('/api/talk/scheduled', { data: { channelId: ch.id, body: 'programado para más tarde', sendAt } }));
  await sql('UPDATE talk_scheduled SET send_at = ? WHERE id = ?', [new Date(Date.now() - 1000).toISOString(), s.id]);
  const cron = await request.get('/api/cron/minute', { headers: CRON, timeout: 120_000 });
  expect(cron.ok(), await cron.text()).toBe(true);
  await openChannel(page, ch.id);
  await expect(page.getByText('programado para más tarde')).toBeVisible();

  const project = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `Talk issues ${uid()}` } }));
  const msg = page.getByTestId('talk-message').filter({ hasText: 'programado' });
  await msg.hover();
  await msg.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Create Track issue' }).click();
  const dlg = page.getByRole('dialog', { name: 'Create Track issue' });
  await dlg.getByLabel('Project').selectOption(project.id);
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(/Issue .+ created/)).toBeVisible();
  const issue = (await sql('SELECT id, title FROM track_issues WHERE project_id = ?', [project.id]))[0] as { id: string; title: string };
  expect(issue.title).toBe('programado para más tarde');

  // Compartir el issue: la tarjeta muestra título y estado.
  await composer(page).fill(`${new URL(page.url()).origin}/en/app/track/issues/${issue.id}`);
  await composer(page).press('Enter');
  await expect(page.locator('.talk-ref').filter({ hasText: 'programado para más tarde' })).toBeVisible();
});

test('borrar un canal desde los detalles lo saca del sidebar', async ({ page, request }) => {
  const ch = await newChannel(request, `borrar-${uid()}`);
  await openChannel(page, ch.id);
  await page.getByRole('button', { name: 'Details' }).click();
  const details = page.getByRole('dialog', { name: new RegExp(ch.name) });
  await details.getByRole('tab', { name: 'Settings' }).click();
  await details.getByRole('button', { name: 'Delete channel' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete channel' }).click();
  await expect(page.getByText('Channel deleted')).toBeVisible();
  await expect(page.getByRole('link', { name: ch.name })).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`tema ${theme}: canal con mensajes sin errores`, async ({ page, context, baseURL, request }) => {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const ch = await newChannel(request);
    await ok(request.post(`/api/talk/channels/${ch.id}/messages`, { data: { body: '> cita\n- uno\n```\ncode\n```' } }));
    await openChannel(page, ch.id);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('.talk-pre')).toHaveText('code');
    expect(errors).toEqual([]);
  });
}

test('390px: lista, canal y vuelta sin scroll horizontal', async ({ page, request }) => {
  const ch = await newChannel(request, `movil-${uid()}`);
  await ok(request.post(`/api/talk/channels/${ch.id}/messages`, { data: { body: 'un mensaje largo '.repeat(20) } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/talk?view=browse', { waitUntil: 'networkidle' });
  const noScroll = async () => {
    const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
    expect(scroll).toBeLessThanOrEqual(inner + 1);
  };
  await noScroll();
  await page.goto(`/en/app/talk/${ch.id}`, { waitUntil: 'networkidle' });
  await expect(composer(page)).toBeVisible();
  await noScroll();
  await page.getByRole('button', { name: 'Back' }).first().click();
  await expect(page.getByRole('link', { name: ch.name })).toBeVisible();
  await noScroll();
});
