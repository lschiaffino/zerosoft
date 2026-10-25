import { expect, test, type Page } from '@playwright/test';

/**
 * Voice de punta a punta con micrófono simulado de Chromium (tono de prueba),
 * transcripción falsa (VOICE_TRANSCRIBE_PROVIDER=fake) e IA falsa
 * (VOICE_AI_FAKE=1). Los trozos de reunión se acortan a 1,5 s con
 * window.__zsVoiceChunkMs para no esperar 20 s.
 */
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
});

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.grantPermissions(['microphone', 'clipboard-read', 'clipboard-write'], { origin: baseURL! });
  await page.addInitScript(() => {
    (window as unknown as { __zsVoiceChunkMs: number }).__zsVoiceChunkMs = 1500;
  });
});

const uid = () => Math.random().toString(36).slice(2, 8);

function content(page: Page) {
  return page.locator('main.app-content');
}

test('dictado: grabar, limpiar, historial, editar y borrar', async ({ page }) => {
  await page.goto('/en/app/voice/dictation', { waitUntil: 'networkidle' });
  await expect(content(page).getByRole('heading', { name: 'Dictation', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Start dictating' }).click();
  await expect(page.getByRole('button', { name: 'Stop and clean up' })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop and clean up' }).click();
  const result = page.getByTestId('voice-dictation-result');
  await expect(result).toContainText('1. The landing');
  await expect(result).not.toContainText(/\bum\b/);
  const row = page.getByTestId('voice-dictation-row').first();
  await expect(row).toContainText(/launch is on tuesday/i);

  await row.getByRole('button', { name: 'Edit' }).click();
  const editor = row.getByRole('textbox');
  await editor.fill('Edited dictation text');
  await editor.press('Escape');
  await row.getByRole('button', { name: 'Edit' }).click();
  await row.getByRole('textbox').fill('Edited dictation text');
  await row.getByRole('textbox').blur();
  await expect(row).toContainText('Edited dictation text');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('voice-dictation-row').first()).toContainText('Edited dictation text');

  const count = await page.getByTestId('voice-dictation-row').count();
  await page.getByTestId('voice-dictation-row').first().getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('voice-dictation-row')).toHaveCount(count - 1);
});

test('dictado global: mantener Alt+Space escribe en el campo enfocado', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'voice_fake_text', value: encodeURIComponent('hello from the shortcut, no, I mean from Voice'), url: baseURL! }]);
  await page.goto('/en/app/notes', { waitUntil: 'networkidle' });
  // Un campo de texto cualquiera de otra app: la búsqueda de Notes.
  const field = page.getByRole('searchbox').first();
  await field.click();
  await expect(page.getByRole('button', { name: /Dictate into this field/ })).toBeVisible();
  await page.keyboard.down('Alt');
  await page.keyboard.down('Space');
  await expect(page.getByRole('status').filter({ hasText: /Listening|Opening/ })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.keyboard.up('Space');
  await page.keyboard.up('Alt');
  await expect(field).toHaveValue(/Hello from Voice/i, { timeout: 15_000 });

  // El botón del campo: manos libres, Insertar.
  await field.fill('');
  await page.getByRole('button', { name: /Dictate into this field/ }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Insert' }).click();
  await expect(field).toHaveValue(/Hello from Voice/i, { timeout: 15_000 });

  // Esc cancela sin escribir.
  await field.fill('');
  await page.keyboard.down('Alt');
  await page.keyboard.down('Space');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.keyboard.up('Space');
  await page.keyboard.up('Alt');
  await expect(page.getByRole('status').filter({ hasText: 'Dictation cancelled' })).toBeVisible();
  await expect(field).toHaveValue('');
});

