import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines: estado online / away / offline en el menú de la cuenta y la opción
 * de reasignar al desconectarse en las reglas de Ajustes › Asignación.
 * Contra el proveedor falso; nada sale a WhatsApp.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function fakeNumber(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Presence ${uid()}` } });
  expect(created.ok(), await created.text()).toBe(true);
  return ((await created.json()) as { id: string }).id;
}

async function setStatus(request: APIRequestContext, status: string) {
  const res = await request.put('/api/groups/availability', { data: { status } });
  expect(res.ok(), await res.text()).toBe(true);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

test.afterEach(async ({ request }) => {
  // Otros tests de Lines asignan con la persona demo online.
  await setStatus(request, 'online');
});

test('estado en el menú de la cuenta: tres opciones, una marcada, Esc cierra', async ({ page, request }) => {
  const errors = watchErrors(page);
  await setStatus(request, 'online');
  await page.goto('/en/app/lines', { waitUntil: 'networkidle' });
  const switcher = page.getByTestId('workspace-switcher');
  await switcher.click();
  const group = page.getByTestId('side-presence');
  await expect(group.getByRole('menuitemradio')).toHaveCount(3);
  await expect(page.getByTestId('side-presence-online')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('side-presence-away')).toHaveAttribute('aria-checked', 'false');

  const saved = page.waitForResponse((r) => r.url().endsWith('/api/groups/availability') && r.request().method() === 'PUT');
  await page.getByTestId('side-presence-away').click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByTestId('side-presence-away')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('side-presence-online')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(group).toBeHidden();

  // Sobrevive a la recarga y se ve en Ajustes › Asignación.
  await page.goto('/en/app/lines/settings?tab=assignment', { waitUntil: 'networkidle' });
  const me = ((await (await request.get('/api/groups/availability')).json()) as { me: string }).me;
  expect(me).toBe('away');
  await expect(page.locator('[data-testid="presence-row"][data-presence="away"]')).toHaveCount(1);
  await switcher.click();
  await expect(page.getByTestId('side-presence-away')).toHaveAttribute('aria-checked', 'true');

  // Teclado: flechas recorren el menú y Enter elige offline.
  await page.getByTestId('side-presence-offline').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('side-presence-offline')).toHaveAttribute('aria-checked', 'true');
  // Clic afuera cierra.
  await page.mouse.click(900, 300);
  await expect(group).toBeHidden();
  expect(errors).toEqual([]);
});

test('API: valida el estado y acepta el formato viejo', async ({ request }) => {
  expect((await request.put('/api/groups/availability', { data: { status: 'busy' } })).status()).toBe(400);
  const old = await request.put('/api/groups/availability', { data: { available: false } });
  expect(((await old.json()) as { me: string }).me).toBe('offline');
  await setStatus(request, 'online');
  expect(((await (await request.get('/api/groups/availability')).json()) as { me: string }).me).toBe('online');
});

test('regla: reasignar al desconectarse, apagado por defecto y se prende en el diálogo', async ({ page, request }) => {
  const errors = watchErrors(page);
  const numberId = await fakeNumber(request);
  const name = `Presence ${uid()}`;
  // Un equipo vacío alcanza: la regla solo tiene que existir para editarla.
  const team = await request.post('/api/groups/teams', { data: { name, memberIds: [] } });
  expect(team.ok(), await team.text()).toBe(true);
  const teamId = ((await team.json()) as { id: string }).id;
  const created = await request.post('/api/groups/rules', { data: { name, numberId, teamId } });
  expect(created.status(), await created.text()).toBe(201);
  const rule = (await created.json()) as { id: string; reassignOffline: boolean };
  expect(rule.reassignOffline).toBe(false);
  try {
    await page.goto('/en/app/lines/settings?tab=assignment', { waitUntil: 'networkidle' });
    const row = page.locator('.gr-mini-list li', { hasText: name });
    await expect(row.getByTestId('rule-reassign-offline')).toHaveCount(0);
    await row.getByTestId('rule-edit').click();
    const dialog = page.getByRole('dialog');
    const box = dialog.getByTestId('rule-reassign-offline-input');
    await expect(box).not.toBeChecked();
    await box.check();
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).toBeHidden();
    await expect(row.getByTestId('rule-reassign-offline')).toBeVisible();
    const rules = ((await (await request.get('/api/groups/rules')).json()) as { rules: Array<{ id: string; reassignOffline: boolean }> }).rules;
    expect(rules.find((r) => r.id === rule.id)?.reassignOffline).toBe(true);
  } finally {
    await request.delete(`/api/groups/rules/${rule.id}`);
    await request.delete(`/api/groups/teams/${teamId}`);
  }
  expect(errors).toEqual([]);
});
