import { expect, test } from '@playwright/test';

/** La barra de formato flota sobre la selección sin salirse del editor: ni sobre el sidebar ni cortada en el teléfono. */

const uid = () => Math.random().toString(36).slice(2, 8);

for (const width of [1280, 390]) {
  test(`Docs: la barra de formato queda adentro del editor a ${width}px`, async ({ request, page }) => {
    await page.setViewportSize({ width, height: 844 });
    const doc = (await (await request.post('/api/docs/pages', { data: { title: `Barra ${uid()}` } })).json()) as { id: string };
    await request.patch(`/api/docs/pages/${doc.id}`, {
      data: {
        content: [
          { id: 'a', type: 'paragraph', content: 'Primera línea del documento para tener algo arriba.' },
          { id: 'b', type: 'paragraph', content: 'Un párrafo con texto para seleccionar desde el principio.' },
        ],
      },
    });
    await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
    const para = page.locator('.docs-blocks .docs-editable').nth(1);
    await para.click();
    // Selección al principio del renglón: el centro queda pegado al borde izquierdo de la columna.
    await page.keyboard.press('Home');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
    const bar = page.locator('.docs-format-toolbar');
    await expect(bar).toBeVisible();
    const editor = (await page.locator('.docs-editor').boundingBox())!;
    await expect
      .poll(async () => {
        const b = (await bar.boundingBox())!;
        return b.x >= Math.max(0, editor.x) && b.x + b.width <= Math.min(width, editor.x + editor.width) + 1;
      })
      .toBe(true);
    // No tapa lo seleccionado.
    const b = (await bar.boundingBox())!;
    const sel = await page.evaluate(() => {
      const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    expect(b.y + b.height <= sel.top + 1 || b.y >= sel.bottom - 1).toBe(true);
  });
}
