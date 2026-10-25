import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Docs, tanda D3 (colaboración y permisos, como Notion): edición simultánea
 * con presencia y cursores, comentarios sobre texto, modo sugerir, bloquear,
 * qué cambió entre versiones, roles e invitados, teamspaces, auditoría y
 * páginas verificadas.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

type Block = { id: string; type: string; content: string; [k: string]: unknown };

async function pageWith(request: APIRequestContext, title: string, content: Block[]) {
  const doc = (await (await request.post('/api/docs/pages', { data: { title } })).json()) as { id: string };
  const res = await request.patch(`/api/docs/pages/${doc.id}`, { data: { content } });
  expect(res.ok()).toBeTruthy();
  return doc;
}

async function content(request: APIRequestContext, id: string): Promise<Block[]> {
  return ((await (await request.get(`/api/docs/pages/${id}`)).json()) as { content: Block[] }).content;
}

const editable = (p: Page, text: string) => p.locator('.docs-blocks .docs-editable', { hasText: text });

/** Selecciona [start, end) del texto de un bloque. */
async function selectText(p: Page, text: string, start: number, end: number) {
  await editable(p, text).evaluate(
    (el, [s, e]) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode()!;
      const range = document.createRange();
      range.setStart(node, s);
      range.setEnd(node, e);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    },
    [start, end],
  );
}

async function openMenu(p: Page) {
  await p.getByRole('button', { name: 'Page options' }).click();
}

test('Docs: dos editores a la vez se ven y sus cambios se fusionan sin pisarse', async ({ browser, request }) => {
  const doc = await pageWith(request, `Vivo ${uid()}`, [
    { id: 'a', type: 'paragraph', content: 'Primer bloque' },
    { id: 'b', type: 'paragraph', content: 'Segundo bloque' },
  ]);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await a.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await b.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });

  // Presencia: cada uno ve el avatar del otro.
  await expect(a.getByTestId('docs-presence')).toBeVisible({ timeout: 15_000 });
  await expect(b.getByTestId('docs-presence')).toBeVisible({ timeout: 15_000 });

  // A escribe en el primer bloque y B, a la vez, en el segundo.
  await editable(a, 'Primer bloque').click();
  await a.keyboard.press('End');
  await a.keyboard.type(' de A');
  await editable(b, 'Segundo bloque').click();
  await b.keyboard.press('End');
  await b.keyboard.type(' de B');

  // Se fusiona: el server tiene los dos y cada pantalla ve lo de la otra sin recargar.
  await expect
    .poll(async () => (await content(request, doc.id)).map((x) => x.content), { timeout: 20_000 })
    .toEqual(['Primer bloque de A', 'Segundo bloque de B']);
  await expect(editable(a, 'Segundo bloque de B')).toBeVisible({ timeout: 15_000 });
  await expect(editable(b, 'Primer bloque de A')).toBeVisible({ timeout: 15_000 });
  // Sin el viejo aviso de "cargar o sobrescribir".
  await expect(a.getByRole('alert').filter({ hasText: /merge|overwrite/i })).toHaveCount(0);

  // El cursor de B se ve en A (B tiene el caret en el segundo bloque).
  await b.keyboard.press('ArrowLeft');
  await expect(a.getByTestId('docs-peer-caret')).toBeVisible({ timeout: 15_000 });

  // Las dos escriben en el mismo párrafo, en lugares distintos: quedan las dos cosas.
  await editable(a, 'Primer bloque de A').click();
  await a.keyboard.press('Home');
  await a.keyboard.type('Hoy: ');
  await editable(b, 'Primer bloque de A').click();
  await b.keyboard.press('End');
  await b.keyboard.type(' y B');
  await expect
    .poll(async () => (await content(request, doc.id))[0].content, { timeout: 20_000 })
    .toBe('Hoy: Primer bloque de A y B');
  await ctxA.close();
  await ctxB.close();
});

