import fs from 'fs';
import path from 'path';
import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

/**
 * CRM, bloque D2: grupos y descripción de propiedades, valor único y las
 * propiedades de fábrica del deal (tipo, próximo paso, motivo de ganado).
 * Ajustes › Datos edita grupo, descripción y valor único; la ficha del deal
 * muestra una tarjeta por grupo con la ayuda debajo del nombre, edita el tipo
 * de deal y avisa cuando un valor único ya lo tiene otro deal. A 1280 y 390, y
 * en los cinco aspectos en claro y oscuro.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const WIDTHS = [1280, 390] as const;
const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function shot(page: Page, info: TestInfo, name: string) {
  const body = await page.screenshot();
  await info.attach(name, { body, contentType: 'image/png' });
  const dir = process.env.E2E_SHOT_DIR;
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.png`), body);
  }
}

async function ok<T>(p: Promise<import('@playwright/test').APIResponse>, status = 200): Promise<T> {
  const res = await p;
  expect(res.status(), await res.text()).toBe(status);
  return (await res.json()) as T;
}

/** Un campo de deals con grupo y descripción, y dos deals: uno ya tiene el valor `taken`. */
async function setup(request: APIRequestContext, tag: string) {
  const group = `Billing ${tag}`;
  const field = await ok<{ id: string; name: string }>(
    request.post('/api/crm/custom-fields', {
      data: { entity: 'deals', name: `po_${tag}`, label: `PO ${tag}`, type: 'text', group, description: `Purchase order ${tag}` },
    }),
    201,
  );
  const pipelines = await ok<{ rows: Array<{ id: string; stages: Array<{ id: string }> }> }>(request.get('/api/crm/pipelines'));
  const pipelineId = pipelines.rows[0].id;
  const stageId = pipelines.rows[0].stages[0].id;
  const taken = `PO-${tag}-1`;
  await ok(request.post('/api/crm/deals', { data: { name: `Owner of PO ${tag}`, pipelineId, stageId, custom: { [field.name]: taken } } }), 201);
  const deal = await ok<{ id: string }>(request.post('/api/crm/deals', { data: { name: `Deal ${tag}`, pipelineId, stageId } }), 201);
  return { field, group, deal, taken };
}

test('Ajustes › Datos: grupo, descripción y valor único de una propiedad (1280 y 390)', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const tag = uid();
  const { field } = await setup(request, tag);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/en/app/crm/settings?tab=data', { waitUntil: 'networkidle' });
    const item = page.locator(`[data-testid="cf-item"][data-field="${field.name}"]`);
    await expect(item).toBeVisible();
    await expect(item.getByTestId('cf-group')).toHaveValue(`Billing ${tag}`);
    // A 390 ya tiene la descripción que se cambió a 1280.
    await expect(item.getByTestId('cf-description')).toHaveValue(width === 1280 ? `Purchase order ${tag}` : `PO number from the buyer ${tag}`);

    if (width === 1280) {
      // Cambiar la descripción guarda al salir del campo.
      const desc = item.getByTestId('cf-description');
      await desc.fill(`PO number from the buyer ${tag}`);
      const saved = page.waitForResponse((r) => r.url().includes(`/api/crm/custom-fields/${field.id}`) && r.request().method() === 'PATCH');
      await desc.press('Tab');
      expect((await saved).status()).toBe(200);
      // Valor único (el usuario demo es owner).
      const unique = item.getByTestId('cf-unique');
      await expect(unique).not.toBeChecked();
      const on = page.waitForResponse((r) => r.url().includes(`/api/crm/custom-fields/${field.id}`) && r.request().method() === 'PATCH');
      // Controlado: queda marcado cuando el servidor confirma (check() exige el cambio inmediato).
      await unique.click();
      expect((await on).status()).toBe(200);
      await expect(unique).toBeChecked();
    } else {
      await expect(item.getByTestId('cf-unique')).toBeChecked();
    }
    const box = (await item.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await item.scrollIntoViewIfNeeded();
    await shot(page, info, `d2-settings-${width}`);
  }
});

