import fs from 'fs';
import path from 'path';
import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * El email como identidad del contacto (lib/crm-contact-email.ts): crear o
 * editar con un email que ya existe muestra el contacto existente con su
 * enlace y no crea nada; Contactos › Duplicados lista un par y abre la fusión.
 * A 1280 y 390, y en los cinco aspectos en claro y oscuro.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const WIDTHS = [1280, 390] as const;
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Captura adjunta al reporte; con E2E_SHOT_DIR además queda en disco para mirarla. */
async function shot(page: Page, info: TestInfo, name: string) {
  const body = await page.screenshot();
  await info.attach(name, { body, contentType: 'image/png' });
  const dir = process.env.E2E_SHOT_DIR;
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.png`), body);
  }
}

async function contact(request: APIRequestContext, data: Record<string, string>): Promise<{ id: string }> {
  const res = await request.post('/api/crm/contacts', { data });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string };
}

async function totalWithEmail(request: APIRequestContext, email: string): Promise<number> {
  const res = await request.get(`/api/crm/contacts?q=${encodeURIComponent(email)}`);
  return ((await res.json()) as { rows: Array<{ email: string }> }).rows.filter((r) => r.email.toLowerCase() === email.toLowerCase()).length;
}

/**
 * Un par de contactos con el mismo email, como los que pudo dejar la app antes
 * de la regla. La API ya no deja crearlos: el segundo se crea con otro email y
 * se le cambia directo en la base.
 */
async function duplicatePair(request: APIRequestContext, tag: string) {
  const email = `pair-${tag}@dupes-e2e.io`;
  const first = await contact(request, { firstName: 'Original', lastName: tag, email });
  const second = await contact(request, { firstName: 'Repetido', lastName: tag, email: `other-${tag}@dupes-e2e.io` });
  const db = e2eDb();
  try {
    // Un minuto después: el orden del grupo (el más antiguo primero) no depende de un empate de segundos.
    await db.execute({
      sql: "UPDATE crm_contacts SET email = ?, created_at = datetime(created_at, '+1 minute') WHERE id = ?",
      args: [email.toUpperCase(), second.id],
    });
  } finally {
    db.close();
  }
  return { email, first, second };
}

test('alta rápida: un email que ya existe muestra el contacto con su enlace y no crea nada (1280 y 390)', async ({ page, request }, info) => {
  test.setTimeout(240_000);
  const tag = uid();
  const email = `taken-${tag}@dupes-e2e.io`;
  const existing = await contact(request, { firstName: 'Existente', lastName: tag, email });

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/en/app/crm/contacts?new=1', { waitUntil: 'networkidle' });
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('First name').fill('Otra');
    // Otras mayúsculas y espacios: es el mismo email.
    await dialog.getByLabel('Email').fill(`  ${email.toUpperCase()} `);
    const answered = page.waitForResponse((r) => r.url().endsWith('/api/crm/contacts') && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    expect((await answered).status()).toBe(409);

    const notice = dialog.getByTestId('contact-email-taken');
    await expect(notice).toContainText(`Existente ${tag}`, { timeout: 20_000 });
    const link = dialog.getByTestId('contact-email-taken-link');
    await expect(link).toHaveAttribute('href', new RegExp(`/app/crm/contacts/${existing.id}$`));
    // El modal sigue abierto con lo escrito, y el aviso entra en la pantalla.
    await expect(dialog).toBeVisible();
    const box = (await notice.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await shot(page, info, `email-taken-quick-${width}`);
    expect(await totalWithEmail(request, email)).toBe(1);

    if (width === 1280) {
      // Esc cierra el modal.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    } else {
      // El enlace lleva al contacto que ya existe.
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/app/crm/contacts/${existing.id}$`), { timeout: 120_000 });
      await expect(page.getByRole('dialog')).toBeHidden();
    }
  }

  // Click afuera también cierra el modal con el aviso a la vista.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/en/app/crm/contacts?new=1', { waitUntil: 'networkidle' });
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog.getByTestId('contact-email-taken')).toBeVisible({ timeout: 20_000 });
  await page.mouse.click(8, 8);
  await expect(dialog).toBeHidden();
});

test('formulario completo: el aviso queda junto al email, enlaza al contacto y no crea nada (1280 y 390)', async ({ page, request }, info) => {
  const tag = uid();
  const email = `full-${tag}@dupes-e2e.io`;
  const existing = await contact(request, { firstName: 'Completa', lastName: tag, email });

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/en/app/crm/contacts/new?full=1', { waitUntil: 'networkidle' });
    await page.locator('#cf-first').fill('Segunda');
    await page.locator('#cf-email').fill(email.toUpperCase());
    const answered = page.waitForResponse((r) => r.url().endsWith('/api/crm/contacts') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create contact' }).click();
    expect((await answered).status()).toBe(409);
    const notice = page.getByTestId('contact-email-taken');
    await expect(notice).toContainText(`Completa ${tag}`);
    await expect(page.getByTestId('contact-email-taken-link')).toHaveAttribute('href', new RegExp(`/app/crm/contacts/${existing.id}$`));
    await expect(page).toHaveURL(/\/contacts\/new/);
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await notice.scrollIntoViewIfNeeded();
    await shot(page, info, `email-taken-form-${width}`);
    // Al corregir el email el aviso se va.
    await page.locator('#cf-email').fill(`libre-${tag}@dupes-e2e.io`);
    await expect(notice).toBeHidden();
  }
  expect(await totalWithEmail(request, email)).toBe(1);
});

