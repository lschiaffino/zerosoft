import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * CRM P4: la vista previa y las tarjetas del board se personalizan en
 * Ajustes (por objeto y por pipeline), una propiedad oculta para un member no
 * le aparece aunque esté configurada, y desde la vista previa se registra una
 * nota y se asocia un contacto. Lo que cambia la configuración corre en un
 * workspace propio (la base es compartida). Datos inventados.
 */
const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()) as T;
}

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function personContext(browser: Browser, email: string, width = 1280) {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  return ctx;
}

/** La base de e2e puede no tener pipelines todavía (corrida suelta): crea uno con dos etapas. */
async function ensurePipeline(request: APIRequestContext) {
  const body = await ok<{ rows: unknown[] }>(request.get('/api/crm/pipelines'));
  if (body.rows.length) return;
  const pipe = await ok<{ id: string }>(request.post('/api/crm/pipelines', { data: { name: `P4 ${uid()}` } }));
  for (const stage of ['Intro', 'Demo']) await ok(request.post(`/api/crm/pipelines/${pipe.id}/stages`, { data: { name: stage } }));
}

async function firstPipeline(request: APIRequestContext, id?: string) {
  if (!id) await ensurePipeline(request);
  const body = await ok<{ rows: Array<{ id: string; stages: Array<{ id: string; is_won: number; is_lost: number }> }> }>(request.get('/api/crm/pipelines'));
  const p = id ? body.rows.find((r) => r.id === id)! : body.rows[0];
  return { id: p.id, open: p.stages.filter((s) => !s.is_won && !s.is_lost) };
}

async function openPreview(page: Page, pipelineId: string, name: string) {
  await page.goto(`/en/app/crm/deals?pipeline=${pipelineId}`, { waitUntil: 'networkidle' });
  // Click en la card (no en el nombre, que lleva a la ficha).
  const card = page.locator('.kb-card', { hasText: name });
  await card.scrollIntoViewIfNeeded();
  const box = (await card.boundingBox())!;
  await card.click({ position: { x: box.width - 12, y: box.height - 8 } });
  const preview = page.getByTestId('record-preview');
  await expect(preview.getByRole('heading', { name })).toBeVisible();
  return preview;
}

async function noHorizontalScroll(page: Page) {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sw).toBeLessThanOrEqual(0);
}

/** Workspace nuevo con un owner y un member; `hidden` es una propiedad de deal oculta para members. */
async function teamWorkspace(browser: Browser) {
  const ownerEmail = `p4-owner-${uid()}@crm-p4-e2e.test`;
  const memberEmail = `p4-member-${uid()}@crm-p4-e2e.test`;
  const owner = await personContext(browser, ownerEmail);
  await ok(owner.request.post('/api/onboarding', { data: { kind: 'full', mode: 'team', name: 'P4', locale: 'en', apps: ['crm'] } }));
  const hidden = `hid_${uid()}`;
  const plan = `plan_${uid()}`;
  const h = await ok<{ id: string }>(owner.request.post('/api/crm/custom-fields', { data: { entity: 'deals', name: hidden, label: 'Margin note', type: 'text' } }));
  await ok(owner.request.put(`/api/crm/field-permissions/${h.id}`, { data: { rules: [{ subject: 'role:member', access: 'hidden' }] } }));
  await ok(owner.request.post('/api/crm/custom-fields', { data: { entity: 'deals', name: plan, label: 'Plan tier', type: 'text' } }));
  await ok(owner.request.post('/api/teams/invites', { data: { emails: [memberEmail], role: 'member' } }));
  const token = String((await sql("SELECT token FROM team_invites WHERE email = ? AND status = 'pending'", [memberEmail]))[0]?.token);
  const member = await personContext(browser, memberEmail);
  await ok(member.request.post('/api/teams/accept', { data: { token } }));
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", [memberEmail]);
  await member.request.post('/api/tours', { data: { kind: 'off', off: true } });
  const pipe = await ok<{ id: string }>(owner.request.post('/api/crm/pipelines', { data: { name: `P4 ${uid()}` } }));
  for (const stage of ['Intro', 'Demo']) await ok(owner.request.post(`/api/crm/pipelines/${pipe.id}/stages`, { data: { name: stage } }));
  const p = await firstPipeline(owner.request, pipe.id);
  return { owner, member, hidden, plan, p };
}

