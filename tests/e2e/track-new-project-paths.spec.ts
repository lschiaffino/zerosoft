import { expect, test } from '@playwright/test';

/** Nuevo project desde un team (sidebar "+ Nuevo" y ⌘K): el alta abre con ese team y el project queda en él. */
test('projects/new?team=<clave> abre el alta con ese team', async ({ page, request }) => {
  const name = `NP ${Math.random().toString(36).slice(2, 7)}`;
  const team = (await (await request.post('/api/track/projects', { data: { name } })).json()) as { id: string; slug: string };
  await page.goto(`/en/app/track/projects/new?team=${team.slug.toUpperCase()}`);
  await expect(page).toHaveURL(new RegExp(`/app/track/projects\\?new=1&team=${team.id}`), { timeout: 60_000 });
  // Sin team: el alta sin preselección (y no un team nuevo).
  await page.goto('/en/app/track/projects/new');
  await expect(page).toHaveURL(/\/app\/track\/projects\?new=1$/, { timeout: 60_000 });
});
