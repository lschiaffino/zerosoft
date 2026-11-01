import { expect, test } from '@playwright/test';

/**
 * Ajustes de Track › Acceso: sumar gente a un team privado cuando el workspace
 * todavía no tiene a nadie más. Antes no aparecía ningún control ni explicación.
 */
test('sin nadie más en el workspace, se puede invitar desde Acceso', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const name = `Priv ${Date.now()}`;
  const created = await request.post('/api/track/projects', { data: { name } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  const vis = await request.post('/api/track/access', { data: { action: 'visibility', projectId: id, visibility: 'private' } });
  expect(vis.ok()).toBe(true);

  await page.goto('/en/app/track/settings?tab=access', { waitUntil: 'load' });
  const tab = page.getByRole('tab', { name: 'Access' }).or(page.getByRole('link', { name: 'Access', exact: true }));
  if (await tab.first().isVisible()) await tab.first().click();
  await expect(page.getByTestId('track-access-settings')).toBeVisible();

  const email = `invitee-${Date.now()}@example.com`;
  await page.getByRole('textbox', { name: 'Invite someone to the workspace' }).fill(email);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  // Los e2e corren sin proveedor de email (RESEND_API_KEY vacío en playwright.config.ts): la invitación
  // queda creada sin mandar el mail (`skipped`). La pantalla lo tiene que decir y dar el camino al link.
  await expect(page.getByRole('alert').filter({ hasText: 'The invitation could not be sent' })).toContainText('copy its link in Platform settings');
  await expect(page.getByTestId('track-access-invited')).toHaveCount(0);
  await expect(page.getByTestId('track-access-pending')).toContainText(email);
  const { rows } = (await (await request.get('/api/teams/invites')).json()) as { rows: Array<{ email: string; emailStatus: string; url: string }> };
  const row = rows.find((r) => r.email === email);
  expect(row?.emailStatus).toBe('skipped');
  expect(row?.url).toContain('/invite/');
  const scroll = await page.evaluate(() => document.scrollingElement!.scrollWidth);
  expect(scroll).toBeLessThanOrEqual(1281);
});