test('personalizar la vista previa y las tarjetas; un member no ve la propiedad oculta configurada', async ({ browser }) => {
  const { owner, member, hidden, plan, p } = await teamWorkspace(browser);
  const ctxs: BrowserContext[] = [owner, member];
  try {
    const name = `Cards ${uid()}`;
    await ok(
      owner.request.post('/api/crm/deals', {
        data: { name, pipelineId: p.id, stageId: p.open[0].id, amount: 900, nextStep: 'Call back', source: 'referral', custom: { [hidden]: 'm-secret', [plan]: 'Gold' } },
      }),
    );
    const page = await owner.newPage();

    // Vista previa de deals: sin Prioridad, con Origen y la propiedad oculta para members; sin actividad reciente.
    await page.goto('/en/app/crm/settings?tab=data&object=deals#preview-layout', { waitUntil: 'networkidle' });
    const panel = page.getByTestId('preview-layout-panel');
    await expect(panel.locator('#preview-layout-entity')).toHaveValue('deals');
    await panel.getByTestId('preview-layout-props-remove-priority').click();
    await expect(panel.getByTestId('preview-layout-props-row-priority')).toHaveCount(0);
    for (const key of ['source', `custom.${hidden}`]) {
      await panel.getByTestId('preview-layout-props-add-select').selectOption(key);
      await panel.getByTestId('preview-layout-props-add').click();
      await expect(panel.getByTestId(`preview-layout-props-row-${key}`)).toBeVisible();
    }
    await panel.getByTestId('preview-layout-hide-activity').click();
    await expect(panel.getByTestId('preview-layout-show-activity')).toBeVisible();

    // Tarjetas del pipeline: próximo paso y las dos personalizadas; la muestra las refleja.
    await page.goto(`/en/app/crm/settings?tab=sales&pipeline=${p.id}#board-cards`, { waitUntil: 'networkidle' });
    const cards = page.getByTestId('card-layout-panel');
    for (const key of ['company', 'priority']) {
      await cards.getByTestId(`card-layout-props-remove-${key}`).click();
      await expect(cards.getByTestId(`card-layout-props-row-${key}`)).toHaveCount(0);
    }
    for (const key of ['nextStep', `custom.${plan}`, `custom.${hidden}`]) {
      await cards.getByTestId('card-layout-props-add-select').selectOption(key);
      await cards.getByTestId('card-layout-props-add').click();
      await expect(cards.getByTestId(`card-layout-props-row-${key}`)).toBeVisible();
    }
    // Seis como mucho: el selector queda deshabilitado.
    await expect(cards.getByTestId('card-layout-props-add-select')).toBeDisabled();
    await expect(cards.getByTestId('card-layout-sample')).toContainText('Plan tier');

    // Board del owner: la tarjeta muestra lo configurado.
    await page.goto(`/en/app/crm/deals?pipeline=${p.id}`, { waitUntil: 'networkidle' });
    const card = page.locator('.kb-card', { hasText: name });
    await expect(card.locator('[data-card-prop="nextStep"]')).toContainText('Call back');
    await expect(card.locator(`[data-card-prop="custom.${plan}"]`)).toContainText('Gold');
    await expect(card).toContainText('m-secret');
    await expect(page.getByTestId('deals-edit-cards')).toBeVisible();

    // Vista previa del owner: Origen a la vista, Prioridad no, sin actividad reciente, y "Personalizar".
    const preview = await openPreview(page, p.id, name);
    await expect(preview.locator('[data-prop="source"]')).toBeVisible();
    await expect(preview.locator('[data-prop="priority"]')).toHaveCount(0);
    await expect(preview.locator('[data-preview-section="activity"]')).toHaveCount(0);
    await expect(preview.getByTestId('preview-customize')).toHaveAttribute('href', /tab=data&object=deals/);
    await expect(preview).toContainText('m-secret');

    // Member: ni la tarjeta ni la vista previa nombran la propiedad oculta; no hay "Personalizar" ni "Editar tarjetas".
    const mpage = await member.newPage();
    await mpage.goto(`/en/app/crm/deals?pipeline=${p.id}`, { waitUntil: 'networkidle' });
    const mcard = mpage.locator('.kb-card', { hasText: name });
    await expect(mcard.locator('[data-card-prop="nextStep"]')).toContainText('Call back');
    await expect(mcard).not.toContainText('m-secret');
    await expect(mcard).not.toContainText('Margin note');
    await expect(mpage.getByTestId('deals-edit-cards')).toHaveCount(0);
    const mpreview = await openPreview(mpage, p.id, name);
    await expect(mpreview.locator('[data-prop="source"]')).toBeVisible();
    await expect(mpreview).not.toContainText('m-secret');
    await expect(mpreview).not.toContainText('Margin note');
    await expect(mpreview.getByTestId('preview-customize')).toHaveCount(0);
    // Ni en lo que trae la página.
    expect(await mpage.content()).not.toContain('m-secret');
  } finally {
    for (const c of ctxs) await c.close();
  }
});