test('Docs: comentar un texto seleccionado lo resalta, abre su hilo y se resuelve', async ({ page: p, request }) => {
  const doc = await pageWith(request, `Comentar ${uid()}`, [{ id: 'a', type: 'paragraph', content: 'El precio sube en marzo' }]);
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await editable(p, 'El precio').click();
  await selectText(p, 'El precio', 3, 9);
  await p.getByTestId('docs-inline-comment').click();
  const composer = p.getByTestId('docs-inline-composer');
  await expect(composer).toBeVisible();
  await expect(composer.locator('blockquote')).toHaveText('precio');
  await composer.getByRole('textbox').fill('¿Cuánto sube?');
  await composer.getByRole('button', { name: 'Comment' }).click();

  const thread = p.getByTestId('docs-comment-thread').filter({ hasText: '¿Cuánto sube?' });
  await expect(thread).toBeVisible();
  await expect(thread.getByRole('button', { name: 'precio' })).toBeVisible();
  // El resaltado queda en el texto (y en el servidor).
  const mark = p.locator('.docs-editor span[data-comment]');
  await expect(mark).toHaveText('precio');
  await expect.poll(async () => (await content(request, doc.id))[0].content).toContain('data-comment=');
  const bg = await mark.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');

  // Resolver: sale de Abiertos, aparece en Resueltos y el texto deja de resaltarse.
  await thread.getByRole('button', { name: 'Resolve' }).click();
  await expect(p.getByTestId('docs-comment-thread').filter({ hasText: '¿Cuánto sube?' })).toHaveCount(0);
  await p.getByRole('tab', { name: /Resolved/ }).click();
  await expect(p.getByTestId('docs-comment-thread').filter({ hasText: '¿Cuánto sube?' })).toBeVisible();
  await expect.poll(() => mark.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
});

test('Docs: modo sugerir marca lo escrito y lo borrado; aceptar y rechazar', async ({ page: p, request }) => {
  const doc = await pageWith(request, `Sugerir ${uid()}`, [{ id: 'a', type: 'paragraph', content: 'Reunión el lunes' }]);
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await openMenu(p);
  await p.getByTestId('docs-suggest-toggle').click();
  await expect(p.getByTestId('docs-suggest-banner')).toBeVisible();

  await editable(p, 'Reunión el lunes').click();
  await p.keyboard.press('End');
  await p.keyboard.type(' a las 10');
  await expect(p.locator('.docs-editor span[data-sug-kind="ins"]')).toHaveText(' a las 10');
  // Borrar "el " queda tachado, no se borra.
  await selectText(p, 'Reunión', 8, 11);
  await p.keyboard.press('Backspace');
  await expect(p.locator('.docs-editor span[data-sug-kind="del"]')).toHaveText('el ');
  await expect(editable(p, 'Reunión')).toContainText('Reunión el lunes a las 10');

  await p.getByRole('button', { name: /^Comments/ }).click();
  const list = p.getByTestId('docs-suggestion');
  await expect(list).toHaveCount(2);
  // Aceptar el agregado y rechazar el borrado.
  await list.filter({ hasText: 'a las 10' }).getByRole('button', { name: /^Accept/ }).click();
  await list.filter({ hasText: 'el' }).getByRole('button', { name: /^Reject/ }).click();
  await expect(p.getByTestId('docs-suggestions')).toHaveCount(0);
  await expect
    .poll(async () => (await content(request, doc.id))[0].content, { timeout: 10_000 })
    .toBe('Reunión el lunes a las 10');

  // Enter al final sugiere un párrafo nuevo; "Reject all" lo saca.
  await editable(p, 'Reunión el lunes a las 10').click();
  await p.keyboard.press('End');
  await p.keyboard.press('Enter');
  await p.keyboard.type('Traer el informe');
  await expect(p.locator('.docs-block-outer.is-suggested-block')).toHaveCount(1);
  await expect(p.getByTestId('docs-suggestion')).toHaveCount(1);
  await p.getByTestId('docs-suggestion').getByRole('button', { name: /^Reject/ }).click();
  await expect(p.locator('.docs-block-outer.is-suggested-block')).toHaveCount(0);
  await expect.poll(async () => (await content(request, doc.id)).length, { timeout: 10_000 }).toBe(1);
});

test('Docs: bloquear la página la deja en lectura hasta desbloquearla', async ({ page: p, request }) => {
  const doc = await pageWith(request, `Bloqueo ${uid()}`, [{ id: 'a', type: 'paragraph', content: 'Política vigente' }]);
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await openMenu(p);
  await p.getByTestId('docs-lock-toggle').click();
  await expect(p.getByTestId('docs-locked-banner')).toBeVisible();
  await expect(p.getByTestId('docs-locked-badge')).toBeVisible();
  await expect(editable(p, 'Política vigente')).toHaveAttribute('contenteditable', 'false');
  await expect(p.locator('.docs-title')).toHaveAttribute('contenteditable', 'false');
  expect(((await (await request.get(`/api/docs/pages/${doc.id}`)).json()) as { locked: boolean }).locked).toBe(true);
  // Un PATCH de contenido se rechaza.
  const res = await request.patch(`/api/docs/pages/${doc.id}`, { data: { content: [{ id: 'a', type: 'paragraph', content: 'Cambiada' }] } });
  expect(res.status()).toBe(423);
  await p.getByTestId('docs-locked-banner').getByRole('button', { name: 'Unlock' }).click();
  await expect(p.getByTestId('docs-locked-banner')).toHaveCount(0);
  await expect(editable(p, 'Política vigente')).toHaveAttribute('contenteditable', 'true');
});

test('Docs: el historial muestra qué cambió en cada versión', async ({ page: p, request }) => {
  const doc = await pageWith(request, `Historial ${uid()}`, [{ id: 'a', type: 'paragraph', content: 'Versión uno' }]);
  expect((await request.post(`/api/docs/pages/${doc.id}/versions`)).ok()).toBeTruthy();
  await request.patch(`/api/docs/pages/${doc.id}`, {
    data: { content: [{ id: 'a', type: 'paragraph', content: 'Versión dos' }, { id: 'b', type: 'paragraph', content: 'Bloque nuevo' }] },
  });
  expect((await request.post(`/api/docs/pages/${doc.id}/versions`)).ok()).toBeTruthy();
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await openMenu(p);
  await p.getByRole('menuitem', { name: 'Version history' }).click();
  await p.locator('.docs-versions-row').first().click();
  const diff = p.getByTestId('docs-diff');
  await expect(diff).toBeVisible();
  await expect(diff.locator('[data-kind="added"]')).toContainText('Bloque nuevo');
  await expect(diff.locator('[data-kind="changed"] ins')).toHaveText('dos');
  await expect(diff.locator('[data-kind="changed"] del')).toHaveText('uno');
  await p.getByRole('tab', { name: 'Compare with now' }).click();
  await expect(p.getByTestId('docs-diff')).toContainText('No changes.');
});

test('Docs: compartir con cuatro roles e invitar a un email de afuera', async ({ page: p, request }) => {
  const doc = await pageWith(request, `Compartir ${uid()}`, [{ id: 'a', type: 'paragraph', content: 'Hola' }]);
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /^Share/ }).click();
  const dialog = p.getByRole('dialog', { name: 'Share' });
  const role = dialog.getByLabel('Permission', { exact: true });
  await expect(role.locator('option')).toHaveText(['Full access', 'Can edit', 'Can comment', 'Can view']);
  const email = `cliente-${uid()}@afuera.test`;
  await dialog.getByPlaceholder('Email, member or team').fill(email);
  await role.selectOption('comment');
  await dialog.getByRole('button', { name: 'Invite' }).click();
  const invite = dialog.getByTestId('docs-access-invite');
  await expect(invite).toContainText(email);
  await expect(invite).toContainText('Can comment');
  // Rol de los miembros del workspace en esta página.
  await dialog.getByTestId('docs-member-role').selectOption('view');
  await expect.poll(async () => ((await (await request.get(`/api/docs/pages/${doc.id}`)).json()) as { member_role: string | null }).member_role).toBe('view');
  await dialog.getByTestId('docs-member-role').selectOption('');
  // Revocar la invitación.
  await invite.getByRole('button', { name: /Revoke invite/ }).click();
  await expect(dialog.getByTestId('docs-access-invite')).toHaveCount(0);
});

