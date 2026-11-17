import { expect, test } from '@playwright/test';

/**
 * Inbox (correo): renombrar el hilo con las notas abiertas no cierra las notas ni borra lo escrito sin
 * guardar. El título nuevo vuelve del servidor como una prop nueva; antes eso reiniciaba todo el encabezado.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

for (const width of [1280, 390]) {
  test(`renombrar con las notas abiertas deja las notas como estaban (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/en/app/inbox/settings', { waitUntil: 'networkidle' });
    const card = page.getByTestId('inbox-gmail-card');
    await card.getByRole('link', { name: /Connect (another )?Gmail/ }).click();
    await page.getByTestId('inbox-gmail-card').getByRole('button', { name: 'Sync now' }).first().click();
    await expect(page.getByTestId('inbox-gmail-card').getByText(/Synced/).first()).toBeVisible();

    await page.goto('/en/app/inbox/v/email', { waitUntil: 'networkidle' });
    const row = page.locator('.ib-item', { hasText: 'Martín' }).first();
    await row.locator('.ib-row-btn').click();
    const head = page.locator('.ib-convo-head');
    await expect(head).toBeVisible();

    // En el teléfono el botón de notas va en "Más acciones"; con / se abre igual en los dos anchos.
    const notesBtn = head.getByRole('button', { name: 'Notes', exact: true });
    if (await notesBtn.isVisible()) await notesBtn.click();
    else {
      const reply = page.getByRole('textbox', { name: 'Reply' });
      await reply.pressSequentially('/notes');
      await reply.press('Enter');
    }
    const notes = page.getByRole('textbox', { name: 'Notes about this chat' });
    await expect(notes).toBeVisible();
    await notes.fill('Nota sin guardar');

    const title = `Martín ${uid()}`;
    // El título es el botón de renombrar (su nombre accesible es el del hilo).
    await head.locator('.ib-title-btn').click();
    const rename = head.getByRole('textbox', { name: 'Rename chat' });
    await rename.fill(title);
    const saved = page.waitForResponse((r) => /\/api\/inbox\/threads\/[^/?]+$/.test(new URL(r.url()).pathname) && r.request().method() === 'PATCH');
    await rename.press('Enter');
    expect((await saved).ok()).toBe(true);
    await expect(head.getByRole('heading', { level: 2 })).toHaveText(title);

    await expect(notes).toBeVisible();
    await expect(notes).toHaveValue('Nota sin guardar');
  });
}
