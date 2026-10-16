import { expect, test, type Page } from '@playwright/test';

/** Agents: camino básico corto, Avanzado, tabs con teclado y un solo Guardar. */
async function createAgent(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/agents', { data: { name } });
  expect(res.ok()).toBeTruthy();
  const { id } = (await res.json()) as { id: string };
  return id;
}

test('lista: la tabla de agentes y las plantillas cargan sin errores', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await createAgent(page, 'Agente de lista');
  await page.goto('/es/app/agents', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Agente de lista' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Usar plantilla' })).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('instrucciones: lo básico a la vista, derivación y modelo en Avanzado', async ({ page }) => {
  const id = await createAgent(page, 'Agente básico');
  await page.goto(`/es/app/agents/${id}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem('zs-advanced:agents.instructions');
    } catch {
      /* sin storage */
    }
  });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('textbox', { name: 'Instrucciones', exact: true })).toBeVisible();
  await expect(page.getByLabel('Mensaje de bienvenida')).toBeVisible();
  await expect(page.getByLabel('Modelo', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: /Avanzado/ }).first().click();
  await expect(page.getByLabel('Modelo', { exact: true })).toBeVisible();
  await expect(page.getByText('Derivar a una persona', { exact: true })).toBeVisible();
});

test('pestañas: flechas mueven el foco y la pestaña activa', async ({ page }) => {
  const id = await createAgent(page, 'Agente teclado');
  await page.goto(`/es/app/agents/${id}`, { waitUntil: 'networkidle' });
  const first = page.getByRole('tab', { name: 'Instrucciones' });
  await first.focus();
  await page.keyboard.press('ArrowRight');
  const knowledge = page.getByRole('tab', { name: 'Conocimiento' });
  await expect(knowledge).toBeFocused();
  await expect(knowledge).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Conversaciones' })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/tab=conversations/);
});

test('herramientas: agrupadas por producto y Request HTTP en Avanzado', async ({ page }) => {
  const id = await createAgent(page, 'Agente herramientas');
  await page.goto(`/es/app/agents/${id}?tab=tools`, { waitUntil: 'networkidle' });
  for (const group of ['Docs', 'Chat', 'CRM', 'Cal', 'Track', 'Flow']) {
    await expect(page.getByRole('heading', { level: 2, name: group, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('switch', { name: 'Request HTTP' })).toBeHidden();
  await page.getByRole('button', { name: /Avanzado/ }).click();
  await expect(page.getByRole('switch', { name: 'Request HTTP' })).toBeVisible();
});

test('un solo Guardar: aparece con cambios, guarda y se va', async ({ page }) => {
  const id = await createAgent(page, 'Agente guardar');
  await page.goto(`/es/app/agents/${id}`, { waitUntil: 'networkidle' });
  const save = page.getByRole('button', { name: 'Guardar cambios' });
  await expect(save).toBeHidden();
  await page.getByLabel('Mensaje de bienvenida').fill('Hola, ¿en qué te ayudo?');
  await expect(save).toBeEnabled();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(save).toBeHidden();
  const res = await page.request.get(`/api/agents/${id}`);
  const body = (await res.json()) as { agent: { welcomeMessage: string } };
  expect(body.agent.welcomeMessage).toBe('Hola, ¿en qué te ayudo?');
});

test('canales: publicar deriva el handle del nombre', async ({ page }) => {
  const id = await createAgent(page, `Soporte Público ${Date.now().toString(36)}`);
  await page.goto(`/es/app/agents/${id}?tab=channels`, { waitUntil: 'networkidle' });
  await page.getByRole('switch', { name: 'Publicar en una página pública' }).check();
  await expect(page.getByLabel('Handle público')).toHaveValue(/^soporte-publico-[a-z0-9]+$/);
});

test('conversaciones: vacío con acción al playground', async ({ page }) => {
  const id = await createAgent(page, 'Agente sin conversaciones');
  await page.goto(`/es/app/agents/${id}?tab=conversations`, { waitUntil: 'networkidle' });
  await expect(page.getByText('Todavía no hay conversaciones')).toBeVisible();
  await page.getByRole('button', { name: 'Probar en el playground' }).click();
  await expect(page.getByRole('tab', { name: 'Playground' })).toHaveAttribute('aria-selected', 'true');
});
