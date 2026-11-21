import fs from 'fs';
import path from 'path';
import { expect as baseExpect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

/**
 * CRM, bloque D3: labels de asociación propios del workspace. Ajustes › Datos
 * los crea, renombra y borra; la ficha del contacto y la del deal los ofrecen
 * en las tarjetas de asociaciones. A 1280 y 390, y en los cinco aspectos en
 * claro y oscuro. Los registros se crean por API y se abren por id (la cuenta
 * demo es compartida).
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const WIDTHS = [1280, 390] as const;
const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;
test.describe.configure({ timeout: 180_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const card = (page: Page, id: string) => page.locator(`[data-card="${id}"]`);

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

/** A 390 las asociaciones son una pestaña de la ficha. */
async function openAssociations(page: Page, width: number) {
  if (width < 700) {
    const related = page.getByTestId('record-tab-related');
    await related.click();
    await expect(page).toHaveURL(/[?&]tab=related/);
  }
}

interface Seed {
  tag: string;
  contactName: string;
  companyName: string;
  ids: { contact: string; company: string; deal: string };
  labels: { billing: { id: string; name: string }; decider: { id: string; name: string } };
}

/** Una empresa, un contacto en ella, un deal con el contacto y un label propio por par. */
async function seed(request: APIRequestContext): Promise<Seed> {
  const tag = uid();
  const companyName = `Labels Co ${tag}`;
  const company = await ok<{ id: string }>(request.post('/api/crm/companies', { data: { name: companyName } }), 201);
  const contact = await ok<{ id: string }>(
    request.post('/api/crm/contacts', { data: { firstName: 'Lara', lastName: `Labels ${tag}`, companyId: company.id } }),
    201,
  );
  const pipelines = await ok<{ rows: Array<{ id: string; stages: Array<{ id: string }> }> }>(request.get('/api/crm/pipelines'));
  const pipeline = pipelines.rows.find((p) => p.stages.length > 0)!;
  const deal = await ok<{ id: string }>(
    request.post('/api/crm/deals', {
      data: { name: `Labels deal ${tag}`, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, contactIds: [contact.id] },
    }),
    201,
  );
  const billing = await ok<{ id: string; name: string }>(
    request.post('/api/crm/association-labels', { data: { pair: 'contact_company', name: `Billing ${tag}` } }),
    201,
  );
  const decider = await ok<{ id: string; name: string }>(
    request.post('/api/crm/association-labels', { data: { pair: 'deal_contact', name: `Decider ${tag}` } }),
    201,
  );
  return {
    tag,
    contactName: `Lara Labels ${tag}`,
    companyName,
    ids: { contact: contact.id, company: company.id, deal: deal.id },
    labels: { billing, decider },
  };
}

async function cleanup(request: APIRequestContext, s: Seed) {
  for (const l of [s.labels.billing, s.labels.decider]) await request.delete(`/api/crm/association-labels?id=${l.id}`);
}

test('Ajustes › Datos: crear, renombrar y borrar labels de asociación (1280 y 390)', async ({ page, request }, info) => {
  const tag = uid();
  const name = `Champion ${tag}`;
  try {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/en/app/crm/settings?tab=data', { waitUntil: 'networkidle' });
      const panel = page.getByTestId('assoc-labels');
      await expect(panel).toBeVisible();
      const group = page.getByTestId('assoc-labels-deal_contact');
      if (width === 1280) {
        await page.getByTestId('assoc-labels-input-deal_contact').fill(name);
        const created = page.waitForResponse((r) => r.url().includes('/api/crm/association-labels') && r.request().method() === 'POST');
        await page.getByTestId('assoc-labels-input-deal_contact').press('Enter');
        expect((await created).status()).toBe(201);
        // Renombrar: Esc deshace, Enter guarda.
        const input = group.getByRole('textbox', { name: `Label name: ${name}` });
        await input.fill('Discarded');
        await input.press('Escape');
        await expect(input).toHaveValue(name);
        await input.fill(`${name} lead`);
        const renamed = page.waitForResponse((r) => r.url().includes('/api/crm/association-labels') && r.request().method() === 'PATCH');
        await input.press('Enter');
        expect((await renamed).status()).toBe(200);
      }
      await expect(group.getByRole('textbox', { name: `Label name: ${name} lead` })).toHaveValue(`${name} lead`);
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      const box = (await panel.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await panel.scrollIntoViewIfNeeded();
      await shot(page, info, `d3-settings-${width}`);
    }
    // Borrar.
    const del = page.waitForResponse((r) => r.url().includes('/api/crm/association-labels?id=') && r.request().method() === 'DELETE');
    await page.getByTestId('assoc-labels-deal_contact').getByRole('button', { name: `Delete label: ${name} lead` }).click();
    expect((await del).status()).toBe(204);
    await expect(page.getByTestId('assoc-labels-deal_contact').getByRole('textbox', { name: `Label name: ${name} lead` })).toHaveCount(0);
  } finally {
    const list = await ok<{ rows: Array<{ id: string; name: string }> }>(request.get('/api/crm/association-labels'));
    for (const l of list.rows.filter((r) => r.name.includes(tag))) await request.delete(`/api/crm/association-labels?id=${l.id}`);
  }
});

test('la ficha pone labels propios en contacto ↔ empresa y deal ↔ contacto (1280 y 390)', async ({ page, request }, info) => {
  const s = await seed(request);
  try {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });

      // Contacto: label de su empresa.
      await page.goto(`/en/app/crm/contacts/${s.ids.contact}`, { waitUntil: 'networkidle' });
      await openAssociations(page, width);
      const companies = card(page, 'contact.companies');
      const companySelect = companies.getByRole('combobox', { name: `Label ${s.companyName}` });
      const value = width === 1280 ? `custom:${s.labels.billing.id}` : 'decision_maker';
      await companySelect.selectOption(value);
      await expect
        .poll(async () => {
          const a = await ok<{ companies: Array<{ id: string; label: string }> }>(
            request.get(`/api/crm/associations?type=contact&id=${s.ids.contact}`),
          );
          return a.companies.find((c) => c.id === s.ids.company)?.label;
        })
        .toBe(value);
      await expect(companySelect).toHaveValue(value);
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await companies.scrollIntoViewIfNeeded();
      await shot(page, info, `d3-contact-${width}`);

      // Deal: label del contacto.
      await page.goto(`/en/app/crm/deals/${s.ids.deal}`, { waitUntil: 'networkidle' });
      await openAssociations(page, width);
      const contacts = card(page, 'deal.contacts');
      const contactSelect = contacts.getByRole('combobox', { name: `Label ${s.contactName}` });
      const dealValue = width === 1280 ? `custom:${s.labels.decider.id}` : '';
      await contactSelect.selectOption(dealValue);
      await expect
        .poll(async () => {
          const a = await ok<{ contacts: Array<{ id: string; label: string }> }>(
            request.get(`/api/crm/associations?type=deal&id=${s.ids.deal}`),
          );
          return a.contacts.find((c) => c.id === s.ids.contact)?.label;
        })
        .toBe(dealValue);
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      const box = (await contacts.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await contacts.scrollIntoViewIfNeeded();
      await shot(page, info, `d3-deal-${width}`);
    }
  } finally {
    await cleanup(request, s);
  }
});

