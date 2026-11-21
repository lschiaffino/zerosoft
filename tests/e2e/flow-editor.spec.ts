import { expect, test, type Page } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);

// Lo que crean los tests se borra al final de cada uno: la base demo queda limpia.
const createdFlows: string[] = [];
const createdCredentials: string[] = [];

test.afterEach(async ({ page }) => {
  for (const id of createdFlows.splice(0)) await page.request.delete(`/api/flow/flows/${id}`).catch(() => null);
  for (const id of createdCredentials.splice(0)) await page.request.delete(`/api/flow/credentials/${id}`).catch(() => null);
});

/** Crea un flow desde la plantilla Lead → CRM + Slack y abre el editor. */
async function openTemplateFlow(page: Page) {
  const res = await page.request.post('/api/flow/flows', { data: { name: `E2E ${uid()}`, template: 'leadToCrmSlack' } });
  expect(res.ok()).toBeTruthy();
  const { id } = (await res.json()) as { id: string };
  createdFlows.push(id);
  await page.goto(`/es/app/flow/${id}`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  return id;
}

async function selectNode(page: Page, text: RegExp) {
  await expect(async () => {
    await page.locator('.react-flow__node').filter({ hasText: text }).first().click();
    await expect(page.locator('.flow-config-title')).toHaveText(text, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

test('Flow: reintentos y si falla quedan en Avanzado', async ({ page }) => {
  await openTemplateFlow(page);
  await selectNode(page, /Slack/);
  const side = page.locator('.flow-side');
  await expect(side.getByLabel('Canal')).toBeVisible();
  const toggle = side.getByRole('button', { name: /Avanzado/ });
  // La plantilla deja reintentos en 1 (el default): Avanzado no marca cambios.
  if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
  await expect(side.getByLabel('Reintentos si falla')).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(side.getByLabel('Reintentos si falla')).toBeVisible();
  await expect(side.getByLabel('Si este paso falla')).toBeVisible();
});

test('Flow: crear una credencial sin salir del editor', async ({ page }) => {
  const id = await openTemplateFlow(page);
  await selectNode(page, /Slack/);
  await page.getByRole('button', { name: 'Crear credencial' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva credencial' });
  await expect(dialog).toBeVisible();
  // El tipo viene del nodo y el nombre técnico se deriva solo.
  await expect(dialog.getByLabel('Tipo')).toHaveValue('slack');
  await dialog.getByLabel(/Webhook/i).first().fill('https://hooks.slack.com/services/T000/B000/XXXX');
  await dialog.getByRole('button', { name: 'Crear credencial' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/app/flow/${id}$`));
  const select = page.locator('.flow-side').getByLabel('Credencial');
  await expect(select).not.toHaveValue('');
  await expect(select.locator('option:checked')).toContainText(/slack/);
  createdCredentials.push(await select.inputValue());
  await expect(page.getByText(/Cambios sin guardar|Guardando|Borrador guardado/)).toBeVisible();
});

test('Flow: tabs con flechas y modal de prueba con Esc', async ({ page }) => {
  await openTemplateFlow(page);
  const editorTab = page.getByRole('tab', { name: 'Editor' });
  await expect(editorTab).toHaveAttribute('aria-selected', 'true');
  await editorTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Ejecuciones' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Ejecuciones' })).toBeFocused();
  await expect(page.getByText('Todavía no hay ejecuciones')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(editorTab).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: 'Probar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Probar' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Datos de prueba')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('Flow: el paso Track crear issue elige el equipo de una lista', async ({ page }) => {
  const teamRes = await page.request.post('/api/track/projects', { data: { name: `E2E flow team ${uid()}` } });
  expect(teamRes.ok()).toBeTruthy();
  const team = (await teamRes.json()) as { id: string; slug: string };
  try {
    const graph = (projectId: string) => ({
      nodes: [
        { id: 'trigger', type: 'trigger.event', position: { x: 0, y: 0 }, config: { event: 'booking.created' } },
        { id: 'issue', type: 'app.track_issue', position: { x: 0, y: 160 }, config: { projectId, title: 'E2E', priority: 'medium' } },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'issue' }],
    });
    const created = async (projectId: string) => {
      const res = await page.request.post('/api/flow/flows', { data: { name: `E2E ${uid()}`, graph: graph(projectId) } });
      expect(res.ok()).toBeTruthy();
      const { id } = (await res.json()) as { id: string };
      createdFlows.push(id);
      return id;
    };
    const openIssueNode = async (flowId: string) => {
      await page.goto(`/en/app/flow/${flowId}`);
      const node = page.locator('.react-flow__node[data-id="issue"]');
      await expect(node).toBeVisible();
      await expect(async () => {
        await node.click();
        await expect(page.getByTestId('flow-track-project')).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 20_000 });
      return page.getByTestId('flow-track-project');
    };

    // Sin equipo: el select ofrece los equipos de Track y, al elegir uno, el link para abrirlo.
    const picker = await openIssueNode(await created(''));
    await expect(picker).toHaveValue('');
    await picker.selectOption(team.id);
    await expect(picker).toHaveValue(team.id);
    await expect(page.locator(`.flow-side a[href$="/app/track/team/${team.slug.toUpperCase()}"]`)).toBeVisible();

    // Un id que ya no existe queda marcado como inválido en lugar de mostrarse vacío.
    const stale = await openIssueNode(await created('00000000-0000-4000-8000-000000000000'));
    await expect(stale).toHaveAttribute('aria-invalid', 'true');
    await expect(stale).toHaveValue('00000000-0000-4000-8000-000000000000');
  } finally {
    await page.request.delete(`/api/track/projects/${team.id}`).catch(() => null);
  }
});