test('Docs: teamspaces en ajustes y en el sidebar; auditoría con CSV', async ({ page: p, request }) => {
  const name = `Equipo ${uid()}`;
  await p.goto('/en/app/docs/settings?tab=teamspaces', { waitUntil: 'networkidle' });
  await p.getByTestId('docs-ts-name').fill(name);
  await p.getByTestId('docs-ts-access').selectOption('private');
  await p.getByRole('button', { name: 'Create teamspace' }).click();
  await expect(p.getByTestId('docs-ts-list')).toContainText(name);

  // Página nueva dentro del teamspace desde el sidebar.
  const ts = ((await (await request.get('/api/docs/teamspaces')).json()) as { rows: Array<{ id: string; name: string }> }).rows.find((x) => x.name === name)!;
  const inside = (await (await request.post('/api/docs/pages', { data: { title: `Dentro ${uid()}`, teamspace_id: ts.id } })).json()) as { id: string; title: string };
  await p.goto(`/en/app/docs/${inside.id}`, { waitUntil: 'networkidle' });
  const section = p.getByTestId('docs-teamspace').filter({ hasText: name });
  await expect(section).toContainText(inside.title);
  await expect(section).toContainText('Private');

  // Mover una página del workspace al teamspace desde su menú.
  const loose = (await (await request.post('/api/docs/pages', { data: { title: `Suelta ${uid()}` } })).json()) as { id: string; title: string };
  await p.goto(`/en/app/docs/${loose.id}`, { waitUntil: 'networkidle' });
  const row = p.getByTestId('docs-tree-row').filter({ hasText: loose.title });
  await row.hover();
  await row.getByRole('button', { name: 'Page actions' }).click();
  await p.getByRole('menuitem', { name: name }).click();
  await expect(p.getByTestId('docs-teamspace').filter({ hasText: name })).toContainText(loose.title, { timeout: 10_000 });

  // Auditoría: el teamspace creado aparece y se exporta.
  await p.goto('/en/app/docs/settings?tab=audit', { waitUntil: 'networkidle' });
  await p.getByTestId('docs-audit-action').selectOption('teamspace');
  await expect(p.getByTestId('docs-audit-table')).toContainText('Created a teamspace');
  const csv = await request.get('/api/docs/audit?format=csv&action=teamspace');
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('teamspace.created');
  // Borrar el teamspace deja sus páginas en el workspace.
  expect((await request.delete(`/api/docs/teamspaces/${ts.id}`)).status()).toBe(204);
  expect(((await (await request.get(`/api/docs/pages/${inside.id}`)).json()) as { teamspace_id: string | null }).teamspace_id).toBeNull();
});

