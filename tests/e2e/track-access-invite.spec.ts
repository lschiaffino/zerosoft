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
  await expect(page.getByTestId('track-access-invite-copy')).toBeVisible();
  await expect(page.getByTestId('track-access-invited')).toHaveCount(0);
  await expect(page.getByTestId('track-access-pending')).toContainText(email);
  const { rows } = (await (await request.get('/api/teams/invites')).json()) as { rows: Array<{ email: string; emailStatus: string; url: string }> };
  const row = rows.find((r) => r.email === email);
  expect(row?.emailStatus).toBe('skipped');
  expect(row?.url).toContain('/invite/');
  const scroll = await page.evaluate(() => document.scrollingElement!.scrollWidth);
  expect(scroll).toBeLessThanOrEqual(1281);
});

test('Acceso explica el team visible para todos y suma gente al privado', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const name = `Equipo ${Date.now()}`;
  const created = await request.post('/api/track/projects', { data: { name } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  const access = async () => (await (await request.get('/api/track/access')).json()) as { people: Array<{ id: string }>; me: string };
  await page.goto(`/en/app/track/settings?tab=access`, { waitUntil: 'load' });
  const row = page.getByTestId('track-access-project').filter({ hasText: name });
  // Visible para todo el workspace: no hay a quién sumar, y la pantalla lo dice.
  await expect(row).toContainText('Everyone in the workspace is already on this team');

  const vis = await request.post('/api/track/access', { data: { action: 'visibility', projectId: id, visibility: 'private' } });
  expect(vis.ok()).toBe(true);
  const { people, me } = await access();
  const other = people.find((p) => p.id !== me);
  await page.reload({ waitUntil: 'load' });
  if (other) {
    const form = page.getByTestId('track-access-project').filter({ hasText: name }).getByRole('button', { name: 'Add member' });
    await form.click();
    await expect(page.getByTestId('track-access-project').filter({ hasText: name })).toContainText('2 members');
  }
});

test('Members del team: invita desde el drawer y dice que un team abierto ya incluye a todos', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const created = await request.post('/api/track/projects', { data: { name: `Drawer ${Date.now()}` } });
  const project = (await created.json()) as { slug: string };
  await page.goto(`/en/app/track/team/${project.slug.toUpperCase()}`, { waitUntil: 'load' });
  await page.getByTestId('track-project-settings').click({ timeout: 60000 });
  const members = page.getByRole('tab', { name: 'Members' });
  await members.click();
  const box = await members.boundingBox();
  expect(box?.height).toBeLessThan(60);
  const panel = page.getByTestId('track-team-members');
  await expect(panel).toContainText('Everyone in the workspace');
  const email = `drawer-${Date.now()}@example.com`;
  await panel.getByRole('textbox').fill(email);
  await panel.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByTestId('track-access-invite-copy')).toBeVisible();
  await expect(page.getByTestId('track-access-pending')).toContainText(email);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(391);
});
