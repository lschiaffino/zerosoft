import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Arreglos de la pasada de QA del CRM (tanda IA + objetos + leads): edición
 * en línea tipeando de verdad, renombrar registros y leads desde el título,
 * propuestas del asistente que no se repiten tras recargar, plan del deal que
 * recuerda sus tareas, foco al cerrar el asistente abierto desde ⌘K, leads
 * descalificados, selector buscable de contacto y detalles de diseño.
 */
const uid = () => Math.random().toString(36).slice(2, 8);

test.describe.configure({ timeout: 150_000 });

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** Edita una propiedad tipeando tecla por tecla (como una persona) y confirma con Enter. */
async function typeProp(page: Page, label: string, value: string) {
  const row = page.locator('.prop-row').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) });
  await row.getByRole('button', { name: 'Edit' }).click();
  const input = row.locator('input');
  await expect(input).toBeFocused();
  await input.fill('');
  await input.pressSequentially(value, { delay: 15 });
  // Sigue con foco después de tipear (antes se remontaba al primer carácter).
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(value);
  await input.press('Enter');
  await expect(row.locator('.prop-value').first()).toContainText(value);
}

async function deal(request: APIRequestContext, tag: string) {
  const pipelines = await ok<{ rows: Array<{ id: string; stages: Array<{ id: string }> }> }>(request.get('/api/crm/pipelines'));
  const p = pipelines.rows[0];
  return ok<{ id: string }>(request.post('/api/crm/deals', { data: { name: `QA deal ${tag}`, pipelineId: p.id, stageId: p.stages[0].id, amount: 5000 } }));
}

test('propiedades: tipear en línea guarda en contacto, empresa, deal, lead y registro de objeto', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const contact = await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Ines', lastName: tag, email: `ines.${tag}@qa.example.com` } }));
  const company = await ok<{ id: string }>(request.post('/api/crm/companies', { data: { name: `Qa Co ${tag}` } }));
  const d = await deal(request, tag);
  const lead = await ok<{ id: string }>(request.post('/api/crm/leads', { data: { name: `QA lead ${tag}` } }));
  const obj = await ok<{ id: string; slug: string }>(
    request.post('/api/crm/objects', { data: { singular: `Boat ${tag}`, plural: `Boats ${tag}`, primaryLabel: 'Hull' } }),
  );
  const rec = await ok<{ id: string }>(request.post(`/api/crm/objects/${obj.id}/records`, { data: { name: `H-${tag}` } }));

  await page.goto(`/en/app/crm/contacts/${contact.id}?tab=properties`, { waitUntil: 'networkidle' });
  await typeProp(page, 'Job title', `Head of Sales ${tag}`);
  await page.goto(`/en/app/crm/companies/${company.id}?tab=properties`, { waitUntil: 'networkidle' });
  await typeProp(page, 'Name', `Qa Company ${tag}`);
  await page.goto(`/en/app/crm/deals/${d.id}?tab=properties`, { waitUntil: 'networkidle' });
  await typeProp(page, 'Name', `QA deal renamed ${tag}`);
  await page.goto(`/en/app/crm/leads/${lead.id}?tab=properties`, { waitUntil: 'networkidle' });
  await typeProp(page, 'Lead name', `QA lead typed ${tag}`);
  await page.goto(`/en/app/crm/objects/${obj.slug}/${rec.id}?tab=properties`, { waitUntil: 'networkidle' });
  await typeProp(page, 'Hull', `H2-${tag}`);

  // Persistido en el servidor.
  expect((await ok<{ contact: { job_title: string } }>(request.get(`/api/crm/contacts/${contact.id}`))).contact.job_title).toBe(`Head of Sales ${tag}`);
  expect((await ok<{ name: string }>(request.get(`/api/crm/leads/${lead.id}`))).name).toBe(`QA lead typed ${tag}`);
  expect((await ok<{ name: string }>(request.get(`/api/crm/records/${rec.id}`))).name).toBe(`H2-${tag}`);
  expect(errors).toEqual([]);
});

