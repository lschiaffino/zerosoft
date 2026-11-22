import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * CRM P1: la vista previa se edita en línea (Enter guarda, Esc cancela sin
 * cerrar el panel, el valor nuevo se ve al instante y vuelve si falla), los
 * campos de solo lectura u ocultos siguen así en el panel, y la vista de deals
 * tiene la barra de HubSpot (pipeline y board/tabla junto a la búsqueda,
 * filtros rápidos por fecha) con menús que cierran con Esc y click afuera, drag
 * entre etapas y sin scroll horizontal a 390. Datos inventados.
 */
const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()) as T;
}

async function firstPipeline(request: APIRequestContext, id?: string) {
  const body = await ok<{ rows: Array<{ id: string; stages: Array<{ id: string; name: string; is_won: number; is_lost: number }> }> }>(
    request.get('/api/crm/pipelines'),
  );
  const p = id ? body.rows.find((r) => r.id === id)! : body.rows[0];
  return { id: p.id, open: p.stages.filter((s) => !s.is_won && !s.is_lost) };
}

async function newDeal(request: APIRequestContext, name: string, amount = 1200) {
  const p = await firstPipeline(request);
  const deal = await ok<{ id: string }>(request.post('/api/crm/deals', { data: { name, pipelineId: p.id, stageId: p.open[0].id, amount } }));
  return { p, deal };
}

async function openPreviewFromBoard(page: Page, pipelineId: string, name: string) {
  await page.goto(`/en/app/crm/deals?pipeline=${pipelineId}`, { waitUntil: 'networkidle' });
  const card = page.locator('.kb-card', { hasText: name });
  // Click en la card (no en el nombre, que lleva a la ficha): abre la vista previa.
  await card.locator('.kb-card-amount').click();
  const preview = page.getByTestId('record-preview');
  await expect(preview.getByRole('heading', { name })).toBeVisible();
  return preview;
}

async function noHorizontalScroll(page: Page) {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sw).toBeLessThanOrEqual(0);
}

test('vista previa: editar en línea con Enter, Esc cancela sin cerrar, y el board se actualiza', async ({ page, request }) => {
  const name = `Preview ${uid()}`;
  const { p, deal } = await newDeal(request, name);
  const preview = await openPreviewFromBoard(page, p.id, name);

  // Próximo paso: click en el valor → input → Enter guarda.
  const nextStep = preview.locator('[data-prop="nextStep"]');
  await nextStep.getByRole('button', { name: '—' }).click();
  const input = nextStep.locator('input');
  await input.fill('Send proposal');
  await input.press('Enter');
  await expect(nextStep).toContainText('Send proposal');
  await expect.poll(async () => (await ok<{ deal: { next_step: string } }>(request.get(`/api/crm/deals/${deal.id}`))).deal.next_step).toBe('Send proposal');

  // Esc cancela la edición y deja el panel abierto.
  await nextStep.getByRole('button', { name: 'Send proposal' }).click();
  await nextStep.locator('input').fill('Something else');
  await nextStep.locator('input').press('Escape');
  await expect(preview).toBeVisible();
  await expect(nextStep).toContainText('Send proposal');

  // Monto: el board refleja el valor guardado.
  const amount = preview.locator('[data-prop="amount"]');
  await amount.getByRole('button').first().click();
  await amount.locator('input').fill('4321');
  await amount.locator('input').press('Enter');
  await expect(amount).toContainText('4,321');
  await expect(page.locator('.kb-card', { hasText: name }).locator('.kb-card-amount')).toContainText('4,321');

  // "Abrir registro" lleva a la ficha; Esc (sin edición en curso) cierra el panel.
  await expect(preview.getByTestId('preview-open-record')).toHaveAttribute('href', new RegExp(`/app/crm/deals/${deal.id}$`));
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
});

test('vista previa: si el guardado falla, el valor vuelve y el error aparece debajo del campo', async ({ page, request }) => {
  const name = `Rollback ${uid()}`;
  const { p, deal } = await newDeal(request, name);
  const preview = await openPreviewFromBoard(page, p.id, name);
  await page.route(`**/api/crm/deals/${deal.id}`, (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 500, body: '{"error":"generic"}', contentType: 'application/json' }) : route.continue(),
  );
  const nextStep = preview.locator('[data-prop="nextStep"]');
  await nextStep.getByRole('button', { name: '—' }).click();
  await nextStep.locator('input').fill('Will fail');
  await nextStep.locator('input').press('Enter');
  await expect(nextStep.getByTestId('prop-error')).toBeVisible();
  await expect(nextStep).not.toContainText('Will fail');
  await page.unroute(`**/api/crm/deals/${deal.id}`);
});