test('ficha del deal: tarjeta por grupo con ayuda, tipo de deal y aviso de valor único (1280 y 390)', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const tag = uid();
  const { field, deal, taken } = await setup(request, tag);
  await ok(request.patch(`/api/crm/custom-fields/${field.id}`, { data: { isUnique: true } }));
  const card = `deal.custom.billing-${tag}`;

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/en/app/crm/deals/${deal.id}?tab=properties`, { waitUntil: 'networkidle' });
    const group = page.locator(`[data-card="${card}"]`);
    await expect(group).toBeVisible();
    await expect(group).toContainText(`Billing ${tag}`);
    await expect(group.getByTestId('prop-help')).toHaveText(`Purchase order ${tag}`);

    // Tipo de deal: select en línea.
    const typeRow = page.locator('[data-prop="dealType"]');
    await typeRow.getByRole('button', { name: 'Edit' }).click();
    const choice = width === 1280 ? 'newbusiness' : 'existingbusiness';
    const saved = page.waitForResponse((r) => r.url().endsWith(`/api/crm/deals/${deal.id}`) && r.request().method() === 'PATCH');
    await typeRow.locator('select').selectOption(choice);
    expect((await saved).status()).toBe(200);
    await expect(typeRow.locator('.prop-btn')).toHaveText(width === 1280 ? 'New business' : 'Existing business');

    // Un valor único que ya tiene otro deal: aviso, sin nombrar ese deal.
    const row = group.locator(`[data-prop="custom.${field.name}"]`);
    await row.getByRole('button', { name: 'Edit' }).click();
    const input = row.locator('input');
    await input.fill(taken.toLowerCase());
    const refused = page.waitForResponse((r) => r.url().endsWith(`/api/crm/deals/${deal.id}`) && r.request().method() === 'PATCH');
    await input.press('Enter');
    expect((await refused).status()).toBe(400);
    const alert = group.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(`Owner of PO ${tag}`);

    const box = (await group.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await group.scrollIntoViewIfNeeded();
    await shot(page, info, `d2-deal-${width}`);
  }
});

/** El aspecto es de la cuenta (users.ui_look manda sobre la cookie zs_look); el usuario demo es compartido. */
async function setLook(request: APIRequestContext, look: (typeof LOOKS)[number]) {
  const res = await request.put('/api/profile/look', { data: { look } });
  expect(res.ok(), await res.text()).toBe(true);
}

test('grupos y ayuda en los cinco aspectos, claro a 1280 y oscuro a 390', async ({ browser, baseURL, request }, info) => {
  test.setTimeout(300_000);
  const tag = uid();
  const { field, deal } = await setup(request, tag);
  try {
    for (const look of LOOKS) {
      await setLook(request, look);
      for (const [theme, width] of [
        ['light', 1280],
        ['dark', 390],
      ] as const) {
        const context = await browser.newContext({ baseURL });
        await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.setViewportSize({ width, height: 900 });

        await page.goto(`/en/app/crm/deals/${deal.id}?tab=properties`, { waitUntil: 'networkidle' });
        await expect(page.locator('html')).toHaveAttribute('data-look', look);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const group = page.locator(`[data-card="deal.custom.billing-${tag}"]`);
        await expect(group.getByTestId('prop-help')).toBeVisible();
        expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
        await group.scrollIntoViewIfNeeded();
        await shot(page, info, `d2-looks-deal-${look}-${theme}-${width}`);

        await page.goto('/en/app/crm/settings?tab=data', { waitUntil: 'networkidle' });
        const item = page.locator(`[data-testid="cf-item"][data-field="${field.name}"]`);
        await expect(item).toBeVisible();
        expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
        await item.scrollIntoViewIfNeeded();
        await shot(page, info, `d2-looks-settings-${look}-${theme}-${width}`);
        expect(errors).toEqual([]);
        await context.close();
      }
    }
  } finally {
    await setLook(request, 'current');
  }
});
