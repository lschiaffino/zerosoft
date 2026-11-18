import { expect, test } from '@playwright/test';

/**
 * Builder de Forms: lo que se escribe mientras ⌘S está guardando queda en el editor. Antes la respuesta del
 * servidor reemplazaba todo el estado y borraba lo tecleado durante el pedido.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

for (const width of [1280, 390]) {
  test(`Forms: escribir durante un guardado lento no se pierde (${width}px)`, async ({ page, request }) => {
    const created = await request.post('/api/forms', { data: { name: `Typing ${uid()}`, template: 'contact' } });
    expect(created.ok()).toBe(true);
    const { form } = (await created.json()) as { form: { id: string } };

    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/en/app/forms/${form.id}`, { waitUntil: 'networkidle' });
    const name = page.getByRole('textbox', { name: 'Form name', exact: true });
    const first = `Primero ${uid()}`;
    await name.fill(first);
    await expect(page.getByTestId('fm-dirty')).toBeVisible();

    // El PATCH queda retenido hasta que se termina de escribir.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let reached!: () => void;
    const inFlight = new Promise<void>((r) => (reached = r));
    await page.route(`**/api/forms/${form.id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      reached();
      await gate;
      await route.continue().catch(() => {});
    });

    await name.press('ControlOrMeta+s');
    await inFlight;
    await name.press('End');
    await name.pressSequentially(' segundo');
    const saved = page.waitForResponse((r) => r.url().includes(`/api/forms/${form.id}`) && r.request().method() === 'PATCH');
    release();
    expect((await saved).ok()).toBe(true);
    await page.unroute(`**/api/forms/${form.id}`);

    // Lo escrito durante el pedido sigue ahí y todavía falta guardarlo.
    await expect(name).toHaveValue(`${first} segundo`);
    await expect(page.getByTestId('fm-dirty')).toBeVisible();

    // El siguiente guardado lo manda y el aviso se va.
    const second = page.waitForResponse((r) => r.url().includes(`/api/forms/${form.id}`) && r.request().method() === 'PATCH');
    await name.press('ControlOrMeta+s');
    expect((await second).ok()).toBe(true);
    await expect(page.getByTestId('fm-dirty')).toHaveCount(0);
    await expect(name).toHaveValue(`${first} segundo`);
    const after = (await (await request.get(`/api/forms/${form.id}`)).json()) as { form: { name: string } };
    expect(after.form.name).toBe(`${first} segundo`);
  });
}