test('vista previa: la etapa se cambia desde el panel y la card pasa de columna', async ({ page, request }) => {
  const name = `Stage ${uid()}`;
  const { p, deal } = await newDeal(request, name);
  const preview = await openPreviewFromBoard(page, p.id, name);
  await preview.getByTestId('preview-stage').selectOption(p.open[1].id);
  await expect(page.locator(`.kb-cards[data-stage-id="${p.open[1].id}"] .kb-card`, { hasText: name })).toBeVisible();
  await expect.poll(async () => (await ok<{ deal: { stage_id: string } }>(request.get(`/api/crm/deals/${deal.id}`))).deal.stage_id).toBe(p.open[1].id);
});

test('board: arrastrar una card a otra etapa la guarda', async ({ page, request }) => {
  const name = `Drag ${uid()}`;
  const { p, deal } = await newDeal(request, name);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/en/app/crm/deals?pipeline=${p.id}`, { waitUntil: 'networkidle' });
  const card = page.locator(`.kb-card[data-deal-id="${deal.id}"]`);
  const from = (await card.boundingBox())!;
  const target = (await page.locator(`.kb-cards[data-stage-id="${p.open[1].id}"]`).boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 30, { steps: 5 });
  await page.mouse.move(target.x + target.width / 2, target.y + 20, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(`.kb-cards[data-stage-id="${p.open[1].id}"] .kb-card[data-deal-id="${deal.id}"]`)).toBeVisible();
  await expect.poll(async () => (await ok<{ deal: { stage_id: string } }>(request.get(`/api/crm/deals/${deal.id}`))).deal.stage_id).toBe(p.open[1].id);
});

test('deals: pipeline y board/tabla junto a la búsqueda; los menús cierran con Esc y click afuera', async ({ page, request }) => {
  const name = `Toolbar ${uid()}`;
  const { p } = await newDeal(request, name);
  await page.goto(`/en/app/crm/deals?pipeline=${p.id}`, { waitUntil: 'networkidle' });

  const toggle = page.getByRole('navigation', { name: 'View' });
  await expect(toggle.getByRole('link', { name: 'Board' })).toHaveAttribute('aria-current', 'page');

  // Pipeline: Esc cierra y devuelve el foco; click afuera también cierra.
  const pipe = page.getByTestId('pipeline-menu');
  await pipe.click();
  const menu = page.getByRole('menu', { name: 'Pipeline' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(pipe).toBeFocused();
  await pipe.click();
  await expect(menu).toBeVisible();
  await page.getByRole('heading', { name: 'Deals', level: 1 }).click();
  await expect(menu).toBeHidden();

  // Fecha de cierre: un rango rápido filtra (y queda en la URL); Esc y click afuera cierran.
  const close = page.getByTestId('deals-close-filter');
  await close.click();
  const closeMenu = page.getByTestId('deals-close-filter-menu');
  await expect(closeMenu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(closeMenu).toBeHidden();
  await close.click();
  await expect(closeMenu).toBeVisible();
  await page.getByRole('heading', { name: 'Deals', level: 1 }).click();
  await expect(closeMenu).toBeHidden();
  await close.click();
  await closeMenu.getByRole('button', { name: 'This quarter' }).click();
  await expect(page).toHaveURL(/closeFrom=\d{4}-\d{2}-\d{2}/);
  await expect(close).toHaveClass(/\bon\b/);

  // Tabla: misma barra.
  await toggle.getByRole('link', { name: 'Table' }).click();
  await expect(page).toHaveURL(/view=table/);
  await expect(page.getByRole('navigation', { name: 'View' }).getByRole('link', { name: 'Table' })).toHaveAttribute('aria-current', 'page');
});

test('deals y vista previa a 390: sin scroll horizontal y con blancos de 40px', async ({ page, request }) => {
  const name = `Phone ${uid()}`;
  const { p } = await newDeal(request, name);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/app/crm/deals?pipeline=${p.id}`, { waitUntil: 'networkidle' });
  await noHorizontalScroll(page);
  for (const el of [page.getByTestId('pipeline-menu'), page.getByTestId('deals-close-filter'), page.getByRole('navigation', { name: 'View' }).getByRole('link', { name: 'Table' })]) {
    expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  }
  await page.getByTestId('deals-created-filter').click();
  const menu = page.getByTestId('deals-created-filter-menu');
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');

  await page.goto(`/en/app/crm/deals?pipeline=${p.id}&view=table`, { waitUntil: 'networkidle' });
  await noHorizontalScroll(page);

  // Vista previa desde la tabla a 390: ocupa la pantalla y no desborda.
  const row = page.locator('tr', { hasText: name });
  await row.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByTestId('record-preview');
  await expect(preview.getByRole('heading', { name })).toBeVisible();
  const pb = (await preview.boundingBox())!;
  expect(pb.width).toBeLessThanOrEqual(390);
  await noHorizontalScroll(page);
});

