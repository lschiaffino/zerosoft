import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * CRM C5: el asistente ofrece las opciones de Lifecycle stage del workspace
 * (una propia se propone por su nombre y se guarda con su clave al
 * confirmar) y no propone una archivada. Modelo falso (CRM_AI_FAKE=1), un
 * workspace propio por test (la base es compartida). Datos inventados.
 */
const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()) as T;
}

async function ownWorkspace(browser: Browser, width: number) {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: width < 500 ? 844 : 900 } });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: `c5-ai-${uid()}@crm-c5-e2e.test`, url: baseURL }]);
  await ok(ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: 'team', name: 'C5', locale: 'en', apps: ['crm'] } }));
  await ctx.request.post('/api/tours', { data: { kind: 'off', off: true } });
  return ctx;
}

async function noHorizontalScroll(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
}

for (const width of [1280, 390]) {
  test(`asistente: propone una etapa propia del workspace y la guarda al confirmar (${width}px)`, async ({ browser }) => {
    test.slow();
    const ctx = await ownWorkspace(browser, width);
    try {
      const r = ctx.request;
      const added = await ok<{ options: Array<{ value: string; label: string | null }> }>(
        r.post('/api/crm/property-options', { data: { action: 'add', property: 'lifecycle', label: 'Trial user' } }),
      );
      const trial = added.options.find((o) => o.label === 'Trial user')!;
      await ok(r.post('/api/crm/property-options', { data: { action: 'update', property: 'lifecycle', value: 'subscriber', archived: true } }));
      const contact = await ok<{ id: string }>(r.post('/api/crm/contacts', { data: { firstName: 'Iris', lastName: `Vale${uid()}`, email: `iris.${uid()}@example.test` } }));

      const page = await ctx.newPage();
      await page.goto(`/en/app/crm/contacts/${contact.id}`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Ask AI' }).click();
      const panel = page.getByRole('dialog', { name: 'CRM assistant' });
      await expect(panel).toBeVisible();
      const input = panel.getByRole('textbox', { name: 'Ask about the CRM…' });

      // Archivada: no se propone.
      await input.fill('set lifecycle to Subscriber');
      await input.press('Enter');
      await expect(panel.getByText("I couldn't prepare that change (invalid_field_or_value).")).toBeVisible();
      await expect(panel.getByTestId('ai-proposal')).toHaveCount(0);

      // Propia: la tarjeta la nombra y nada cambia hasta confirmar.
      await input.fill('set lifecycle to trial user');
      await input.press('Enter');
      const proposal = panel.getByTestId('ai-proposal').last();
      await expect(proposal).toContainText('Set lifecycle stage of');
      await expect(proposal).toContainText('to Trial user');
      await expect(proposal).not.toContainText(trial.value);
      let saved = await ok<{ contact: { lifecycle_stage: string } }>(r.get(`/api/crm/contacts/${contact.id}`));
      expect(saved.contact.lifecycle_stage).not.toBe(trial.value);
      await noHorizontalScroll(page);

      await proposal.getByRole('button', { name: 'Confirm' }).click();
      await expect(proposal).toContainText('Done.');
      saved = await ok<{ contact: { lifecycle_stage: string } }>(r.get(`/api/crm/contacts/${contact.id}`));
      expect(saved.contact.lifecycle_stage).toBe(trial.value);

      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      if (width > 500) {
        // La ficha la muestra con su nombre (en el teléfono las propiedades van en otra pestaña).
        await page.reload({ waitUntil: 'networkidle' });
        await expect(page.locator('[data-prop="lifecycleStage"] .prop-btn').first()).toContainText('Trial user');
      }
    } finally {
      await ctx.close();
    }
  });
}
