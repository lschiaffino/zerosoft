import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CRM en el teléfono (390px): listas como tarjetas sin scroll horizontal,
 * board de a una columna con barra de etapas y "Mover a…" táctil, y la PWA:
 * manifest, service worker, vista abierta sin red y nota creada offline que
 * se sincroniza al volver la conexión.
 *
 * Los tests de offline necesitan el build de producción (CI=1): en `next dev`
 * el service worker no se registra.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const PHONE = { width: 390, height: 844 };

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
}

async function pipelineWithStages(request: APIRequestContext, names: string[]) {
  const p = await (await request.post('/api/crm/pipelines', { data: { name: `Mobile ${uid()}` } })).json();
  const stages: Array<{ id: string; name: string }> = [];
  for (const n of names) {
    stages.push(await (await request.post(`/api/crm/pipelines/${p.id}/stages`, { data: { name: n } })).json());
  }
  return { id: p.id as string, stages };
}

test.describe('CRM a 390px', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('contactos, empresas, deals y tareas: tarjetas sin scroll horizontal', async ({ page, request }) => {
    const tag = uid();
    const company = await (await request.post('/api/crm/companies', { data: { name: `Acme móvil ${tag}`, domain: `acme-${tag}.com`, phone: '+5491155550000' } })).json();
    await request.post('/api/crm/contacts', {
      data: { firstName: 'Ana', lastName: `Móvil ${tag}`, email: `ana-${tag}@example.com`, phone: '+5491155551234', companyId: company.id },
    });
    const pipe = await pipelineWithStages(request, ['Lead', 'Won']);
    await request.post('/api/crm/deals', { data: { name: `Deal móvil ${tag}`, amount: 1200, pipelineId: pipe.id, stageId: pipe.stages[0].id } });
    await request.post('/api/crm/activities', { data: { type: 'task', subject: `Llamar a Ana ${tag}` } });

    for (const [path, text] of [
      ['/en/app/crm/contacts', `Ana Móvil ${tag}`],
      ['/en/app/crm/companies', `Acme móvil ${tag}`],
      [`/en/app/crm/deals?view=table&pipeline=${pipe.id}`, `Deal móvil ${tag}`],
    ] as const) {
      await page.goto(path, { waitUntil: 'networkidle' });
      const row = page.locator('.crm-cards tbody tr').filter({ hasText: text });
      await expect(row).toBeVisible();
      // Tarjeta: grilla, sin la cabecera completa de la tabla, dentro de la pantalla.
      expect(await row.evaluate((el) => getComputedStyle(el).display)).toBe('grid');
      const box = (await row.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
      // Seleccionar sigue a mano (checkbox de la tarjeta) y abre la barra masiva.
      await row.locator('input.row-check').check();
      await expect(page.locator('.bulk-bar')).toBeVisible();
      await noHorizontalScroll(page);
    }

    // En la tarjeta del contacto: llamar y WhatsApp con área táctil de 40px.
    await page.goto('/en/app/crm/contacts', { waitUntil: 'networkidle' });
    const card = page.locator('.crm-cards tbody tr').filter({ hasText: `Ana Móvil ${tag}` });
    const call = card.getByRole('link', { name: 'Call' }).first();
    await expect(call).toBeVisible();
    const callBox = (await call.boundingBox())!;
    expect(callBox.height).toBeGreaterThanOrEqual(40);

    await page.goto('/en/app/crm/tasks?bucket=upcoming');
    await expect(page.getByText(`Llamar a Ana ${tag}`)).toBeVisible();
    await noHorizontalScroll(page);

    // La ficha también entra en el teléfono.
    await page.goto('/en/app/crm/contacts', { waitUntil: 'networkidle' });
    await page.locator('.crm-cards tbody tr').filter({ hasText: `Ana Móvil ${tag}` }).getByRole('link', { name: `Ana Móvil ${tag}` }).click();
    await page.waitForURL(/\/app\/crm\/contacts\/[^/]+$/);
    await page.waitForLoadState('networkidle');
    await noHorizontalScroll(page);
  });

  test('board: una columna por pantalla, barra de etapas y mover con el menú', async ({ page, request }) => {
    const p = await pipelineWithStages(request, ['Lead', 'Qualified', 'Proposal']);
    const [lead, qualified] = p.stages;
    const deal = await (await request.post('/api/crm/deals', { data: { name: `Tap ${uid()}`, amount: 500, pipelineId: p.id, stageId: lead.id } })).json();

    await page.goto(`/en/app/crm/deals?pipeline=${p.id}`, { waitUntil: 'networkidle' });
    const bar = page.locator('.kb-stagebar');
    await expect(bar).toBeVisible();
    await expect(bar.locator('.kb-stagebar-btn')).toHaveCount(3);
    await expect(bar.locator('.kb-stagebar-btn').first()).toContainText('Lead');
    await expect(bar.locator('.kb-stagebar-btn').first()).toContainText('1 ·');

    // Una columna ocupa el ancho del board.
    const board = (await page.locator('.kb-board').boundingBox())!;
    const firstCol = (await page.locator('.kb-col').first().boundingBox())!;
    expect(Math.abs(firstCol.width - board.width)).toBeLessThanOrEqual(2);
    await noHorizontalScroll(page);

    // Saltar a otra etapa desde la barra.
    await bar.locator('.kb-stagebar-btn').nth(1).click();
    await expect(bar.locator('.kb-stagebar-btn').nth(1)).toHaveClass(/is-active/);
    const qualifiedCol = page.locator('.kb-col').filter({ has: page.locator(`.kb-cards[data-stage-id="${qualified.id}"]`) });
    await expect(qualifiedCol).toBeInViewport({ ratio: 0.6 });

    // Mover con el dedo: "Mover a…" en la tarjeta.
    await bar.locator('.kb-stagebar-btn').first().click();
    const move = page.locator(`.kb-card[data-deal-id="${deal.id}"] select.kb-move`);
    await expect(move).toBeVisible();
    expect((await move.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await move.selectOption(qualified.id);
    await expect
      .poll(async () => {
        const saved = await (await request.get(`/api/crm/deals/${deal.id}`)).json();
        return (saved.deal ?? saved).stage_id;
      })
      .toBe(qualified.id);
  });
});

test.describe('CRM instalable y offline', () => {
  test('manifest e íconos', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m.display).toBe('standalone');
    // Manifest de la suite: abre en /app y tiene atajos al CRM.
    expect(m.start_url).toBe('/app');
    expect((m.shortcuts as Array<{ url: string }>).map((s) => s.url)).toContain('/app/crm/contacts');
    const sizes = (m.icons as Array<{ sizes: string; purpose?: string }>).map((i) => `${i.sizes}:${i.purpose ?? 'any'}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
    const icon = await request.get('/api/pwa-icon/512');
    expect(icon.headers()['content-type']).toContain('image/png');
    const sw = await request.get('/sw.js');
    expect(sw.ok()).toBe(true);
  });

  test('la vista abierta funciona sin red y la nota hecha offline se sincroniza', async ({ page, context, request }) => {
    test.skip(!process.env.CI, 'El service worker solo se registra con el build de producción (CI=1).');
    const tag = uid();
    const contact = await (await request.post('/api/crm/contacts', { data: { firstName: 'Offline', lastName: tag } })).json();

    await page.goto('/en/app/crm/contacts', { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // Primera carga: el worker toma el control; desde la segunda guarda lo que se abre.
    await page.reload({ waitUntil: 'networkidle' });
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.goto(`/en/app/crm/contacts/${contact.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: `Offline ${tag}` })).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: `Offline ${tag}` })).toBeVisible();
    await expect(page.getByTestId('crm-offline-bar')).toBeVisible();

    const note = `Nota sin señal ${tag}`;
    await page.locator('.tl-composer textarea').first().fill(note);
    await page.locator('.tl-composer button[type="submit"]').click();
    await expect(page.getByText('Saved offline. It syncs when the connection is back.').first()).toBeVisible();
    await expect(page.getByTestId('crm-offline-bar')).toContainText('1 change');

    await context.setOffline(false);
    await expect(page.getByTestId('crm-offline-bar')).toContainText(/saved|Syncing/);
    await expect
      .poll(async () => {
        const res = await request.get(`/api/crm/activities?contactId=${contact.id}`);
        return JSON.stringify(await res.json());
      })
      .toContain(note);
    await expect(page.getByText(note).first()).toBeVisible();
  });
});
