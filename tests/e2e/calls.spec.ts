import { expect, test, type Page } from '@playwright/test';

/**
 * Calls de punta a punta con el bot simulado (CALLS_BOT_FAKE) y el análisis
 * sin modelo (CALLS_AI_FAKE): mandar el bot a un Meet desde la biblioteca, ver
 * la llamada con transcripción y hablantes, saltar con un clic, comentar en un
 * momento, armar un clip, preguntar, compartir por link (y cortarlo), buscar
 * en la biblioteca, borrar; más la agenda, ajustes, oscuro y 390 px.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function noHorizontalScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
}

test('send the bot, read the call, comment, clip, ask, share and delete', async ({ page, browser, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const title = `Discovery ${uid()}`;
  await page.goto('/en/app/calls', { waitUntil: 'networkidle' });
  await page.getByTestId('calls-new').click();
  const dialog = page.getByRole('dialog', { name: 'New call' });
  await expect(dialog).toBeVisible();
  // Un link que no es de Meet se rechaza con un mensaje claro.
  await page.getByTestId('calls-meet-url').fill('https://zoom.us/j/123');
  await page.getByTestId('calls-send-bot').click();
  await expect(dialog.getByRole('alert')).toContainText('Google Meet');
  await page.getByTestId('calls-meet-url').fill('https://meet.google.com/abc-defg-hij');
  await dialog.getByLabel('Name').fill(title);
  await page.getByTestId('calls-send-bot').click();
  await expect(page).toHaveURL(/\/app\/calls\/call\/call_/);
  await expect(page.getByTestId('calls-title')).toHaveValue(title);

  // Transcripción con nombres y análisis.
  const transcript = page.getByTestId('calls-transcript');
  await expect(transcript).toContainText('Ana Prospect');
  await expect(transcript).toContainText('Our CFO signs anything above five thousand.');
  await expect(page.getByTestId('calls-summary')).toContainText('Next steps');
  await page.getByTestId('calls-tab-insights').click();
  await expect(page.getByTestId('calls-insights')).toContainText('Talk ratio');
  await expect(page.getByTestId('calls-insights')).toContainText('Gong');
  await expect(page.getByTestId('calls-insights')).toContainText('SPICED');

  // Clic en un momento: el reproductor salta ahí.
  await page.getByTestId('calls-utt-seek').nth(2).click();
  await expect.poll(() => page.getByTestId('calls-player').evaluate((el: HTMLMediaElement) => el.currentTime)).toBeGreaterThan(1);

  // Comentario en un momento.
  await page.getByTestId('calls-tab-comments').click();
  await page.getByTestId('calls-comment-body').fill('Good discovery question');
  await page.getByTestId('calls-comment-post').click();
  await expect(page.getByTestId('calls-comment')).toContainText('Good discovery question');

  // Clip.
  await page.getByTestId('calls-tab-clips').click();
  await page.getByTestId('calls-clip-title').fill('Pricing objection');
  await page.getByTestId('calls-clip-save').click();
  await expect(page.getByTestId('calls-clip')).toContainText('Pricing objection');

  // Preguntar a la llamada.
  await page.getByTestId('calls-tab-ask').click();
  await page.getByTestId('calls-ask-input').fill('Who signs the contract?');
  await page.getByTestId('calls-ask-submit').click();
  await expect(page.getByTestId('calls-answer')).toContainText('CFO');

  // Compartir: el link abre sin cuenta y deja de abrir al apagarlo.
  await page.getByTestId('calls-share').click();
  await page.getByTestId('calls-share-toggle').click();
  await expect(page.getByTestId('calls-share-toggle')).toBeChecked();
  const url = await page.getByTestId('calls-share-url').inputValue();
  const anon = await browser.newContext({ baseURL });
  const pub = await anon.newPage();
  await pub.goto(url);
  await expect(pub.getByTestId('calls-shared')).toContainText('Our CFO signs anything above five thousand.');
  await expect(pub.getByTestId('calls-shared')).not.toContainText('Good discovery question');
  await page.getByTestId('calls-share-toggle').click();
  await expect(page.getByTestId('calls-share-toggle')).not.toBeChecked();
  const gone = await pub.goto(url);
  expect(gone?.status()).toBe(404);
  await anon.close();
  await page.keyboard.press('Escape');

  // La biblioteca busca en lo que se dijo.
  await page.goto('/en/app/calls?q=CFO', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('calls-row').filter({ hasText: title })).toBeVisible();

  // Borrar desde la llamada.
  await page.getByTestId('calls-row').filter({ hasText: title }).getByRole('link').click();
  await page.getByTestId('calls-delete').click();
  await page.getByRole('alertdialog', { name: 'Delete this call?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/app\/calls$/);
  await expect(page.getByText(title)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('upcoming, deals, ask and settings render; dark mode and 390 px have no horizontal scroll', async ({ page, request }) => {
  const title = `Narrow ${uid()} with a fairly long name to check wrapping on small phones`;
  const res = await request.post('/api/calls/calls', { data: { meetingUrl: 'https://meet.google.com/abc-defg-hij', title } });
  const { call } = (await res.json()) as { call: { id: string } };

  await page.goto('/en/app/calls/upcoming', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('calls-rule')).toBeVisible();
  await page.getByLabel('Every meeting with a Meet link').check();
  await expect(page.getByText('Recording rule saved')).toBeVisible();

  await page.goto('/en/app/calls/ask', { waitUntil: 'networkidle' });
  await page.getByTestId('calls-ask-all-input').fill('What about the CFO?');
  await page.getByTestId('calls-ask-all-submit').click();
  await expect(page.getByTestId('calls-ask-all-answer').first()).toContainText('From these calls');

  await page.goto('/en/app/calls/deals', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Deals', level: 1 })).toBeVisible();

  await page.goto('/en/app/calls/settings', { waitUntil: 'networkidle' });
  await page.getByTestId('calls-methodology').selectOption('meddic');
  await page.getByTestId('calls-settings-save').click();
  await expect(page.getByText('Saved').first()).toBeVisible();
  await page.getByTestId('calls-methodology').selectOption('spiced');
  await page.getByTestId('calls-settings-save').click();

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/en/app/calls', `/en/app/calls/call/${call.id}`, '/en/app/calls/upcoming', '/en/app/calls/settings']) {
    await page.goto(path, { waitUntil: 'networkidle' });
    await noHorizontalScroll(page);
  }
  // Sección o llamada desconocida: 404 de verdad.
  expect((await page.goto('/en/app/calls/nope'))?.status()).toBe(404);
  expect((await page.goto('/en/app/calls/call/call_doesnotexist'))?.status()).toBe(404);
});
