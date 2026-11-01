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
  await expect(page.getByTestId('track-access-invited').or(page.getByRole('alert'))).toBeVisible();
  await expect(page.getByTestId('track-access-pending')).toContainText(email);
  const scroll = await page.evaluate(() => document.scrollingElement!.scrollWidth);
  expect(scroll).toBeLessThanOrEqual(1281);
});
