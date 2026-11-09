import { expect, test, type Page } from '@playwright/test';

/**
 * Voice como Granola: la reunión nueva escucha sola (con micrófono falso de
 * Chromium), los errores del micrófono, el chat de a pedazos con citas a la
 * transcripción y entre reuniones, en 1280 y 390, claro y oscuro.
 * Transcripción e IA falsas (VOICE_TRANSCRIBE_PROVIDER=fake, VOICE_AI_FAKE=1).
 */
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
});

test.beforeEach(async ({ page, context, baseURL }) => {
  // Graban de verdad (trozos de 1,5 s) y esperan a la IA falsa: más que el minuto por defecto.
  test.setTimeout(180_000);
  await context.grantPermissions(['microphone'], { origin: baseURL! });
  await page.addInitScript(() => {
    (window as unknown as { __zsVoiceChunkMs: number }).__zsVoiceChunkMs = 1500;
  });
});

const uid = () => Math.random().toString(36).slice(2, 8);

async function noHorizontalScroll(page: Page, what: string) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `${what}: scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
}

/** Reunión nueva desde la lista: escucha sola; se graba un rato y se corta. */
async function recordMeeting(page: Page, title: string) {
  await page.goto('/en/app/voice', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New meeting' }).first().click();
  await expect(page).toHaveURL(/\/app\/voice\/meetings\/[^?]+$/, { timeout: 30_000 });
  await expect(page.getByRole('timer')).toBeVisible({ timeout: 15_000 });
  const titleInput = page.getByRole('textbox', { name: 'Meeting title' });
  await titleInput.fill(title);
  await titleInput.press('Enter');
  await expect(page.locator('.vc-seg').first()).toBeVisible({ timeout: 20_000 });
  return page.url().split('/').pop()!;
}

test('la reunión nueva escucha sola; un link externo con ?new=1 no prende el micrófono', async ({ page, request }) => {
  const title = `Autostart ${uid()}`;
  const id = await recordMeeting(page, title);
  // Mientras escucha: el chat sugiere preguntas para el durante.
  await page.getByRole('combobox', { name: 'Ask about this meeting' }).click();
  await expect(page.getByText('Ask anything while the meeting goes on.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'What did I miss in the last few minutes?' })).toBeVisible();
  await page.getByRole('button', { name: 'What has been decided so far?' }).click();
  await expect(page.locator('.vc-msg.is-assistant').first()).not.toBeEmpty({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect.poll(async () => ((await (await request.get(`/api/voice/sessions/${id}`)).json()) as { status: string }).status, { timeout: 25_000 }).toBe('done');

  // Abrir /app/voice?new=1 de afuera (sin interacción): crea la reunión pero no escucha.
  const other = await page.context().newPage();
  await other.goto('/en/app/voice?new=1');
  await expect(other).toHaveURL(/\/app\/voice\/meetings\/[^?]+$/, { timeout: 30_000 });
  await expect(other.getByRole('button', { name: 'Start recording' })).toBeVisible();
  await other.waitForTimeout(800);
  await expect(other.getByRole('timer')).toHaveCount(0);
  await other.close();

  // Recargar una reunión ya creada tampoco vuelve a empezar.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Keep recording' })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveCount(0);

  // Desde ⌘K (navegación dentro de la app): escucha sola.
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByRole('combobox').fill('New meeting');
  await dialog.getByRole('option', { name: /New meeting/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/app/voice/meetings/(?!${id})[^?]+$`), { timeout: 30_000 });
  await expect(page.getByRole('timer')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});

for (const [name, error, message] of [
  ['NotAllowedError', 'permiso denegado', 'Microphone access was blocked'],
  ['NotFoundError', 'sin micrófono', 'No microphone was found'],
] as const) {
  test(`micrófono: ${error} muestra el aviso y deja reintentar`, async ({ page }) => {
    await page.addInitScript((errName) => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('blocked', errName));
    }, name);
    await page.goto('/en/app/voice', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'New meeting' }).first().click();
    await expect(page).toHaveURL(/\/app\/voice\/meetings\//, { timeout: 30_000 });
    await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled();
    await expect(page.getByRole('timer')).toHaveCount(0);
    // Las notas se pueden escribir igual.
    await page.getByRole('textbox', { name: 'My notes' }).fill('Typed without audio');
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 15_000 });
  });
}