// ---------- Permisos por campo en la vista previa (workspace propio) ----------

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function personContext(browser: Browser, email: string) {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  return ctx;
}

test('vista previa de un member: el campo de solo lectura no se edita y el oculto no aparece', async ({ browser }) => {
  const ownerEmail = `p1-owner-${uid()}@crm-p1-e2e.test`;
  const memberEmail = `p1-member-${uid()}@crm-p1-e2e.test`;
  const owner = await personContext(browser, ownerEmail);
  const ctxs: BrowserContext[] = [owner];
  try {
    await ok(owner.request.post('/api/onboarding', { data: { kind: 'full', mode: 'team', name: 'P1', locale: 'en', apps: ['crm'] } }));
    const fields: Record<string, string> = {};
    for (const [key, label, access] of [
      [`ro_${uid()}`, 'Contract ref', 'read'],
      [`hid_${uid()}`, 'Margin note', 'hidden'],
      [`ed_${uid()}`, 'Champion', null],
    ] as const) {
      const f = await ok<{ id: string }>(owner.request.post('/api/crm/custom-fields', { data: { entity: 'deals', name: key, label, type: 'text' } }));
      if (access) await ok(owner.request.put(`/api/crm/field-permissions/${f.id}`, { data: { rules: [{ subject: 'role:member', access }] } }));
      fields[label] = key;
    }
    await ok(owner.request.post('/api/teams/invites', { data: { emails: [memberEmail], role: 'member' } }));
    const token = String((await sql("SELECT token FROM team_invites WHERE email = ? AND status = 'pending'", [memberEmail]))[0]?.token);
    const member = await personContext(browser, memberEmail);
    ctxs.push(member);
    await ok(member.request.post('/api/teams/accept', { data: { token } }));
    await sql("UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", [memberEmail]);
    await member.request.post('/api/tours', { data: { kind: 'off', off: true } });

    const name = `Perm ${uid()}`;
    // Un pipeline propio con dos etapas (el workspace es nuevo).
    const pipe = await ok<{ id: string }>(owner.request.post('/api/crm/pipelines', { data: { name: `P1 ${uid()}` } }));
    for (const stage of ['Intro', 'Demo']) await ok(owner.request.post(`/api/crm/pipelines/${pipe.id}/stages`, { data: { name: stage } }));
    const p = await firstPipeline(owner.request, pipe.id);
    await ok(
      owner.request.post('/api/crm/deals', {
        data: {
          name,
          pipelineId: p.id,
          stageId: p.open[0].id,
          amount: 10,
          custom: { [fields['Contract ref']]: 'CR-1', [fields['Margin note']]: 'm-secret', [fields['Champion']]: 'c-1' },
        },
      }),
    );

    const page = await member.newPage();
    const preview = await openPreviewFromBoard(page, p.id, name);
    const ro = preview.locator(`[data-prop="custom.${fields['Contract ref']}"]`);
    await expect(ro.getByTestId('prop-readonly')).toContainText('CR-1');
    await expect(ro.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(preview).not.toContainText('Margin note');
    await expect(preview).not.toContainText('m-secret');
    // El editable sí se edita.
    const ed = preview.locator(`[data-prop="custom.${fields['Champion']}"]`);
    await ed.getByRole('button', { name: 'c-1' }).click();
    await ed.locator('input').fill('c-2');
    await ed.locator('input').press('Enter');
    await expect(ed).toContainText('c-2');
    // Y el oculto sigue guardado para el owner.
    const rows = await sql('SELECT custom FROM crm_deals WHERE name = ?', [name]);
    const stored = JSON.parse(String(rows[0].custom)) as Record<string, string>;
    expect(stored[fields['Margin note']]).toBe('m-secret');
    expect(stored[fields['Champion']]).toBe('c-2');
  } finally {
    for (const c of ctxs) await c.close();
  }
});