test('renombrar lead y registro de objeto desde el título', async ({ page, request }) => {
  const tag = uid();
  const lead = await ok<{ id: string }>(request.post('/api/crm/leads', { data: { name: `Rename lead ${tag}` } }));
  const obj = await ok<{ id: string; slug: string }>(
    request.post('/api/crm/objects', { data: { singular: `Truck ${tag}`, plural: `Trucks ${tag}`, primaryLabel: 'Plate' } }),
  );
  const rec = await ok<{ id: string }>(request.post(`/api/crm/objects/${obj.id}/records`, { data: { name: `T-${tag}` } }));

  for (const [url, name] of [
    [`/en/app/crm/leads/${lead.id}`, `Renamed lead ${tag}`],
    [`/en/app/crm/objects/${obj.slug}/${rec.id}`, `T-renamed-${tag}`],
  ] as const) {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.getByTestId('record-rename').click();
    const input = page.getByRole('textbox', { name: 'Rename' });
    await expect(input).toBeFocused();
    await input.pressSequentially(name, { delay: 10 });
    await input.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
    await expect(page.getByTestId('record-rename')).toBeFocused();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
  }
  // Esc cancela sin guardar.
  await page.getByTestId('record-rename').click();
  await page.getByRole('textbox', { name: 'Rename' }).fill('nope');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`T-renamed-${tag}`);
});

test('asistente: propuestas confirmadas o descartadas no vuelven tras recargar; Esc desde ⌘K devuelve el foco', async ({ page, request }) => {
  test.slow();
  const tag = uid();
  const d = await deal(request, tag);
  await page.goto(`/en/app/crm/deals/${d.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Ask AI' }).click();
  const panel = page.getByRole('dialog', { name: 'CRM assistant' });
  const input = panel.getByRole('textbox', { name: 'Ask about the CRM…' });

  await input.fill(`Create a task: confirm budget ${tag}`);
  await input.press('Enter');
  const first = panel.getByTestId('ai-proposal').last();
  await expect(first).toContainText(`confirm budget ${tag}`);
  await first.getByRole('button', { name: 'Confirm' }).click();
  await expect(first).toContainText('Done.');

  await input.fill(`Create a task: skip this ${tag}`);
  await input.press('Enter');
  const second = panel.getByTestId('ai-proposal').last();
  await expect(second).toContainText(`skip this ${tag}`);
  await second.getByRole('button', { name: 'Dismiss' }).click();
  await expect(second).toContainText('Dismissed.');

  // El launcher de feedback no tapa "Send".
  const send = await panel.getByRole('button', { name: 'Send' }).boundingBox();
  const fl = await page.locator('.fl-root').boundingBox().catch(() => null);
  if (send && fl) {
    const overlap = send.x < fl.x + fl.width && fl.x < send.x + send.width && send.y < fl.y + fl.height && fl.y < send.y + send.height;
    expect(overlap).toBe(false);
  }

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Ask AI' }).click();
  const after = page.getByRole('dialog', { name: 'CRM assistant' });
  const confirmed = after.getByTestId('ai-proposal').filter({ hasText: `confirm budget ${tag}` });
  const dismissed = after.getByTestId('ai-proposal').filter({ hasText: `skip this ${tag}` });
  await expect(confirmed).toContainText('Done.');
  await expect(confirmed.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
  await expect(dismissed).toContainText('Dismissed.');
  await expect(dismissed.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
  // Se aplicó una sola vez.
  const tasks = await ok<{ rows: Array<{ subject: string }> }>(request.get(`/api/crm/activities?dealId=${d.id}&type=task`));
  expect(tasks.rows.filter((r) => r.subject === `confirm budget ${tag}`)).toHaveLength(1);
  expect(tasks.rows.some((r) => r.subject === `skip this ${tag}`)).toBe(false);

  // Abierto desde ⌘K: Esc lo cierra y el foco vuelve al botón Ask AI.
  await page.keyboard.press('Escape');
  await expect(after).toBeHidden();
  // Sin nada enfocado (como en el QA): el foco previo es el body.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('Ask the CRM');
  await page.getByText('Ask the CRM assistant').first().click();
  await expect(after).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(after).toBeHidden();
  await expect(page.locator('[data-crm-assistant-trigger]')).toBeFocused();
});

test('plan del deal: el paso pasado a tarea queda marcado tras recargar y no se duplica', async ({ page, request }) => {
  const tag = uid();
  const d = await deal(request, tag);
  await page.goto(`/en/app/crm/deals/${d.id}`, { waitUntil: 'networkidle' });
  const score = page.getByRole('region', { name: /Deal score/ });
  // La tarjeta no hereda el padding de sección de la landing.
  expect(await score.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('0px');
  expect(await page.getByRole('region', { name: 'AI summary' }).evaluate((el) => getComputedStyle(el).paddingTop)).toBe('0px');
  await score.getByRole('button', { name: 'Score deal' }).click();
  const first = score.getByRole('button', { name: /^Add task:/ }).first();
  const title = ((await first.getAttribute('aria-label')) ?? '').replace('Add task: ', '');
  await first.click();
  const step = score.locator('.ai-plan li').filter({ hasText: title });
  await expect(step).toContainText('Task added');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(step).toContainText('Task added');
  await expect(step.getByRole('button', { name: /^Add task:/ })).toHaveCount(0);
  // Una sola vez, también por API.
  const again = await request.patch('/api/crm/ai/deal-score', { data: { id: d.id, index: 0, dueAt: '2030-01-01 09:00' } });
  expect(again.status()).toBe(409);
  const tasks = await ok<{ rows: Array<{ subject: string }> }>(request.get(`/api/crm/activities?dealId=${d.id}&type=task`));
  expect(tasks.rows.filter((r) => r.subject === title)).toHaveLength(1);
});

test('leads: contacto buscable al crear, descalificado no se convierte, diálogo centrado', async ({ page, request }) => {
  const tag = uid();
  const contact = await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Zelda', lastName: `Search${tag}`, email: `z.${tag}@qa.example.com` } }));
  await page.goto('/en/app/crm/leads', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New lead' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New lead' });
  const combo = dialog.getByRole('combobox', { name: 'Contact' });
  await combo.click();
  await combo.pressSequentially(`Search${tag}`, { delay: 15 });
  await expect(dialog.getByRole('option', { name: `Zelda Search${tag}` })).toBeVisible();
  await combo.press('Enter');
  await expect(combo).toHaveValue(`Zelda Search${tag}`);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Zelda Search${tag}`);
  const leadId = page.url().split('/').pop()!.split('?')[0];
  expect((await ok<{ contact_id: string }>(request.get(`/api/crm/leads/${leadId}`))).contact_id).toBe(contact.id);

  await page.getByRole('button', { name: 'Disqualify' }).click();
  const dq = page.getByRole('dialog', { name: 'Disqualify lead' });
  const box = await dq.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(Math.abs(box!.y + box!.height / 2 - vh / 2)).toBeLessThan(40);
  await dq.getByLabel('Reason').fill('No budget');
  await dq.getByRole('button', { name: 'Disqualify' }).click();
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await expect(page.getByTestId('lead-convert')).toHaveCount(0);
  const conv = await request.post(`/api/crm/leads/${leadId}/convert`, { data: {} });
  expect(conv.status()).toBe(409);
  expect(((await conv.json()) as { error: string }).error).toBe('lead_disqualified');
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByTestId('lead-convert')).toBeVisible();
});