/** El aspecto es de la cuenta (users.ui_look manda sobre la cookie zs_look); el usuario demo es compartido. */
async function setLook(request: APIRequestContext, look: (typeof LOOKS)[number]) {
  const res = await request.put('/api/profile/look', { data: { look } });
  expect(res.ok(), await res.text()).toBe(true);
}

test('labels en los cinco aspectos, claro a 1280 y oscuro a 390', async ({ browser, baseURL, request }, info) => {
  test.setTimeout(300_000);
  const s = await seed(request);
  await ok(
    request.post('/api/crm/associations', {
      data: { fromType: 'deal', fromId: s.ids.deal, toType: 'contact', toId: s.ids.contact, label: `custom:${s.labels.decider.id}` },
    }),
  );
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

        await page.goto(`/en/app/crm/deals/${s.ids.deal}`, { waitUntil: 'networkidle' });
        await expect(page.locator('html')).toHaveAttribute('data-look', look);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await openAssociations(page, width);
        const contacts = card(page, 'deal.contacts');
        await expect(contacts.getByRole('combobox', { name: `Label ${s.contactName}` })).toHaveValue(`custom:${s.labels.decider.id}`);
        expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
        await contacts.scrollIntoViewIfNeeded();
        await shot(page, info, `d3-looks-deal-${look}-${theme}-${width}`);

        await page.goto('/en/app/crm/settings?tab=data', { waitUntil: 'networkidle' });
        const panel = page.getByTestId('assoc-labels');
        await expect(panel).toBeVisible();
        expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
        await panel.scrollIntoViewIfNeeded();
        await shot(page, info, `d3-looks-settings-${look}-${theme}-${width}`);
        expect(errors).toEqual([]);
        await context.close();
      }
    }
  } finally {
    await setLook(request, 'current');
    await cleanup(request, s);
  }
});
