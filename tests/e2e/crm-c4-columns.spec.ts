import { expect as baseExpect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CRM, bloque C4 (columnas de los índices, como en HubSpot):
 * - Arrastrar el borde de un encabezado cambia el ancho; queda en la URL y se guarda con la vista;
 * - Doble clic en el borde ajusta la columna a lo que muestra;
 * - Con el teclado: foco en el borde, flechas, Mayúsculas+flecha y Enter (ajustar);
 * - El nombre sigue fijo al desplazar la tabla de costado;
 * - "Editar columnas" sale con la página (viene en el HTML, no después);
 * - 390: tarjetas sin bordes para arrastrar, sin scroll lateral y la fila de filtros rápidos pareja.
 *
 * Cada test crea sus registros con una marca propia y filtra por ella (la
 * cuenta demo es compartida). Se busca por rol, testid o atributo.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const PHONE = { width: 390, height: 844 };

test.describe.configure({ timeout: 150_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

async function json<T>(res: Promise<{ ok(): boolean; text(): Promise<string>; json(): Promise<unknown> }>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()) as T;
}

async function noSideScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${client}`).toBeLessThanOrEqual(client);
}

async function seedContacts(request: APIRequestContext, tag: string, n: number) {
  for (let i = 0; i < n; i++) {
    await json(request.post('/api/crm/contacts', { data: { firstName: 'Cfour', lastName: `${i} ${tag}`, email: `c4-${i}-${tag}@c4.example`, phone: '+1 202 555 0100' } }));
  }
}

const head = (page: Page, id: string) => page.locator(`.crm-table thead th[data-col="${id}"]`);
const widthOf = async (page: Page, id: string) => Math.round((await head(page, id).boundingBox())!.width);
const widthsParam = (page: Page) => new URL(page.url()).searchParams.get('widths') ?? '';

test.describe('resizable columns at 1280', () => {
  test.use({ viewport: { width: 1280, height: 860 } });

  test('drag the header edge, double-click to fit, saved with the view', async ({ page, request }) => {
    const tag = uid();
    await seedContacts(request, tag, 3);
    await page.goto(`/en/app/crm/contacts?q=${tag}&cols=name,email,phone,company,owner`, { waitUntil: 'networkidle' });
    await expect(page.locator('.crm-table tbody tr')).toHaveCount(3);
    await expect(page.locator('table.crm-table.is-sized')).toHaveCount(0);

    // Arrastrar el borde del email 80 px a la derecha.
    const before = await widthOf(page, 'email');
    const handle = page.getByTestId('col-resize-email');
    await head(page, 'email').hover();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(page).toHaveURL(/widths=/);
    await expect(page.locator('table.crm-table.is-sized')).toHaveCount(1);
    expect(Math.abs((await widthOf(page, 'email')) - (before + 80))).toBeLessThanOrEqual(3);
    const saved = Number(/(?:^|,)email:(\d+)/.exec(widthsParam(page))?.[1]);
    expect(Math.abs(saved - (before + 80))).toBeLessThanOrEqual(3);
    // Las otras columnas quedaron como se veían (nada saltó).
    expect(widthsParam(page)).toMatch(/(^|,)name:\d+/);
    expect(widthsParam(page)).toMatch(/(^|,)phone:\d+/);

    // Recargar: el ancho sigue.
    await page.reload({ waitUntil: 'networkidle' });
    expect(Math.abs((await widthOf(page, 'email')) - saved)).toBeLessThanOrEqual(2);

    // Doble clic: la columna se ajusta a lo que muestra (los emails de prueba son más cortos que eso).
    await head(page, 'email').hover();
    await handle.dblclick();
    await expect.poll(async () => Number(/(?:^|,)email:(\d+)/.exec(widthsParam(page))?.[1])).toBeLessThan(saved);
    const fitted = await widthOf(page, 'email');
    expect(fitted).toBeLessThan(saved);
    // Lo que muestra entra entero: el email de la primera fila no queda cortado.
    const cut = await page.locator('.crm-table tbody tr').first().locator('td.card-contact-email .cell-inline').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(cut).toBe(false);

    // Guardar como vista: el ancho viaja con ella.
    const view = await json<{ id: string }>(
      request.post('/api/crm/views', { data: { entity: 'contacts', name: `Widths ${tag}`, query: { q: tag, cols: 'name,email,phone', widths: 'name:300,email:333,phone:150' } } }),
    );
    await page.goto(`/en/app/crm/contacts?sv=${view.id}`, { waitUntil: 'networkidle' });
    expect(Math.abs((await widthOf(page, 'email')) - 333)).toBeLessThanOrEqual(2);
    await expect(page.getByTestId('view-modified')).toHaveCount(0);
    await head(page, 'phone').hover();
    await page.getByTestId('col-resize-phone').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/widths=[^&]*phone%3A170/);
    await expect(page.getByTestId('view-modified')).toBeVisible();
    await page.getByTestId('view-save').click();
    await expect(page.getByTestId('view-modified')).toHaveCount(0);
    const stored = await json<{ query: Record<string, string> }>(request.get(`/api/crm/views/${view.id}`));
    expect(stored.query.widths).toContain('phone:170');
    await page.screenshot({ path: 'test-results/crm-c4-resize-1280.png' });
  });

  test('keyboard: arrows, shift+arrows, Enter fits; the name column stays frozen', async ({ page, request }) => {
    const tag = uid();
    await seedContacts(request, tag, 2);
    await page.goto(`/en/app/crm/contacts?q=${tag}&cols=name,email,phone,company,lifecycle,owner,created,lastActivity,nextActivity&freeze=1`, {
      waitUntil: 'networkidle',
    });
    const handle = page.getByTestId('col-resize-phone');
    await expect(handle).toHaveAttribute('role', 'separator');
    await handle.focus();
    await expect(handle).toBeFocused();
    const start = await widthOf(page, 'phone');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => widthOf(page, 'phone')).toBe(start + 30);
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(() => widthOf(page, 'phone')).toBe(start - 20);
    await expect(page).toHaveURL(new RegExp(`widths=[^&]*phone%3A${start - 20}`));
    await expect(handle).toHaveAttribute('aria-valuenow', String(start - 20));
    // End lo lleva al máximo; Enter lo ajusta al contenido.
    await page.keyboard.press('End');
    await expect.poll(() => widthOf(page, 'phone')).toBe(800);
    await page.keyboard.press('Enter');
    await expect.poll(() => widthOf(page, 'phone')).toBeLessThan(400);
    await expect(handle).toBeFocused();

    // Más ancha que la pantalla: al desplazar la tabla, el nombre queda en su lugar.
    await page.keyboard.press('End');
    await expect.poll(() => widthOf(page, 'phone')).toBe(800);
    const nameX = (await head(page, 'name').boundingBox())!.x;
    await page.getByTestId('table-scroll').evaluate((el) => {
      el.scrollLeft = 500;
    });
    await expect.poll(async () => Math.round((await head(page, 'name').boundingBox())!.x)).toBe(Math.round(nameX));
    await expect.poll(async () => (await head(page, 'email').boundingBox())!.x).toBeLessThan(nameX);
    await noSideScroll(page);
  });

  test('Edit columns renders with the page', async ({ page, request }) => {
    for (const path of ['/en/app/crm/contacts', '/en/app/crm/companies', '/en/app/crm/deals?view=table']) {
      const html = await (await request.get(path)).text();
      expect(html, path).toContain('data-testid="edit-columns-btn"');
    }
    await page.goto('/en/app/crm/companies', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('edit-columns-btn')).toBeVisible();
  });
});

test.describe('columns at 390 (touch)', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('cards without resize handles, no sideways scroll, even quick filter row', async ({ page, request }) => {
    const tag = uid();
    await seedContacts(request, tag, 2);
    await page.goto(`/en/app/crm/contacts?q=${tag}&widths=name:300,email:500,phone:400`, { waitUntil: 'networkidle' });
    await expect(page.locator('.crm-table tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('col-resize-email')).toBeHidden();
    await expect(page.getByTestId('edit-columns-btn')).toBeVisible();
    await noSideScroll(page);

    // Los <select> y los botones de fecha de la fila de filtros rápidos, con la misma letra.
    const sizes = await page.getByTestId('quick-filters').evaluate((row) => {
      const size = (el: Element | null) => (el ? getComputedStyle(el).fontSize : null);
      return { select: size(row.querySelector('select.filter-select')), date: size(row.querySelector('button.filter-btn')), more: size(row.querySelector('.filter-more')) };
    });
    expect(sizes.select).not.toBeNull();
    expect(sizes.date).toBe(sizes.select);
    expect(sizes.more).toBe(sizes.select);
    await page.screenshot({ path: 'test-results/crm-c4-columns-390.png' });
  });
});
