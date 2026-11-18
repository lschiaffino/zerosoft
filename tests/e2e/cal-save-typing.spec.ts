import { expect, test } from '@playwright/test';

/**
 * Editor del tipo de evento: lo que se escribe mientras Guardar está en vuelo queda en el borrador. Antes la
 * respuesta reemplazaba el borrador entero con lo que se había mandado y borraba lo tecleado durante el pedido.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

for (const width of [1280, 390]) {
  test(`Cal: escribir durante un guardado lento no se pierde (${width}px)`, async ({ page, request }) => {
    const et = (await (await request.post('/api/calendar/event-types', { data: { slug: `typing-${uid()}`, title: 'Typing', durationMin: 30 } })).json()) as { id: string };
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/en/app/calendar/event-types/${et.id}`, { waitUntil: 'networkidle' });

    const title = page.getByRole('textbox', { name: 'Title', exact: true });
    const save = page.getByRole('button', { name: 'Save changes' });
    await title.fill('Primero');

    // El PATCH queda retenido hasta que se termina de escribir.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let reached!: () => void;
    const inFlight = new Promise<void>((r) => (reached = r));
    const url = `**/api/calendar/event-types/${et.id}`;
    await page.route(url, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      reached();
      await gate;
      await route.continue().catch(() => {});
    });

    await save.click();
    await inFlight;
    await title.press('End');
    await title.pressSequentially(' segundo');
    const saved = page.waitForResponse((r) => r.url().includes(`/api/calendar/event-types/${et.id}`) && r.request().method() === 'PATCH');
    release();
    expect((await saved).ok()).toBe(true);
    await page.unroute(url);

    // Lo escrito durante el pedido sigue ahí y Guardar sigue disponible para mandarlo.
    await expect(title).toHaveValue('Primero segundo');
    await expect(save).toBeEnabled();
    expect(((await (await request.get(`/api/calendar/event-types/${et.id}`)).json()) as { title: string }).title).toBe('Primero');

    const again = page.waitForResponse((r) => r.url().includes(`/api/calendar/event-types/${et.id}`) && r.request().method() === 'PATCH');
    await save.click();
    expect((await again).ok()).toBe(true);
    await expect(save).toBeDisabled();
    await expect(title).toHaveValue('Primero segundo');
    expect(((await (await request.get(`/api/calendar/event-types/${et.id}`)).json()) as { title: string }).title).toBe('Primero segundo');
  });
}
