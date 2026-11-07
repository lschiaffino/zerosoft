import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Docs como reemplazo diario de Notion: editar listas con el teclado (anidar,
 * salir, Backspace), cómo se ven (marcas alineadas, 1. → a. → i.), Markdown
 * en línea al tipear y pegar desde Notion, Google Docs y Markdown.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
type Block = { id: string; type: string; content: string; indent?: number; checked?: boolean; level?: number; toggle?: boolean; icon?: string; language?: string; color?: string };

async function newDoc(request: APIRequestContext, title: string, content?: Block[]) {
  const doc = (await (await request.post('/api/docs/pages', { data: { title } })).json()) as { id: string };
  if (content) expect((await request.patch(`/api/docs/pages/${doc.id}`, { data: { content } })).ok()).toBeTruthy();
  return doc;
}
async function blocksOf(request: APIRequestContext, id: string): Promise<Block[]> {
  return ((await (await request.get(`/api/docs/pages/${id}`)).json()) as { content: Block[] }).content;
}
const shape = (blocks: Block[]) => blocks.map((b) => `${'  '.repeat(b.indent ?? 0)}${b.type}${b.checked ? '+' : ''}:${b.content}`);
const editable = (p: Page, text: string) => p.locator('.docs-blocks .docs-editable', { hasText: text }).first();

test('Listas: Tab y Shift+Tab anidan, Enter en un ítem vacío sale, Backspace vuelve texto y después une', async ({ request, page }) => {
  const doc = await newDoc(request, `Listas ${uid()}`);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.locator('.docs-blocks .docs-editable').first().click();
  const k = page.keyboard;
  await k.type('- Uno');
  await k.press('Enter');
  await k.press('Tab');
  await k.type('Hijo');
  await k.press('Enter');
  await k.press('Tab');
  await k.type('Nieto');
  await k.press('Enter');
  await k.press('Shift+Tab');
  await k.type('Hijo dos');
  await k.press('Enter');
  // Ítem vacío anidado: Enter lo sube un nivel; vacío arriba: Enter sale de la lista.
  await k.press('Enter');
  await k.press('Enter');
  await k.type('1. Primero');
  await k.press('Enter');
  await k.type('Segundo');
  await k.press('Enter');
  await k.press('Tab');
  await k.type('Sub');
  await k.press('Enter');
  await k.press('Enter');
  await k.type('Tercero');
  await k.press('Enter');
  await k.press('Enter');
  await k.type('[] Tarea');
  await expect
    .poll(async () => shape(await blocksOf(request, doc.id)), { timeout: 10_000 })
    .toEqual([
      'bulleted_list_item:Uno',
      '  bulleted_list_item:Hijo',
      '    bulleted_list_item:Nieto',
      '  bulleted_list_item:Hijo dos',
      'numbered_list_item:Primero',
      'numbered_list_item:Segundo',
      '  numbered_list_item:Sub',
      'numbered_list_item:Tercero',
      'todo:Tarea',
    ]);

  // Marcas por nivel: viñeta llena, hueca, chica; números 1. → a.
  await expect(editable(page, 'Hijo dos')).toHaveAttribute('data-depth', '1');
  await expect(editable(page, 'Nieto')).toHaveAttribute('data-depth', '2');
  await expect(editable(page, 'Sub')).toHaveAttribute('data-marker', 'a');
  await expect(editable(page, 'Tercero')).toHaveAttribute('data-marker', '3');

  // El texto de viñeta, número y tarea arranca en la misma x; un hijo arranca donde el texto del padre.
  const textX = async (text: string) =>
    editable(page, text).evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return Math.round(r.getClientRects()[0].left);
    });
  const [uno, primero, tarea, hijo] = [await textX('Uno'), await textX('Primero'), await textX('Tarea'), await textX('Hijo')];
  expect(Math.abs(uno - primero)).toBeLessThanOrEqual(1);
  expect(Math.abs(uno - tarea)).toBeLessThanOrEqual(1);
  const hijoBox = (await page.locator('.docs-block-outer[data-bi="1"]').boundingBox())!;
  expect(Math.abs(hijoBox.x - uno)).toBeLessThanOrEqual(1);
  expect(hijo).toBeGreaterThan(uno);

  // Backspace al inicio de un ítem anidado: queda texto anidado; otro Backspace lo desanida; otro lo une.
  await editable(page, 'Hijo dos').click();
  await k.press('Home');
  await k.press('Backspace');
  await expect.poll(async () => shape(await blocksOf(request, doc.id))[3]).toBe('  paragraph:Hijo dos');
  await k.press('Backspace');
  await expect.poll(async () => shape(await blocksOf(request, doc.id))[3]).toBe('paragraph:Hijo dos');
  await k.press('Backspace');
  await expect.poll(async () => shape(await blocksOf(request, doc.id))[2]).toBe('    bulleted_list_item:NietoHijo dos');
});

test('Markdown en línea al tipear: negrita, cursiva, código y tachado; lo que sigue va sin formato', async ({ request, page }) => {
  const doc = await newDoc(request, `Marcas ${uid()}`);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.locator('.docs-blocks .docs-editable').first().click();
  await page.keyboard.type('a **b** c *d* e `f` g ~~h~~ i');
  await expect
    .poll(async () => (await blocksOf(request, doc.id))[0]?.content, { timeout: 10_000 })
    .toBe('a <strong>b</strong> c <em>d</em> e <code>f</code> g <s>h</s> i');
});