test('Docs: verificar una página muestra el check y la lista la wiki', async ({ page: p, request }) => {
  const title = `Wiki ${uid()}`;
  const doc = await pageWith(request, title, [{ id: 'a', type: 'paragraph', content: 'Cómo pedir vacaciones' }]);
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await openMenu(p);
  await p.getByTestId('docs-verify-open').click();
  const dialog = p.getByRole('dialog', { name: 'Verify page' });
  await dialog.getByLabel('Verify for').selectOption('30');
  await dialog.getByTestId('docs-verify-submit').click();
  await expect(p.getByTestId('docs-verified-badge')).toHaveText(/Verified/);
  await p.goto('/en/app/docs', { waitUntil: 'networkidle' });
  await expect(p.locator('#wiki')).toContainText(title);
  await expect(p.locator('#wiki')).toContainText('Until');
});

test('Docs D3: claro, oscuro y 390 px sin scroll horizontal', async ({ page: p, request }) => {
  test.setTimeout(240_000);
  const doc = await pageWith(request, `Pantallas ${uid()}`, [{ id: 'a', type: 'paragraph', content: 'Texto de prueba' }]);
  for (const scheme of ['light', 'dark'] as const) {
    await p.emulateMedia({ colorScheme: scheme });
    for (const width of [1280, 390]) {
      await p.setViewportSize({ width, height: 860 });
      for (const url of [`/en/app/docs/${doc.id}`, '/en/app/docs/settings?tab=teamspaces', '/en/app/docs/settings?tab=audit']) {
        await p.goto(url, { waitUntil: 'load' });
        await p.locator(url.includes('settings') ? '.st-page' : '.docs-editor').first().waitFor();
        await p.waitForTimeout(400);
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${url} ${scheme} ${width}`).toBeLessThanOrEqual(1);
        if (process.env.E2E_SHOTS_DIR) await p.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/d3-${scheme}-${width}-${url.split('/').pop()!.replace(/[?=]/g, '_')}.png` });
      }
    }
  }
});