test('vista previa: registrar una nota y una tarea desde las acciones rápidas', async ({ page, request }) => {
  const p = await firstPipeline(request);
  const name = `Note ${uid()}`;
  const deal = await ok<{ id: string }>(request.post('/api/crm/deals', { data: { name, pipelineId: p.id, stageId: p.open[0].id, amount: 100 } }));
  const preview = await openPreview(page, p.id, name);

  // Esc en el composer lo cierra sin cerrar la vista previa.
  await preview.getByTestId('preview-quick-note').click();
  const composer = preview.getByTestId('preview-composer');
  await expect(composer).toBeVisible();
  await expect(composer.getByTestId('preview-composer-body')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(composer).toBeHidden();
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId('preview-quick-note')).toBeFocused();

  await preview.getByTestId('preview-quick-note').click();
  await composer.getByTestId('preview-composer-body').fill('Asked for a second demo');
  await composer.getByTestId('preview-composer-save').click();
  await expect(composer).toBeHidden();
  await expect(preview.getByTestId('preview-recent')).toContainText('Asked for a second demo');
  await expect
    .poll(async () => (await ok<{ rows: Array<{ type: string; body: string }> }>(request.get(`/api/crm/activities?dealId=${deal.id}`))).rows.map((r) => `${r.type}:${r.body}`))
    .toContain('note:Asked for a second demo');

  // Tarea con título.
  await preview.getByTestId('preview-quick-task').click();
  await expect(composer.getByTestId('preview-composer-save')).toBeDisabled();
  await composer.getByTestId('preview-composer-subject').fill('Send pricing');
  await composer.getByTestId('preview-composer-save').click();
  await expect(preview.getByTestId('preview-recent')).toContainText('Send pricing');

  // Reunión: el menú cierra con Esc y con click afuera, sin cerrar la vista previa.
  await preview.getByTestId('preview-quick-meeting').click();
  const menu = preview.locator('.book-meeting-menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(preview).toBeVisible();
  await preview.getByTestId('preview-quick-meeting').click();
  await expect(menu).toBeVisible();
  await preview.getByRole('heading', { name }).click();
  await expect(menu).toBeHidden();
  await expect(preview).toBeVisible();
});

test('vista previa: asociar y quitar un contacto desde la tarjeta de asociaciones', async ({ page, request }) => {
  const p = await firstPipeline(request);
  const name = `Assoc ${uid()}`;
  const last = `Assoc${uid()}`;
  const deal = await ok<{ id: string }>(request.post('/api/crm/deals', { data: { name, pipelineId: p.id, stageId: p.open[0].id, amount: 100 } }));
  const contact = await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Ana', lastName: last } }));
  const preview = await openPreview(page, p.id, name);

  const card = preview.locator('[data-preview-section="contacts"]');
  await expect(card.locator('.preview-sec-count')).toHaveText('0');
  // Esc sale del buscador sin cerrar la vista previa, y el foco vuelve a "Agregar".
  await card.getByTestId('preview-assoc-contacts-add').click();
  await expect(card.getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(card.getByRole('combobox')).toHaveCount(0);
  await expect(preview).toBeVisible();
  await expect(card.getByTestId('preview-assoc-contacts-add')).toBeFocused();

  await card.getByTestId('preview-assoc-contacts-add').click();
  const input = card.getByRole('combobox');
  await expect(input).toBeFocused();
  await input.fill(last);
  await card.getByRole('option', { name: new RegExp(last) }).click();
  await expect(card.locator('.preview-sec-count')).toHaveText('1');
  await expect(card.getByRole('link', { name: `Ana ${last}` })).toBeVisible();
  await expect
    .poll(async () => (await ok<{ contacts: Array<{ id: string }> }>(request.get(`/api/crm/deals/${deal.id}`))).contacts.map((c) => c.id))
    .toContain(contact.id);

  await card.getByRole('button', { name: `Remove Ana ${last}` }).click();
  await expect(card.locator('.preview-sec-count')).toHaveText('0');
  await expect
    .poll(async () => (await ok<{ contacts: Array<{ id: string }> }>(request.get(`/api/crm/deals/${deal.id}`))).contacts.length)
    .toBe(0);
});

test('vista previa y ajustes a 390: sin scroll horizontal, acciones de 40px', async ({ page, request }) => {
  const p = await firstPipeline(request);
  const name = `Phone P4 ${uid()}`;
  await ok(request.post('/api/crm/deals', { data: { name, pipelineId: p.id, stageId: p.open[0].id, amount: 100 } }));
  await page.setViewportSize({ width: 390, height: 844 });
  const preview = await openPreview(page, p.id, name);
  for (const k of ['note', 'email', 'call', 'task', 'meeting']) {
    const btn = preview.getByTestId(`preview-quick-${k}`);
    // El panel entra deslizándose: se mide cuando terminó.
    await expect.poll(async () => { const b = (await btn.boundingBox())!; return b.x + b.width; }).toBeLessThanOrEqual(390);
    expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  }
  await preview.getByTestId('preview-quick-email').click();
  await expect(preview.getByTestId('preview-composer')).toBeVisible();
  await noHorizontalScroll(page);
  expect((await preview.getByTestId('preview-assoc-contacts-add').boundingBox())!.height).toBeGreaterThanOrEqual(40);

  for (const url of ['/en/app/crm/settings?tab=data', '/en/app/crm/settings?tab=sales']) {
    await page.goto(url, { waitUntil: 'networkidle' });
    await noHorizontalScroll(page);
  }
});

test('leads: vista previa desde la tabla y el board, y tarjetas del board de leads', async ({ browser }) => {
  const email = `p4-leads-${uid()}@crm-p4-e2e.test`;
  const ctx = await personContext(browser, email);
  try {
    await ok(ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: 'team', name: 'P4 leads', locale: 'en', apps: ['crm'] } }));
    await ctx.request.post('/api/tours', { data: { kind: 'off', off: true } });
    const tag = uid();
    const a = await ok<{ id: string }>(ctx.request.post('/api/crm/leads', { data: { name: `LeadP ${tag} Alpha`, source: 'referral' } }));
    await ok(ctx.request.post('/api/crm/leads', { data: { name: `LeadP ${tag} Bravo` } }));
    const page = await ctx.newPage();

    // Tabla: el nombre abre la vista previa, con anterior / siguiente entre los leads en pantalla.
    await page.goto(`/en/app/crm/leads?q=LeadP%20${tag}&sort=name`, { waitUntil: 'networkidle' });
    await page.getByTestId('leads-table').getByTestId('record-name').filter({ hasText: 'Alpha' }).click();
    const preview = page.getByTestId('record-preview');
    await expect(preview.getByRole('heading', { name: `LeadP ${tag} Alpha` })).toBeVisible();
    await expect(preview.getByTestId('preview-nav-pos')).toBeVisible();
    // El lead anota, llama y agenda tareas; el email va por su contacto.
    await expect(preview.getByTestId('preview-quick-email')).toHaveCount(0);
    await preview.getByTestId('preview-quick-note').click();
    const composer = preview.getByTestId('preview-composer');
    await composer.getByTestId('preview-composer-body').fill(`Lead note ${tag}`);
    await composer.getByTestId('preview-composer-save').click();
    await expect(composer).toBeHidden();
    await expect.poll(async () => Number((await sql('SELECT COUNT(*) AS n FROM crm_activities WHERE lead_id = ?', [a.id]))[0]?.n)).toBe(1);
    await expect(preview.getByTestId('preview-recent')).toContainText(`Lead note ${tag}`);
    await page.keyboard.press('j');
    await expect(preview.getByRole('heading', { name: `LeadP ${tag} Bravo` })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);

    // Ajustes: el selector de tarjetas ofrece el board de leads.
    await page.goto('/en/app/crm/settings?tab=sales&pipeline=leads', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('card-layout-panel').locator('#card-layout-pipeline')).toHaveValue('leads');
    await ok(ctx.request.put('/api/crm/layouts', { data: { kind: 'card', entity: 'leads', properties: ['source', 'ownerId'] } }));

    // Board: la card muestra el origen y un clic en la card (no en el nombre) abre la vista previa.
    await page.goto(`/en/app/crm/leads?view=board&q=LeadP%20${tag}`, { waitUntil: 'networkidle' });
    const card = page.getByTestId('lead-card').filter({ hasText: 'Alpha' });
    await expect(card.locator('[data-card-prop="source"]')).toBeVisible();
    const box = (await card.boundingBox())!;
    await card.click({ position: { x: box.width - 8, y: 8 } });
    await expect(page.getByTestId('record-preview').getByRole('heading', { name: `LeadP ${tag} Alpha` })).toBeVisible();

    // A 390: sin scroll lateral con la vista previa abierta.
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalScroll(page);
  } finally {
    await ctx.close();
  }
});