test('editar el email en la lista hacia uno que ya existe: avisa con el enlace y deja el valor anterior', async ({ page, request }, info) => {
  const tag = uid();
  const taken = `inline-${tag}@dupes-e2e.io`;
  const existing = await contact(request, { firstName: 'Dueña', lastName: tag, email: taken });
  await contact(request, { firstName: 'Edita', lastName: tag, email: `mine-${tag}@dupes-e2e.io` });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/en/app/crm/contacts?q=${tag}`, { waitUntil: 'networkidle' });
  const row = page.locator('tr', { hasText: `Edita ${tag}` });
  await row.getByRole('button', { name: `mine-${tag}@dupes-e2e.io` }).click();
  const input = row.locator('input[type=email]');
  await input.fill(taken);
  const answered = page.waitForResponse((r) => r.url().includes('/api/crm/contacts/') && r.request().method() === 'PATCH');
  await input.press('Enter');
  expect((await answered).status()).toBe(409);
  await expect(row.getByTestId('contact-email-taken')).toContainText(`Dueña ${tag}`);
  await expect(row.getByTestId('contact-email-taken-link')).toHaveAttribute('href', new RegExp(`/app/crm/contacts/${existing.id}$`));
  await expect(row.getByRole('button', { name: `mine-${tag}@dupes-e2e.io` })).toBeVisible();
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  await shot(page, info, 'email-taken-inline-1280');
});

test('Duplicados: lista el par, abre la fusión con confirmación y lo deja en un solo contacto (1280 y 390)', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  let native = false;
  page.on('dialog', async (d) => {
    native = true;
    await d.dismiss();
  });

  for (const width of WIDTHS) {
    const tag = uid();
    const { email, first, second } = await duplicatePair(request, tag);
    await page.setViewportSize({ width, height: 900 });
    // Se llega desde la lista de contactos.
    await page.goto('/en/app/crm/contacts', { waitUntil: 'networkidle' });
    await page.getByTestId('contacts-find-duplicates').click();
    await expect(page).toHaveURL(/\/app\/crm\/contacts\/duplicates$/, { timeout: 30_000 });

    const group = page.getByTestId('contact-duplicates-group').filter({ hasText: email });
    await expect(group).toHaveCount(1);
    await expect(group.getByRole('link', { name: `Original ${tag}` })).toHaveAttribute('href', new RegExp(`/app/crm/contacts/${first.id}$`));
    await expect(group.getByRole('link', { name: `Repetido ${tag}` })).toHaveAttribute('href', new RegExp(`/app/crm/contacts/${second.id}$`));
    // Por defecto queda el más antiguo.
    await expect(group.getByRole('radio').first()).toBeChecked();
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    const box = (await group.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await group.scrollIntoViewIfNeeded();
    await shot(page, info, `duplicates-list-${width}`);

    await group.getByTestId('contact-duplicates-merge').click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(`Original ${tag}`);
    await shot(page, info, `duplicates-confirm-${width}`);
    // Esc cancela sin fusionar.
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(group).toHaveCount(1);

    await group.getByTestId('contact-duplicates-merge').click();
    const merged = page.waitForResponse((r) => r.url().includes('/api/crm/contacts/merge'));
    await page.getByTestId('confirm-dialog-confirm').click();
    expect((await merged).ok()).toBe(true);
    await expect(group).toHaveCount(0);
    expect(await totalWithEmail(request, email)).toBe(1);
    expect((await request.get(`/api/crm/contacts/${second.id}`)).status()).toBe(404);
  }
  expect(native).toBe(false);
});

const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;

/** El aspecto es de la cuenta (users.ui_look manda sobre la cookie zs_look); el usuario demo es compartido. */
async function setLook(request: APIRequestContext, look: (typeof LOOKS)[number]) {
  const res = await request.put('/api/profile/look', { data: { look } });
  expect(res.ok(), await res.text()).toBe(true);
}

test('el aviso y Duplicados en los cinco aspectos, claro a 1280 y oscuro a 390', async ({ browser, baseURL, request }, info) => {
  test.setTimeout(300_000);
  const tag = uid();
  const email = `looks-${tag}@dupes-e2e.io`;
  await contact(request, { firstName: 'Aspecto', lastName: tag, email });
  const pair = await duplicatePair(request, tag);
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

        await page.goto('/en/app/crm/contacts?new=1', { waitUntil: 'networkidle' });
        await expect(page.locator('html')).toHaveAttribute('data-look', look);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Email').fill(email);
        await dialog.getByRole('button', { name: 'Create', exact: true }).click();
        const notice = dialog.getByTestId('contact-email-taken');
        await expect(notice).toContainText(`Aspecto ${tag}`, { timeout: 20_000 });
        const nb = (await notice.boundingBox())!;
        expect(nb.x + nb.width).toBeLessThanOrEqual(width);
        expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
        await shot(page, info, `looks-notice-${look}-${theme}-${width}`);

        await page.goto('/en/app/crm/contacts/duplicates', { waitUntil: 'networkidle' });
        const group = page.getByTestId('contact-duplicates-group').filter({ hasText: pair.email });
        await expect(group).toHaveCount(1);
        const gb = (await group.boundingBox())!;
        expect(gb.x + gb.width).toBeLessThanOrEqual(width);
        expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
        await group.scrollIntoViewIfNeeded();
        await shot(page, info, `looks-duplicates-${look}-${theme}-${width}`);
        expect(errors).toEqual([]);
        await context.close();
      }
    }
  } finally {
    await setLook(request, 'current');
  }
});