test('reunión: grabar, transcripción en vivo, nota con IA, tareas, chat, buscar y borrar', async ({ page }) => {
  await page.goto('/en/app/voice', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New meeting' }).first().click();
  await expect(page).toHaveURL(/\/app\/voice\/meetings\//);
  const title = `Acme call ${uid()}`;
  const titleInput = page.getByRole('textbox', { name: 'Meeting title' });
  await titleInput.fill(title);
  await titleInput.press('Enter');

  await page.getByRole('textbox', { name: 'My notes' }).fill('Pricing per seat\nAnnual billing?');
  await expect(page.getByText('Saved')).toBeVisible();

  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  // Transcripción en vivo (trozos de 1,5 s).
  await expect(page.locator('.vc-seg').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Stop' }).click();
  // Al cortar, la IA arma la nota.
  const enhanced = page.getByTestId('voice-enhanced');
  await expect(enhanced).toBeVisible({ timeout: 20_000 });
  await expect(enhanced.getByText('Pricing per seat')).toBeVisible();
  await expect(enhanced).toContainText('Summary');

  // Renombrar a quien habla.
  await page.getByRole('tab', { name: /Transcript/ }).click();
  await page.locator('.vc-speaker').first().click();
  await page.getByRole('textbox', { name: 'Rename speaker' }).fill('Lauta');
  await page.getByRole('textbox', { name: 'Rename speaker' }).press('Enter');
  await expect(page.locator('.vc-speaker').first()).toHaveText('Lauta');

  // Chat sobre la reunión.
  await page.getByRole('tab', { name: 'Ask' }).click();
  await page.getByRole('textbox', { name: 'Ask about this meeting' }).fill('What did they say about billing?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.locator('.vc-msg.is-assistant').first()).toContainText(/annual billing/i);

  // Próximos pasos → tareas del CRM.
  await expect(enhanced).toContainText(/contract/i);
  await page.getByRole('button', { name: 'Create CRM tasks' }).click();
  await expect(page.getByText(/tasks? created/)).toBeVisible();

  // Mandar a Docs.
  await page.getByRole('button', { name: 'Send to Docs' }).click();
  await expect(page.getByText('Created a Docs page')).toBeVisible();

  // Lista y búsqueda en transcripciones.
  await page.goto('/en/app/voice', { waitUntil: 'networkidle' });
  await expect(content(page).getByText(title)).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search titles, notes and transcripts' }).fill('annual billing');
  await expect(page.getByTestId('voice-meeting-row').filter({ hasText: title })).toBeVisible();

  // Preguntas entre reuniones.
  await page.getByRole('textbox', { name: 'Ask your meetings' }).fill('Who wants annual billing?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.locator('.vc-answer')).toContainText(title);

  // Renombrar y borrar desde la lista, sin recargar.
  await page.getByRole('searchbox', { name: 'Search titles, notes and transcripts' }).fill('');
  const row = page.getByTestId('voice-meeting-row').filter({ hasText: title });
  await row.getByRole('button', { name: 'Rename' }).click();
  const renamed = `${title} renamed`;
  await page.getByRole('textbox', { name: 'Rename' }).fill(renamed);
  await page.getByRole('textbox', { name: 'Rename' }).press('Enter');
  await expect(page.getByTestId('voice-meeting-row').filter({ hasText: renamed })).toBeVisible();
  await page.getByTestId('voice-meeting-row').filter({ hasText: renamed }).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('voice-meeting-row').filter({ hasText: renamed })).toHaveCount(0);
});

test('sin IA: la nota muestra ai_disabled y la transcripción sigue', async ({ page, context, baseURL, request }) => {
  const { id } = (await (await request.post('/api/voice/sessions', { data: { title: `No AI ${uid()}` } })).json()) as { id: string };
  await context.addCookies([{ name: 'voice_ai_fake', value: 'off', url: baseURL! }]);
  await page.goto(`/en/app/voice/meetings/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('textbox', { name: 'My notes' }).fill('Some notes');
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Write notes with AI' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'AI is not set up on this server' })).toBeVisible();
});

test('ajustes: diccionario, plantillas y estilo; 390px y oscuro', async ({ page, context, baseURL }) => {
  await page.goto('/en/app/voice/settings?tab=dictionary', { waitUntil: 'networkidle' });
  const phrase = `zero soft ${uid()}`;
  await page.getByRole('combobox', { name: 'Type' }).selectOption('replace');
  await page.getByRole('textbox', { name: /What you say/ }).fill(phrase);
  await page.getByRole('textbox', { name: /What gets written/ }).fill('zerosoft');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('voice-dictionary-row').filter({ hasText: phrase })).toBeVisible();
  await page.getByTestId('voice-dictionary-row').filter({ hasText: phrase }).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('voice-dictionary-row').filter({ hasText: phrase })).toHaveCount(0);

  await page.goto('/en/app/voice/settings?tab=templates', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New template' }).click();
  const name = `Board ${uid()}`;
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Sections or instructions').fill('Metrics\nRisks');
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByTestId('voice-template-row').filter({ hasText: name })).toBeVisible();

  await page.goto('/en/app/voice/settings', { waitUntil: 'networkidle' });
  await page.getByLabel('Hold to dictate').selectOption('Alt+D');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByLabel('Hold to dictate')).toHaveValue('Alt+D');
  await page.getByLabel('Hold to dictate').selectOption('Alt+Space');
  await page.getByRole('button', { name: 'Save' }).first().click();

  await context.addCookies([{ name: 'zs_theme', value: 'dark', url: baseURL! }]);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/en/app/voice', '/en/app/voice/dictation', '/en/app/voice/settings?tab=desktop']) {
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
    expect(scroll, `${path}: scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
  }
});
