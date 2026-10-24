import { expect, test, type Page } from '@playwright/test';

/**
 * Canales del CRM: Outlook / Microsoft 365 contra Graph falso (MS_GRAPH_FAKE)
 * y llamadas desde el navegador con el dispositivo simulado (CRM_VOICE_FAKE).
 * La IA está apagada en el e2e: el resumen de la llamada muestra ai_disabled.
 */

test.describe.configure({ mode: 'serial' });

const uid = () => Math.random().toString(36).slice(2, 7);

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('Outlook: conectar, sincronizar emails y reuniones, enviar y desconectar', async ({ page, request }) => {
  const errors = watchErrors(page);
  const contact = await (
    await request.post('/api/crm/contacts', { data: { firstName: 'Ana', lastName: 'Outlook', email: 'ana@fake-outlook.test' } })
  ).json();

  await page.goto('/en/app/crm/settings?tab=integrations');
  await expect(page.getByRole('heading', { name: 'Outlook and Microsoft 365' })).toBeVisible();
  await page.getByRole('link', { name: 'Connect Outlook' }).click();
  await expect(page).toHaveURL(/outlook=connected/);
  await expect(page.getByText('Outlook connected. The first sync brings the last 30 days.')).toBeVisible();
  await expect(page.getByText('Connected as demo.outlook@fake-outlook.test')).toBeVisible();

  await page.getByRole('button', { name: 'Sync now' }).first().click();
  await expect(page.getByText('2 new emails · 1 meeting')).toBeVisible();

  await page.goto(`/en/app/crm/contacts/${contact.id}`);
  await expect(page.getByText('Question about the proposal').first()).toBeVisible();
  await expect(page.getByText('Pricing review with Ana')).toBeVisible();

  // Enviar desde el CRM sale por Outlook (sin Gmail conectado).
  const sent = await request.post('/api/crm/emails', {
    data: { recordType: 'contact', recordId: contact.id, to: 'ana@fake-outlook.test', subject: `Proposal ${uid()}`, body: 'Here is the proposal.' },
  });
  expect(sent.status()).toBe(201);
  expect((await sent.json()).via).toBe('outlook');

  await page.goto('/en/app/crm/settings?tab=integrations');
  const panel = page.locator('.outlook-panel');
  await panel.getByRole('button', { name: 'Disconnect' }).click();
  await expect(panel.getByRole('link', { name: 'Connect Outlook' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('llamada desde el navegador: ajustes, llamar desde la ficha, registro, grabación y transcripción', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.goto('/en/app/crm/settings?tab=integrations');
  const voice = page.locator('.voice-panel');
  await expect(page.getByRole('heading', { name: 'Browser calling' })).toBeVisible();
  await voice.getByLabel('Workspace number').fill('+1 415 555 0100');
  await voice.getByLabel('Record calls').check();
  await expect(voice.getByRole('textbox', { name: 'Notice' })).toHaveValue('This call may be recorded and transcribed.');
  await voice.getByRole('button', { name: 'Save' }).click();
  await expect(voice.getByText('Saved')).toBeVisible();

  const contact = await (
    await request.post('/api/crm/contacts', { data: { firstName: 'Bruno', lastName: `Calls ${uid()}`, phone: '+54 9 11 5555 0101' } })
  ).json();
  await page.goto(`/en/app/crm/contacts/${contact.id}`);
  const callBtn = page.getByRole('button', { name: 'Call from browser' }).first();
  await expect(callBtn).toBeVisible();
  await callBtn.click();

  const dock = page.getByRole('dialog', { name: 'Browser call' });
  await expect(dock).toBeVisible();
  await expect(dock.getByText('This call is recorded.', { exact: false })).toBeVisible();
  await expect(dock.getByText(/^0:0\d$/)).toBeVisible({ timeout: 10_000 });
  await expect(dock.getByRole('button', { name: 'Mute' })).toBeEnabled();
  await dock.getByRole('button', { name: 'Mute' }).click();
  await expect(dock.getByRole('button', { name: 'Unmute' })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1200);
  await dock.getByRole('button', { name: 'Hang up' }).click();
  await expect(dock.getByText(/Call ended/)).toBeVisible();
  await dock.getByLabel('Outcome').selectOption('connected');
  await dock.getByLabel('Note').fill('Wants to start in March');
  await dock.getByRole('button', { name: 'Save' }).click();
  await expect(dock).toBeHidden();

  const item = page.locator('.tl-item').filter({ hasText: 'Browser call' }).filter({ hasText: 'Wants to start in March' }).first();
  await expect(item).toBeVisible();
  await expect(item.locator('audio')).toHaveAttribute('src', /\/api\/crm\/voice\/calls\/.+\/recording/);
  await item.getByText('Transcript (3 lines)').click();
  await expect(item.getByText('The price works, but we need to start in March.')).toBeVisible();
  await expect(item.getByText('AI is turned off on this server', { exact: false })).toBeVisible();

  const audioSrc = await item.locator('audio').getAttribute('src');
  const audio = await request.get(audioSrc!);
  expect(audio.status()).toBe(200);
  expect(audio.headers()['content-type']).toBe('audio/wav');

  // A 390 px el panel entra sin scroll horizontal.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Call from browser' }).first().click();
  await expect(dock).toBeVisible();
  await noHorizontalScroll(page);
  const box = await dock.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await dock.getByRole('button', { name: 'Hang up' }).click();
  await expect(dock.getByText(/Call ended/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dock).toBeHidden();
  expect(errors).toEqual([]);
});

test('llamadas: número sin código de país y webhooks sin firma', async ({ request }) => {
  const contact = await (await request.post('/api/crm/contacts', { data: { firstName: 'Local', phone: '11 5555 0100' } })).json();
  const res = await request.post('/api/crm/voice/calls', { data: { to: '11 5555 0100', contactId: contact.id } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe('invalid_number');
  const twiml = await request.post('/api/crm/voice/twiml', { form: { CallId: 'x', From: 'client:zs_x', CallSid: 'CA1' } });
  expect(twiml.status()).toBe(403);
  expect(await twiml.text()).toContain('<Reject/>');
});
