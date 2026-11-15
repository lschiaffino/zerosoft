import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Triage: una regla que mueve el issue a la cola de triage de otro team (como
 * "Move to team" de Linear). Se arma desde los ajustes del team; al elegir el
 * team, estado, cycle y asignado (que son del team de origen) se desactivan.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

test('regla de triage que mueve a otro team: se crea en los ajustes y mueve el issue a la cola del otro team', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const support = await ok<{ id: string; slug: string }>(request.post('/api/track/projects', { data: { name: `Support ${uid()}` } }));
  const billing = await ok<{ id: string; slug: string; name: string }>(request.post('/api/track/projects', { data: { name: `Billing ${uid()}` } }));
  await ok(request.patch(`/api/track/projects/${support.id}`, { data: { triageEnabled: true } }));
  await ok(request.patch(`/api/track/projects/${billing.id}`, { data: { triageEnabled: true } }));

  await page.goto(`/en/app/track/team/${support.id}`);
  await page.getByTestId('track-project-settings').click();
  await page.getByTestId('track-settings-tab-triage').click();
  await page.getByTestId('track-rule-new').click();
  await page.getByTestId('track-rule-name').fill('Billing questions');
  await page.getByTestId('track-rule-values').fill('invoice');
  await page.getByTestId('track-rule-move').selectOption(billing.id);
  // Lo que es del team de origen no se puede elegir al mover.
  await expect(page.getByTestId('track-rule-assignee')).toBeDisabled();
  await page.getByTestId('track-rule-save').click();
  const rule = page.getByTestId('track-rule').filter({ hasText: 'Billing questions' });
  await expect(rule).toContainText(`Move to team: ${billing.name}`);

  // Un issue que entra a triage de Support con "invoice" termina en la cola de Billing.
  const issue = await ok<{ id: string; identifier: string; project_id: string; triage: number }>(
    request.post(`/api/track/projects/${support.id}/issues`, { data: { title: 'Wrong invoice total', triage: true } }),
  );
  expect(issue.project_id).toBe(billing.id);
  expect(issue.identifier.startsWith(`${billing.slug.toUpperCase()}-`)).toBe(true);
  expect(issue.triage).toBe(1);
  await page.goto(`/en/app/track/team/${billing.id}?tab=triage`);
  await expect(page.getByTestId('track-triage').getByText('Wrong invoice total').first()).toBeVisible();
});
