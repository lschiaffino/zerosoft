import { expect, test, type Page } from '@playwright/test';

/**
 * Voice como la pantalla de reunión de Granola: página de documento con chips
 * (notas, "Hoy · Yo" con el evento del calendario y los asistentes por
 * empresa, carpeta), la barra de abajo con el audio en vivo y "Preguntá lo que
 * quieras", el panel del chat (recipes, historial, chat nuevo, "Decime más",
 * archivo adjunto, dictado, ⌘J y Esc), la biblioteca de recipes y el email de
 * seguimiento desde el Outlook conectado. Micrófono, transcripción, IA,
 * Google Calendar y Outlook falsos.
 */
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
});

test.beforeEach(async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  await context.grantPermissions(['microphone', 'clipboard-read', 'clipboard-write'], { origin: baseURL! });
  await page.addInitScript(() => {
    (window as unknown as { __zsVoiceChunkMs: number }).__zsVoiceChunkMs = 1500;
  });
});

const uid = () => Math.random().toString(36).slice(2, 8);

async function noHorizontalScroll(page: Page, what: string) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `${what}: scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
}

async function connectGoogle(page: Page) {
  await page.goto('/en/app/calendar/settings?tab=connections', { waitUntil: 'networkidle' });
  const google = page.locator('.cal-conn').filter({ hasText: 'Google Calendar' });
  const connect = google.getByRole('button', { name: 'Connect', exact: true });
  if (await connect.isVisible()) {
    await connect.click();
    await expect(page.getByText('Google Calendar connected.')).toBeVisible();
  }
}

/** Suelta "Pricing review" (el evento de Google falso) de la reunión que lo haya tomado antes en la corrida. */
async function freeFakeEvent(page: Page) {
  const { events } = (await (await page.request.get('/api/voice/events')).json()) as { events: Array<{ title: string; sessionId: string | null }> };
  for (const e of events.filter((x) => x.title === 'Pricing review' && x.sessionId)) {
    await page.request.post(`/api/voice/sessions/${e.sessionId}/link`, { data: { eventKey: null } });
  }
}

async function newMeeting(page: Page) {
  await page.goto('/en/app/voice', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New meeting' }).first().click();
  await expect(page).toHaveURL(/\/app\/voice\/meetings\/[^?]+$/, { timeout: 30_000 });
  await expect(page.getByRole('timer')).toBeVisible({ timeout: 15_000 });
  return page.url().split('/').pop()!;
}

test('documento: el evento de ahora se elige solo, asistentes por empresa, chat durante la reunión y notas al cortar', async ({ page }) => {
  await connectGoogle(page);
  await freeFakeEvent(page);
  const id = await newMeeting(page);

  // El evento que está por empezar ("Pricing review" con Ana) se elige solo: título y asistentes.
  const people = page.getByTestId('voice-people-chip');
  await expect(people).toContainText('Today', { timeout: 15_000 });
  await expect(people).toContainText('Me + 1 person', { timeout: 15_000 });
  await expect(page.getByRole('textbox', { name: 'Meeting title' })).toHaveValue('Pricing review');
  await people.click();
  const panel = page.getByRole('dialog', { name: 'Event and attendees' });
  await expect(panel.getByRole('button', { name: /Pricing review/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.vc-people-company')).toContainText(['Fake-guest']);
  await expect(panel).toContainText('Ana Guest');
  // Agregar asistentes: un email nuevo entra con su empresa; se quita con su botón.
  const add = panel.getByRole('combobox', { name: 'Add attendees…' });
  await add.fill('bob@globex.test');
  await add.press('Enter');
  await expect(panel.locator('.vc-people-company')).toContainText(['Fake-guest', 'Globex']);
  await expect(people).toContainText('Me + 2 people');
  await panel.getByRole('button', { name: 'Remove bob@globex.test' }).click();
  await expect(people).toContainText('Me + 1 person');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(people).toBeFocused();

  // ⌘J abre "Preguntá lo que quieras" (y no el asistente global); recipes y sugerencias del durante.
  await page.keyboard.press('ControlOrMeta+j');
  const ask = page.getByTestId('voice-ask-panel');
  await expect(ask).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Ask about this meeting' })).toBeFocused();
  await expect(ask.getByRole('button', { name: 'Write follow up email' })).toBeVisible();
  await expect(ask.getByRole('button', { name: 'What has been decided so far?' })).toBeVisible();
  await expect(page.getByText('AI can make mistakes. Check important details.')).toBeVisible();
  await ask.getByRole('button', { name: 'List my todos' }).click();
  await expect(ask.locator('.vc-msg.is-user').last()).toContainText('/List my todos');
  await expect(ask.locator('.vc-msg.is-assistant').last()).not.toBeEmpty({ timeout: 20_000 });
  await ask.getByRole('button', { name: 'Say more' }).click();
  await expect(ask.locator('.vc-msg.is-user')).toHaveCount(2, { timeout: 20_000 });
  await expect(ask.locator('.vc-msg.is-assistant')).toHaveCount(2, { timeout: 20_000 });

  // Chat nuevo y el historial con los dos.
  await ask.getByRole('button', { name: 'New chat' }).click();
  await expect(ask.locator('.vc-msg')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Ask about this meeting' }).fill('What did they say about billing?');
  await page.getByRole('combobox', { name: 'Ask about this meeting' }).press('Enter');
  await expect(ask.locator('.vc-msg.is-assistant')).toHaveCount(1, { timeout: 20_000 });
  await ask.getByRole('button', { name: 'Chat history' }).click();
  const history = page.getByRole('menu', { name: 'Chat history' });
  await expect(history.getByRole('menuitemradio')).toHaveCount(2);
  await history.getByRole('menuitemradio', { name: /List my todos/ }).click();
  await expect(ask.locator('.vc-msg.is-assistant')).toHaveCount(2);

  // Esc cierra el panel; "/" fuera de un campo lo vuelve a abrir.
  await page.keyboard.press('Escape');
  await expect(ask).toBeHidden();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('/');
  await expect(ask).toBeVisible();
  await page.keyboard.press('Escape');

  // La transcripción en vivo se abre desde la barra.
  await page.getByRole('button', { name: 'Live transcript' }).click();
  const live = page.getByTestId('voice-live-panel');
  await expect(live.locator('.vc-seg').first()).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');
  await expect(live).toBeHidden();

  // Al cortar, las notas mejoradas se escriben solas y el chip cambia a "Enhanced notes".
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByTestId('voice-enhanced')).toBeVisible({ timeout: 30_000 });
  const view = page.getByTestId('voice-view-chip');
  await expect(view).toContainText('Enhanced notes');
  await view.click();
  await page.getByRole('menuitemradio', { name: 'My notes' }).click();
  await expect(page.getByRole('textbox', { name: 'My notes' })).toBeVisible();

  // Las conversaciones quedan guardadas.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('combobox', { name: 'Ask about this meeting' }).click();
  await expect(page.getByTestId('voice-ask-panel').locator('.vc-msg.is-assistant')).toHaveCount(2);
  const saved = (await (await page.request.get(`/api/voice/sessions/${id}`)).json()) as { chat: Array<{ thread?: string }> };
  expect(new Set(saved.chat.map((m) => m.thread ?? '')).size).toBe(2);
});

test('recipes: biblioteca con los tuyos compartidos, correrlos, editarlos y borrarlos; archivo adjunto y dictado', async ({ page, context, baseURL }) => {
  const res = await page.request.post('/api/voice/sessions', { data: { title: `Recipes ${uid()}` } });
  const { id } = (await res.json()) as { id: string };
  await page.request.patch(`/api/voice/sessions/${id}`, { data: { myNotes: 'Budget is tight\nLaunch in March' } });
  await page.goto(`/en/app/voice/meetings/${id}`, { waitUntil: 'networkidle' });

  await page.getByRole('combobox', { name: 'Ask about this meeting' }).click();
  const ask = page.getByTestId('voice-ask-panel');
  await ask.getByRole('button', { name: 'All recipes' }).click();
  const lib = page.getByTestId('voice-recipe-library');
  await expect(lib.getByRole('heading', { name: 'Built in' })).toBeVisible();
  await expect(lib.getByText('/Write TL;DR')).toBeVisible();
  const name = `Risks ${uid()}`;
  await lib.getByRole('button', { name: 'New recipe' }).click();
  await lib.getByRole('textbox', { name: 'Name' }).fill(name);
  await lib.getByRole('textbox', { name: 'What it asks' }).fill('List the risks mentioned.');
  await lib.getByRole('checkbox', { name: 'Share with the workspace' }).check();
  await lib.getByRole('button', { name: 'Save recipe' }).click();
  const row = lib.getByTestId('voice-library-row').filter({ hasText: name });
  await expect(row).toContainText('shared');
  await row.getByRole('button', { name: `Edit ${name}` }).click();
  await lib.getByRole('textbox', { name: 'What it asks' }).fill('List the risks mentioned, with owners.');
  await lib.getByRole('button', { name: 'Save recipe' }).click();
  await expect(row).toContainText('with owners');
  await row.getByRole('button', { name: `Run ${name}` }).click();
  await expect(lib).toBeHidden();
  await expect(ask.locator('.vc-msg.is-user').last()).toContainText(`/${name}`);
  await expect(ask.locator('.vc-msg.is-assistant').last()).not.toBeEmpty({ timeout: 20_000 });
  // El recipe nuevo aparece con "/" sin recargar.
  const input = page.getByRole('combobox', { name: 'Ask about this meeting' });
  await input.fill(`/${name.slice(0, 6)}`);
  await expect(page.getByRole('option', { name: new RegExp(name) })).toBeVisible();
  await input.fill('');

  // Archivo adjunto: la respuesta lee lo que dice el archivo.
  await page.locator('input[type=file][accept*=".md"]').setInputFiles({ name: 'rfp.txt', mimeType: 'text/plain', buffer: Buffer.from('The procurement deadline is December 4.') });
  await expect(ask.locator('.vc-attach-chip')).toContainText('rfp.txt');
  await input.fill('When is the procurement deadline?');
  await input.press('Enter');
  await expect(ask.locator('.vc-msg.is-assistant').last()).toContainText('December 4', { timeout: 20_000 });
  await expect(ask.locator('.vc-attach-chip')).toHaveCount(0);
  // Un archivo que no es texto se rechaza con un mensaje claro.
  await page.locator('input[type=file][accept*=".md"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]) });
  await expect(page.getByRole('alert').filter({ hasText: 'Attach a text file' })).toBeVisible();

  // Dictar la pregunta: el texto dictado queda en el campo.
  await context.addCookies([{ name: 'voice_fake_text', value: encodeURIComponent('What is the budget'), url: baseURL! }]);
  await ask.getByRole('button', { name: 'Dictate the question' }).click();
  await expect(page.getByRole('button', { name: 'Stop dictating' })).toBeVisible();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Stop dictating' }).click();
  await expect(input).toHaveValue(/What is the budget/i, { timeout: 15_000 });

  // Borrar el recipe desde la biblioteca.
  await input.fill('');
  await ask.getByRole('button', { name: 'New chat' }).click();
  await ask.getByRole('button', { name: 'All recipes' }).click();
  await lib.getByTestId('voice-library-row').filter({ hasText: name }).getByRole('button', { name: `Delete ${name}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(lib.getByTestId('voice-library-row').filter({ hasText: name })).toHaveCount(0);
});