test('objetos: estado vacío con el plural en minúscula; logo roto cae a iniciales', async ({ page, request }) => {
  const tag = uid();
  const obj = await ok<{ slug: string }>(request.post('/api/crm/objects', { data: { singular: `Vehicle${tag}`, plural: `Vehicles${tag}`, primaryLabel: 'Plate' } }));
  await page.goto(`/en/app/crm/objects/${obj.slug}`, { waitUntil: 'networkidle' });
  await expect(page.getByText(`No vehicles${tag} yet`)).toBeVisible();

  const company = await ok<{ id: string }>(request.post('/api/crm/companies', { data: { name: `Broken Logo ${tag}`, domain: `nologo-${tag}.invalid` } }));
  await page.goto(`/en/app/crm/companies/${company.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.co-logo-initials').first()).toBeVisible();
  const broken = await page.locator('img.co-logo').evaluateAll((imgs) => imgs.filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth === 0).length);
  expect(broken).toBe(0);
});

test('workflows: en la revisión, el paso de IA muestra su prompt recortado', async ({ page }) => {
  await page.goto('/en/app/crm/workflows/new', { waitUntil: 'networkidle' });
  await expect(async () => {
    await page.getByTestId('workflow-wizard-next').click();
    await expect(page.getByTestId('workflow-action')).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  const action = page.getByTestId('workflow-action');
  await action.getByRole('combobox', { name: 'Action 1' }).selectOption('ai_step');
  const prompt = `Classify this lead by industry and size, then suggest the best next step for the rep ${'x'.repeat(40)}`;
  await action.getByLabel('Prompt').fill(prompt);
  await page.getByTestId('workflow-wizard-next').click();
  const summary = page.locator('.wf-summary');
  await expect(summary).toContainText('«Classify this lead by industry and size');
  await expect(summary).toContainText('…»');
  await expect(summary).not.toContainText(prompt);
});