test('chat: respuesta de a pedazos con citas que llevan a la transcripción, y entre reuniones', async ({ page, baseURL }) => {
  const title = `Billing call ${uid()}`;
  const id = await recordMeeting(page, title);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByTestId('voice-enhanced')).toBeVisible({ timeout: 25_000 });

  // Después de la reunión: sugerencias del después y una pregunta propia.
  await page.getByRole('combobox', { name: 'Ask about this meeting' }).click();
  await expect(page.getByRole('button', { name: 'What are the action items and who owns them?' })).toBeVisible();
  const streamed = page.waitForResponse((r) => r.url().endsWith(`/api/voice/sessions/${id}/chat`) && r.request().method() === 'POST');
  await page.getByRole('combobox', { name: 'Ask about this meeting' }).fill('What did they say about billing?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  expect((await streamed).headers()['content-type']).toContain('ndjson');
  const answer = page.locator('.vc-msg.is-assistant').last();
  await expect(answer).toContainText(/annual billing/i, { timeout: 20_000 });
  const cite = answer.locator('button.vc-cite').first();
  await expect(cite).toHaveText(/^\d{2}:\d{2}$/);
  await cite.click();
  await expect(page.getByTestId('voice-live-panel')).toBeVisible();
  await expect(page.locator('.vc-seg.is-focus')).toBeVisible();
  // El chat queda guardado con la cita.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('combobox', { name: 'Ask about this meeting' }).click();
  await expect(page.locator('.vc-msg.is-assistant .vc-cite').first()).toBeVisible();

  // Entre reuniones: sugerencias, respuesta con link a la reunión y al momento, y seguimiento.
  await page.goto('/en/app/voice', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'What did we agree on last week?' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Ask your meetings' }).fill('Who wants annual billing?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const turn = page.locator('.vc-turn').first();
  await expect(turn.locator('.vc-answer')).toContainText(/annual billing/i, { timeout: 20_000 });
  await expect(turn.locator('.vc-sources')).toContainText(title, { timeout: 20_000 });
  const link = turn.locator('a.vc-cite').first();
  await expect(link).toHaveAttribute('href', /\/app\/voice\/meetings\/[^?]+\?t=\d+/);
  await expect(page.getByRole('button', { name: 'New question' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Ask your meetings' }).fill('And about billing per seat?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.locator('.vc-turn')).toHaveCount(2);
  await expect(page.locator('.vc-turn').nth(1).locator('.vc-answer')).not.toContainText('Looking…', { timeout: 15_000 });
  await link.click();
  await expect(page).toHaveURL(/\/app\/voice\/meetings\/[^?]+\?t=\d+/);
  await expect(page.getByTestId('voice-live-panel')).toBeVisible();
  await expect(page.locator('.vc-seg.is-focus')).toBeVisible();

  // Sin IA: el error se ve y la pregunta vuelve al campo.
  await page.context().addCookies([{ name: 'voice_ai_fake', value: 'off', url: baseURL! }]);
  await page.goto('/en/app/voice', { waitUntil: 'networkidle' });
  await page.getByRole('combobox', { name: 'Ask your meetings' }).fill('Who wants annual billing?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'AI is not set up on this server' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('combobox', { name: 'Ask your meetings' })).toHaveValue('Who wants annual billing?');
  await page.context().clearCookies({ name: 'voice_ai_fake' });
});

test('chat y reunión: 1280 y 390, claro y oscuro, sin scroll horizontal', async ({ page, context, baseURL }) => {
  const title = `Layout ${uid()} with a fairly long meeting title that should wrap nicely`;
  const id = await recordMeeting(page, title);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByTestId('voice-enhanced')).toBeVisible({ timeout: 25_000 });
  await page.getByRole('combobox', { name: 'Ask about this meeting' }).fill('What did they say about billing?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.locator('.vc-msg.is-assistant .vc-cite').first()).toBeVisible({ timeout: 15_000 });
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/en/app/voice/meetings/${id}`, { waitUntil: 'networkidle' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.getByRole('combobox', { name: 'Ask about this meeting' }).click();
      await expect(page.locator('.vc-msg.is-assistant .vc-cite').first()).toBeVisible();
      await noHorizontalScroll(page, `meeting ${theme} ${width}`);
      await page.screenshot({ path: test.info().outputPath(`meeting-chat-${theme}-${width}.png`), fullPage: true });

      await page.goto('/en/app/voice', { waitUntil: 'networkidle' });
      await page.getByRole('combobox', { name: 'Ask your meetings' }).fill('Who wants annual billing?');
      await page.getByRole('button', { name: 'Ask', exact: true }).click();
      await expect(page.locator('.vc-turn .vc-cite').first()).toBeVisible({ timeout: 20_000 });
      await noHorizontalScroll(page, `home ${theme} ${width}`);
      await page.screenshot({ path: test.info().outputPath(`home-ask-${theme}-${width}.png`), fullPage: true });
    }
  }
  await context.addCookies([{ name: 'zs_theme', value: 'light', url: baseURL! }]);
});