test('Pegar desde Notion, Google Docs y Markdown arma los bloques', async ({ request, page }) => {
  const paste = async (data: Record<string, string>) => {
    const doc = await newDoc(request, `Pegar ${uid()}`);
    await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
    await page.locator('.docs-blocks .docs-editable').first().click();
    await page.evaluate((d) => {
      const dt = new DataTransfer();
      for (const [t, v] of Object.entries(d)) dt.setData(t, v);
      document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, data);
    let out: Block[] = [];
    await expect.poll(async () => (out = await blocksOf(request, doc.id)).length, { timeout: 10_000 }).toBeGreaterThan(2);
    return out;
  };

  const notion = await paste({
    'text/plain': 'Plan',
    'text/html':
      '<h2>Plan</h2><ul><li>Uno<ul><li>Anidado</li></ul></li></ul><ol><li>Primero</li></ol>' +
      '<ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> <span>Hecha</span></li></ul>' +
      '<ul class="toggle"><li><details open=""><summary>Más</summary><p>Oculto</p></details></li></ul>' +
      '<figure class="callout"><div><span class="icon">⚠️</span></div><div>Ojo</div></figure>' +
      '<pre><code class="language-python">print(1)</code></pre>',
  });
  expect(shape(notion)).toEqual([
    'heading:Plan',
    'bulleted_list_item:Uno',
    '  bulleted_list_item:Anidado',
    'numbered_list_item:Primero',
    'todo+:Hecha',
    'toggle:Más',
    '  paragraph:Oculto',
    'callout:Ojo',
    'code:print(1)',
  ]);
  expect(notion.find((b) => b.type === 'callout')?.icon).toBe('⚠️');
  expect(notion.find((b) => b.type === 'code')?.language).toBe('python');
  await expect(page.locator('.docs-block-toggle')).toHaveCount(1);

  const gdocs = await paste({
    'text/plain': 'Notas',
    'text/html':
      '<b style="font-weight:normal;" id="docs-internal-guid-1"><p><span style="font-weight:700">Negrita</span></p>' +
      '<ul><li aria-level="1"><p><span>G uno</span></p></li><ul><li aria-level="2"><p><span>G anidado</span></p></li></ul></ul></b>',
  });
  expect(shape(gdocs)).toEqual(['paragraph:<strong>Negrita</strong>', 'bulleted_list_item:G uno', '  bulleted_list_item:G anidado']);

  const md = await paste({ 'text/plain': '# Título\n\n- uno\n  - dos\n\n1. a\n2. b\n\n- [x] hecha\n' });
  expect(shape(md)).toEqual(['heading:Título', 'bulleted_list_item:uno', '  bulleted_list_item:dos', 'numbered_list_item:a', 'numbered_list_item:b', 'todo+:hecha']);
});

test('Listas en oscuro y a 390px: sin scroll horizontal y con la marca en la primera línea', async ({ request, page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  const long = 'Un ítem largo que ocupa varias líneas en el teléfono para ver que la viñeta queda en la primera línea';
  const doc = await newDoc(request, `Listas 390 ${uid()}`, [
    { id: 'a', type: 'bulleted_list_item', content: long },
    { id: 'b', type: 'bulleted_list_item', content: 'Hijo', indent: 1 },
    { id: 'c', type: 'numbered_list_item', content: 'Diez', indent: 0 },
  ]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const el = editable(page, 'Un ítem largo');
  const { lines, markerTop, textTop } = await el.evaluate((node) => {
    const r = document.createRange();
    r.selectNodeContents(node);
    const rects = [...r.getClientRects()];
    const top = node.getBoundingClientRect().top;
    const before = getComputedStyle(node, '::before');
    return { lines: new Set(rects.map((x) => Math.round(x.top))).size, markerTop: top + parseFloat(before.top), textTop: rects[0].top };
  });
  expect(lines).toBeGreaterThan(1);
  // La marca cae dentro del primer renglón.
  expect(markerTop).toBeGreaterThan(textTop);
  expect(markerTop).toBeLessThan(textTop + 24);
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner + 1);
});

test('Color de bloque desde el menú del asa y link a un bloque', async ({ request, page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL! });
  const doc = await newDoc(request, `Color ${uid()}`, [
    { id: 'a', type: 'paragraph', content: 'Primero' },
    { id: 'b', type: 'bulleted_list_item', content: 'Pintado' },
  ]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await editable(page, 'Pintado').hover();
  await page.locator('.docs-block-outer[data-bi="1"] .docs-block-grip').click();
  await page.getByTestId('docs-bmenu-color').click();
  await page.getByRole('menuitemradio', { name: 'Red background' }).click();
  await expect(page.locator('.docs-block-outer[data-bi="1"]')).toHaveAttribute('data-color', 'red_bg');
  await expect.poll(async () => (await blocksOf(request, doc.id))[1].color).toBe('red_bg');

  await editable(page, 'Pintado').hover();
  await page.locator('.docs-block-outer[data-bi="1"] .docs-block-grip').click();
  await page.getByTestId('docs-bmenu-copy-link').click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(new RegExp(`/app/docs/${doc.id}#b$`));
  // Abrir el link en una carga nueva (solo cambiar el hash no recarga la página).
  await page.goto('about:blank');
  await page.goto(link, { waitUntil: 'networkidle' });
  await expect(page.locator('.docs-block-outer[data-block-anchor="b"]')).toHaveClass(/is-linked/);
});