test('email de seguimiento: se escribe solo, se copia o abre Gmail, y sale desde el Outlook conectado', async ({ page }) => {
  const res = await page.request.post('/api/voice/sessions', { data: { title: `Follow ${uid()}` } });
  const { id } = (await res.json()) as { id: string };
  await page.request.patch(`/api/voice/sessions/${id}`, { data: { myNotes: 'Pricing per seat\nAnnual billing agreed', attendees: [{ name: 'Ana', email: 'ana@acme.test' }] } });
  await page.request.post(`/api/voice/sessions/${id}/enhance`, { data: { locale: 'en' } });
  await page.goto(`/en/app/voice/meetings/${id}`, { waitUntil: 'networkidle' });

  // Sin correo conectado: el borrador sale solo, con Gmail y la ayuda para conectar.
  await page.getByRole('button', { name: 'Write follow up email' }).click();
  const fu = page.getByTestId('voice-followup');
  await expect(fu.getByRole('textbox', { name: 'Subject' })).toHaveValue(/Follow-up/, { timeout: 20_000 });
  await expect(fu.getByRole('textbox', { name: 'To' })).toHaveValue('ana@acme.test');
  await expect(fu.getByRole('link', { name: 'Open in Gmail' })).toHaveAttribute('href', /mail\.google\.com.*to=ana%40acme\.test/);
  await expect(fu.getByRole('link', { name: 'Connect your email' })).toBeVisible();
  await fu.getByRole('button', { name: 'Copy' }).click();
  await expect(fu.getByText('Copied.')).toBeVisible();

  // Con Outlook conectado (Graph falso): "Enviar" sale desde ese buzón.
  await page.goto('/en/app/crm/settings?tab=integrations', { waitUntil: 'networkidle' });
  const panel = page.locator('.outlook-panel');
  const connect = panel.getByRole('link', { name: 'Connect Outlook' });
  if (await connect.isVisible()) {
    await connect.click();
    await expect(page).toHaveURL(/outlook=connected/);
  }
  await page.goto(`/en/app/voice/meetings/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Write follow up email' }).click();
  await expect(fu.getByText('Sends from demo.outlook@fake-outlook.test.')).toBeVisible();
  await fu.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(fu.getByRole('status').filter({ hasText: 'Sent from demo.outlook@fake-outlook.test.' })).toBeVisible({ timeout: 15_000 });
  await expect(fu.getByRole('button', { name: 'Send again' })).toBeVisible();

  // Se desconecta para no cambiar otros tests.
  await page.goto('/en/app/crm/settings?tab=integrations', { waitUntil: 'networkidle' });
  await panel.getByRole('button', { name: 'Disconnect' }).click();
  await expect(panel.getByRole('link', { name: 'Connect Outlook' })).toBeVisible();
});

test('carpeta desde el chip, menú de más acciones con teclado y la página en 390 y 1280, claro y oscuro', async ({ page }) => {
  const title = `Doc ${uid()}`;
  const res = await page.request.post('/api/voice/sessions', { data: { title } });
  const { id } = (await res.json()) as { id: string };
  await page.request.patch(`/api/voice/sessions/${id}`, { data: { myNotes: 'Short line\nAnother line' } });
  await page.goto(`/en/app/voice/meetings/${id}`, { waitUntil: 'networkidle' });

  // Carpeta nueva desde el chip: la reunión queda adentro y el chip la nombra.
  const folderName = `Clients ${uid()}`;
  await page.getByTestId('voice-folder-chip').click();
  await page.getByRole('textbox', { name: 'New folder…' }).fill(folderName);
  await page.getByRole('textbox', { name: 'New folder…' }).press('Enter');
  await expect(page.getByTestId('voice-folder-chip')).toContainText(folderName);
  await expect.poll(async () => ((await (await page.request.get(`/api/voice/sessions/${id}`)).json()) as { folderId: string | null }).folderId).not.toBeNull();

  // Menú de más acciones: flechas, Enter y Esc.
  await page.getByTestId('voice-more').click();
  const menu = page.getByRole('menu', { name: 'More actions' });
  await expect(menu.getByRole('menuitem', { name: 'Copy Markdown' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Send to Docs' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.getByTestId('voice-more')).toBeFocused();
  await page.getByTestId('voice-more').click();
  await menu.getByRole('menuitem', { name: 'CRM and links' }).click();
  await expect(page.getByTestId('voice-details')).toContainText('CRM contact');
  await page.keyboard.press('Escape');

  // Copiar link sin compartir abre "Compartir".
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByTestId('voice-share')).toBeVisible();
  await page.keyboard.press('Escape');

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/en/app/voice/meetings/${id}`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('textbox', { name: 'Meeting title' })).toHaveValue(title);
      await noHorizontalScroll(page, `${scheme} ${width}`);
      await page.getByRole('combobox', { name: 'Ask about this meeting' }).click();
      await expect(page.getByTestId('voice-ask-panel')).toBeVisible();
      await noHorizontalScroll(page, `${scheme} ${width} ask`);
      // El panel entra en la pantalla.
      const box = await page.getByTestId('voice-ask-panel').boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape');
      await page.getByTestId('voice-people-chip').click();
      await noHorizontalScroll(page, `${scheme} ${width} people`);
      await page.keyboard.press('Escape');
    }
  }
});
