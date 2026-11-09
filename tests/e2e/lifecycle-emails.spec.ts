import fs from 'fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Emails de ciclo de vida: preferencias en Ajustes › Avisos (guardar,
 * recargar, baja total, 390 px, oscuro, teclado), la vista previa del admin
 * con "mandármelo" y la baja desde el link del email (abrir no cambia nada,
 * confirmar sí, y se ve en Ajustes).
 */

function mailsTo(subjectPart: string): Array<{ to: string; subject: string; text: string }> {
  const file = process.env.E2E_MAIL_FILE!;
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { to: string; subject: string; text: string })
    .filter((m) => m.subject.includes(subjectPart));
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function resetPrefs(page: Page) {
  const res = await page.request.put('/api/profile/email-preferences', { data: { unsubscribedAll: false, optedOut: [], digest: false } });
  expect(res.ok()).toBe(true);
}

test.describe('preferencias de email', () => {
  test.beforeEach(async ({ page }) => {
    await resetPrefs(page);
  });

  test('apagar una categoría y prender el resumen semanal queda guardado', async ({ page }) => {
    await page.goto('/en/app/settings/notifications');
    const section = page.locator('form', { has: page.getByRole('heading', { name: 'Emails from zerosoft' }) });
    await expect(section).toBeVisible();
    const tips = section.getByRole('checkbox', { name: /Features and tips/ });
    const digest = section.getByRole('checkbox', { name: /Weekly summary/ });
    await expect(tips).toBeChecked();
    await expect(digest).not.toBeChecked();
    await tips.uncheck();
    await digest.check();
    await section.getByRole('button', { name: 'Save' }).click();
    await expect(section.getByText('Changes saved')).toBeVisible();
    await page.reload();
    await expect(tips).not.toBeChecked();
    await expect(digest).toBeChecked();
    // Los avisos de Track siguen a un clic.
    await expect(page.getByRole('link', { name: 'Track notifications' })).toHaveAttribute('href', /\/app\/track\/settings\?tab=notifications/);
  });

  test('la baja total apaga todo y se puede deshacer', async ({ page }) => {
    await page.goto('/en/app/settings/notifications');
    const section = page.locator('form', { has: page.getByRole('heading', { name: 'Emails from zerosoft' }) });
    const all = section.getByRole('checkbox', { name: /Stop all of these emails/ });
    // Con teclado: foco visible en la casilla, Espacio la marca.
    await all.focus();
    await page.keyboard.press('Space');
    await expect(all).toBeChecked();
    const onboarding = section.getByRole('checkbox', { name: /Getting started/ });
    await expect(onboarding).toBeDisabled();
    await expect(onboarding).not.toBeChecked();
    await section.getByRole('button', { name: 'Save' }).click();
    await expect(section.getByText('Changes saved')).toBeVisible();
    await page.reload();
    await expect(all).toBeChecked();
    await all.uncheck();
    await section.getByRole('button', { name: 'Save' }).click();
    await expect(section.getByText('Changes saved')).toBeVisible();
    await page.reload();
    await expect(onboarding).toBeChecked();
  });

  test('se ve bien a 390 px y en oscuro, en los tres idiomas', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'zs_theme', value: 'dark', url: baseURL! }]);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [locale, title] of [['en', 'Emails from zerosoft'], ['es', 'Emails de zerosoft'], ['pt', 'Emails do zerosoft']] as const) {
      await page.goto(`/${locale}/app/settings/notifications`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
      await expect(page.getByTestId('email-prefs').getByRole('checkbox')).toHaveCount(5);
      await noHorizontalScroll(page);
    }
  });
});

test('admin: vista previa de cada plantilla, mandármelo y la baja desde el link', async ({ page }) => {
  test.setTimeout(120_000);
  await resetPrefs(page);
  await page.goto('/en/app/settings/lifecycle?template=feature_voice&lang=es');
  await expect(page.getByTestId('lifecycle-mode')).toBeVisible();
  const frame = page.frameLocator('[data-testid="lifecycle-preview"]');
  await expect(frame.getByRole('heading', { name: 'Voice: dictado y notas de reuniones' })).toBeVisible();
  await expect(frame.getByRole('link', { name: 'Abrir Voice' })).toHaveAttribute('href', /\/es\/app\/voice$/);
  // Otra plantilla, oscuro, 390 px.
  // Cada link arma su URL con la actual: esperar cada navegación antes del siguiente clic.
  await page.getByRole('link', { name: 'team_invite', exact: true }).click();
  await expect(page).toHaveURL(/template=team_invite/);
  await page.getByRole('link', { name: 'Dark', exact: true }).click();
  await expect(page).toHaveURL(/template=team_invite.*theme=dark/);
  await page.getByRole('link', { name: '390px', exact: true }).click();
  await expect(page).toHaveURL(/template=team_invite.*theme=dark.*width=390/);
  await expect(frame.getByRole('heading', { name: 'Invitá a tu equipo' })).toBeVisible();

  // Mandármelo: en e2e los emails van al archivo de captura.
  const before = mailsTo('[test] Sumá a tu equipo').length;
  await page.getByRole('button', { name: 'Send it to me' }).click();
  await expect(page.getByText(/^Sent to /)).toBeVisible();
  await expect.poll(() => mailsTo('[test] Sumá a tu equipo').length).toBe(before + 1);
  const mail = mailsTo('[test] Sumá a tu equipo').at(-1)!;
  const link = mail.text.match(/https?:\/\/\S+\/es\/email\/unsubscribe\?t=\S+/)?.[0];
  expect(link).toBeTruthy();

  // Abrir el link no da de baja: hay que confirmar.
  await page.goto(new URL(link!).pathname + new URL(link!).search);
  await expect(page.getByRole('heading', { name: 'Darte de baja' })).toBeVisible();
  await expect(page.getByText('Vas a dejar de recibir los avisos sobre tu equipo.', { exact: false })).toBeVisible();
  let prefs = await (await page.request.get('/api/profile/email-preferences')).json();
  expect(prefs.optedOut).toEqual([]);
  await page.getByRole('button', { name: 'Darme de baja' }).click();
  await expect(page.getByRole('status')).toHaveText('Listo. Ya no vas a recibir los avisos sobre tu equipo.');
  prefs = await (await page.request.get('/api/profile/email-preferences')).json();
  expect(prefs.optedOut).toEqual(['team']);
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalScroll(page);

  // Se ve en Ajustes.
  await page.getByRole('link', { name: 'Elegir qué emails recibir' }).click();
  await expect(page.getByRole('checkbox', { name: /Tu equipo/ })).not.toBeChecked();

  // One-click (List-Unsubscribe-Post) con el token en la URL; un token roto no hace nada.
  const token = new URL(link!).searchParams.get('t')!;
  const bad = await page.request.post(`/api/email/unsubscribe?t=${encodeURIComponent(token.slice(0, -2))}xx`);
  expect(bad.status()).toBe(400);
  const ok = await page.request.post(`/api/email/unsubscribe?t=${encodeURIComponent(token)}`, { form: { 'List-Unsubscribe': 'One-Click' } });
  expect(ok.ok()).toBe(true);
  await page.goto('/en/email/unsubscribe?t=nope');
  await expect(page.getByTestId('email-unsubscribe-invalid')).toBeVisible();
  await resetPrefs(page);
});
