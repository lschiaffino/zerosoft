import { createClient } from '@libsql/client';
import { expect, request as pwRequest, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Docs en vivo, segunda parte: deshacer con texto ajeno en el medio (solo se
 * deshace lo propio) y cambios de estructura (partir con Enter, unir con
 * Backspace, "# ") mientras la otra persona sigue escribiendo en ese bloque:
 * ninguna tecla se pierde ni se escribe dos veces y las dos pantallas
 * terminan iguales que el servidor.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

// La edición simultánea es beta (apagada por defecto): estas pruebas la prenden para el
// workspace de demo y la vuelven a apagar al terminar (el resto de los e2e corre sin ella).
async function setCoedit(on: boolean) {
  const api = await pwRequest.newContext({ baseURL: `http://localhost:${Number(process.env.E2E_PORT) || 3210}` });
  const res = await api.patch('/api/docs/settings', { data: { coedit: on } });
  expect(res.ok(), await res.text()).toBeTruthy();
  await api.dispose();
}
test.beforeAll(() => setCoedit(true));
test.afterAll(() => setCoedit(false));

type Block = { id: string; type: string; content: string; level?: number };

async function pageWith(request: APIRequestContext, title: string, content: Block[]) {
  const doc = (await (await request.post('/api/docs/pages', { data: { title } })).json()) as { id: string };
  const res = await request.patch(`/api/docs/pages/${doc.id}`, { data: { content } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return doc;
}

const norm = (s: string) => s.replace(/&nbsp;| /g, ' ');

async function blocksOf(request: APIRequestContext, id: string): Promise<Block[]> {
  const page = (await (await request.get(`/api/docs/pages/${id}`)).json()) as { content: Block[] };
  return page.content.map((b) => ({ ...b, content: norm(b.content ?? '') }));
}

async function textOf(request: APIRequestContext, id: string, block = 'p'): Promise<string | undefined> {
  return (await blocksOf(request, id)).find((b) => b.id === block)?.content;
}

/** Todo el texto de la página, bloque por bloque (para comparar pantallas y servidor). */
async function serverText(request: APIRequestContext, id: string): Promise<string> {
  return (await blocksOf(request, id)).map((b) => b.content.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')).join(' | ');
}

const screenText = (p: Page) =>
  p.locator('.docs-blocks .docs-editable').evaluateAll((els) => els.map((el) => (el.textContent ?? '').replace(/ /g, ' ')).join(' | '));

async function sessionAs(browser: Browser, email: string): Promise<BrowserContext> {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  return ctx;
}

async function shareWith(request: APIRequestContext, ctx: BrowserContext, pageId: string, email: string) {
  const visit = await ctx.newPage();
  await visit.goto('/en/app/docs', { waitUntil: 'domcontentloaded' });
  await visit.close();
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    await db.execute({ sql: "UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", args: [email] });
  } finally {
    db.close();
  }
  const res = await request.post(`/api/docs/pages/${pageId}/share`, { data: { kind: 'user', email, role: 'edit' } });
  expect(res.status(), await res.text()).toBe(201);
}

const editable = (p: Page, id = 'p') => p.locator(`[data-block-anchor="${id}"] .docs-editable`);

async function openLive(p: Page, pageId: string) {
  const ready = p.waitForRequest((r) => r.url().includes(`/api/docs/collab?page=${pageId}`) && r.method() === 'GET', { timeout: 30_000 });
  await p.goto(`/en/app/docs/${pageId}`, { waitUntil: 'domcontentloaded' });
  await ready;
  await p.waitForTimeout(500);
  await expect(editable(p)).toBeVisible();
}

async function caretAtEnd(p: Page, id = 'p') {
  await editable(p, id).click();
  await p.keyboard.press('End');
}

async function caretAtStart(p: Page, id = 'p') {
  await editable(p, id).click({ position: { x: 1, y: 6 } });
}

/** Caret en el offset `n` (texto plano) del bloque. */
async function caretAt(p: Page, n: number, id = 'p') {
  await editable(p, id).click();
  await editable(p, id).evaluate((el, off) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let left = off;
    let node = walker.nextNode();
    while (node) {
      const len = (node.textContent ?? '').length;
      if (left <= len) {
        const r = document.createRange();
        r.setStart(node, left);
        r.collapse(true);
        const sel = getSelection()!;
        sel.removeAllRanges();
        sel.addRange(r);
        return;
      }
      left -= len;
      node = walker.nextNode();
    }
  }, n);
}

/** Las dos pantallas y el servidor terminan con el mismo texto (sin recargar). */
async function converge(request: APIRequestContext, pageId: string, ...pages: Page[]): Promise<string> {
  let last = '';
  let seen: string[] = [];
  await expect
    .poll(
      async () => {
        last = await serverText(request, pageId);
        seen = await Promise.all(pages.map(screenText));
        if (seen.every((s) => s === last)) return 'ok';
        const raw = JSON.stringify(((await (await request.get(`/api/docs/pages/${pageId}`)).json()) as { content: Block[] }).content.map((b) => b.content));
        const doms = await Promise.all(pages.map((p) => p.locator('.docs-blocks .docs-editable').evaluateAll((els) => els.map((el) => el.innerHTML))));
        return `servidor: ${raw} / pantallas: ${JSON.stringify(doms)}`;
      },
      { timeout: 20_000, intervals: [500] },
    )
    .toBe('ok');
  return last;
}

const count = (text: string, word: string) => text.split(word).length - 1;

async function twoPeople(browser: Browser, request: APIRequestContext, content: Block[]) {
  const doc = await pageWith(request, `Estructura ${uid()}`, content);
  const email = `ana-${uid()}@darwin-e2e.io`;
  const ctxA = await browser.newContext();
  const ctxB = await sessionAs(browser, email);
  await shareWith(request, ctxB, doc.id, email);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await openLive(a, doc.id);
  await openLive(b, doc.id);
  return { doc, a, b, close: async () => Promise.all([ctxA.close(), ctxB.close()]) };
}

const TYPED = [' uno', ' dos', ' tres', ' cuatro', ' cinco', ' seis', ' siete', ' ocho'];

/** B escribe palabra por palabra al final del bloque mientras `act` corre en A. */
async function typeWhile(b: Page, act: () => Promise<void>, blockId = 'p') {
  await caretAtEnd(b, blockId);
  const typing = (async () => {
    for (const w of TYPED) await b.keyboard.type(w, { delay: 45 });
  })();
  await b.waitForTimeout(500);
  await act();
  await typing;
}

function everyKeystrokeOnce(text: string, original: string[]) {
  for (const w of [...TYPED.map((x) => x.trim()), ...original]) expect(count(text, w), `"${w}" en: ${text}`).toBe(1);
}

async function afterReload(request: APIRequestContext, id: string, ...pages: Page[]) {
  for (const p of pages) await p.reload({ waitUntil: 'domcontentloaded' });
  for (const p of pages) await expect(p.locator('.docs-blocks .docs-editable').first()).toBeVisible();
  return converge(request, id, ...pages);
}

test('QA en vivo: B escribe sin parar; A parte en el medio dos veces seguidas', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [{ id: 'p', type: 'paragraph', content: 'alpha <strong>beta</strong> gamma delta' }]);
  await typeWhile(b, async () => {
    await caretAt(a, 'alpha be'.length);
    await a.keyboard.press('Enter');
    await a.keyboard.type('AA', { delay: 30 });
    await a.keyboard.press('Enter');
    await a.keyboard.type('BB', { delay: 30 });
  });
  let text = await converge(request, doc.id, a, b);
  everyKeystrokeOnce(text, ['alpha', 'gamma', 'delta', 'AA', 'BB']);
  text = await afterReload(request, doc.id, a, b);
  everyKeystrokeOnce(text, ['alpha', 'gamma', 'delta', 'AA', 'BB']);
  console.log('SPLIT2', text);
  await close();
});

test('QA en vivo: A tipea rápido y aprieta Enter mientras B escribe en el bloque de abajo', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [
    { id: 'p', type: 'paragraph', content: 'top line' },
    { id: 'q', type: 'paragraph', content: 'bottom line' },
  ]);
  await typeWhile(b, async () => {
    await caretAtEnd(a, 'p');
    for (const w of ['x1', 'x2', 'x3']) {
      await a.keyboard.type(w, { delay: 0 });
      await a.keyboard.press('Enter');
    }
  }, 'q');
  let text = await converge(request, doc.id, a, b);
  everyKeystrokeOnce(text, ['top', 'bottom', 'x1', 'x2', 'x3']);
  text = await afterReload(request, doc.id, a, b);
  everyKeystrokeOnce(text, ['top', 'bottom', 'x1', 'x2', 'x3']);
  console.log('ADJ', text);
  await close();
});

test('QA en vivo: A une con Backspace el bloque de B mientras B escribe en el anterior', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [
    { id: 'p', type: 'paragraph', content: 'first <em>line</em>' },
    { id: 'q', type: 'paragraph', content: '<a href="https://example.com">second</a> line' },
  ]);
  await typeWhile(b, async () => {
    await caretAtStart(a, 'q');
    await a.keyboard.press('Backspace');
    await a.keyboard.type('MM', { delay: 30 });
  }, 'p');
  let text = await converge(request, doc.id, a, b);
  console.log('MERGE-PREV-TEXT', text);
  text = await afterReload(request, doc.id, a, b);
  // A y B escriben en el mismo lugar (el borde de la unión): sus letras pueden quedar intercaladas
  // con lo de B, pero ninguna se pierde y las dos van entre "first line" y "second".
  expect(count(text, 'M')).toBe(2);
  expect(text.replace(/M/g, '')).toBe('first line uno dos tres cuatro cinco seis siete ochosecond line');
  expect(text.startsWith('first line')).toBeTruthy();
  expect(text.lastIndexOf('M')).toBeLessThan(text.indexOf('second'));
  const blocks = await blocksOf(request, doc.id);
  console.log('MERGE-PREV', JSON.stringify(blocks.map((x) => x.content)));
  expect(blocks.length).toBe(1);
  expect(blocks[0].content).toContain('href="https://example.com"');
  await close();
});

test('QA en vivo: los dos escriben y ambos parten el mismo bloque', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [{ id: 'p', type: 'paragraph', content: 'one two three four five' }]);
  await caretAt(a, 'one'.length);
  await caretAtEnd(b);
  const ta = (async () => {
    for (const w of ['Aa', 'Ab', 'Ac']) {
      await a.keyboard.type(w, { delay: 35 });
      await a.keyboard.press('Enter');
    }
  })();
  const tb = (async () => {
    for (const w of ['Ba', 'Bb', 'Bc']) {
      await b.keyboard.type(w, { delay: 35 });
      await b.keyboard.press('Enter');
    }
  })();
  await Promise.all([ta, tb]);
  let text = await converge(request, doc.id, a, b);
  for (const w of ['one', 'two', 'three', 'four', 'five', 'Aa', 'Ab', 'Ac', 'Ba', 'Bb', 'Bc']) expect(count(text, w), text).toBe(1);
  text = await afterReload(request, doc.id, a, b);
  for (const w of ['one', 'two', 'three', 'four', 'five', 'Aa', 'Ab', 'Ac', 'Ba', 'Bb', 'Bc']) expect(count(text, w), text).toBe(1);
  console.log('BOTH', text);
  await close();
});

test('QA en vivo: "## " y "- " mientras la otra persona escribe en el bloque; luego Backspace', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [
    { id: 'p', type: 'paragraph', content: 'Heading text' },
    { id: 'q', type: 'paragraph', content: 'Item text' },
  ]);
  await typeWhile(b, async () => {
    await caretAtStart(a, 'p');
    await a.keyboard.type('## ', { delay: 20 });
    await caretAtStart(a, 'q');
    await a.keyboard.type('- ', { delay: 20 });
  });
  let text = await converge(request, doc.id, a, b);
  everyKeystrokeOnce(text, ['Heading', 'Item']);
  expect(count(text, '#')).toBe(0);
  text = await afterReload(request, doc.id, a, b);
  const blocks = await blocksOf(request, doc.id);
  console.log('MD2', JSON.stringify(blocks.map((x) => [x.type, x.level, x.content])));
  expect(blocks.find((x) => x.id === 'p')?.type).toBe('heading');
  expect(blocks.find((x) => x.id === 'q')?.type).toBe('bulleted_list_item');
  // Ahora Backspace en el ítem mientras B escribe en él.
  await typeWhile(b, async () => {
    await caretAtStart(a, 'q');
    await a.keyboard.press('Backspace');
  }, 'q');
  text = await converge(request, doc.id, a, b);
  for (const w of ['Heading', 'Item']) expect(count(text, w)).toBe(1);
  for (const w of TYPED.map((x) => x.trim())) expect(count(text, w), text).toBe(2);
  console.log('MD2-BS', text);
  await close();
});

test('QA en vivo: (texto plano) B escribe al final; A parte dos veces antes de su caret', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [{ id: 'p', type: 'paragraph', content: 'alpha beta gamma delta' }]);
  await typeWhile(b, async () => {
    await caretAt(a, 'alpha be'.length);
    await a.keyboard.press('Enter');
    await a.keyboard.type('AA', { delay: 30 });
    await a.keyboard.press('Enter');
    await a.keyboard.type('BB', { delay: 30 });
  });
  const text = await converge(request, doc.id, a, b);
  console.log('SPLIT2-PLAIN', JSON.stringify((await blocksOf(request, doc.id)).map((x) => x.content)));
  for (const w of [...TYPED.map((x) => x.trim()), 'alpha', 'gamma', 'delta', 'AA', 'BB']) expect(count(text, w), text).toBe(1);
  // Lo de B queda todo junto al final del último bloque (donde estaba su caret).
  const blocks = await blocksOf(request, doc.id);
  expect(blocks[blocks.length - 1].content.endsWith(TYPED.join('')), text).toBeTruthy();
  await close();
});

const dump = async (request: APIRequestContext, id: string) => JSON.stringify((await blocksOf(request, id)).map((x) => [x.type, x.content]));

test('QA1: borrar una letra arriba y Enter+texto en otro bloque mientras B escribe en p', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [
    { id: 'p', type: 'paragraph', content: 'hello world mine' },
    { id: 'q', type: 'paragraph', content: 'other' },
  ]);
  await typeWhile(b, async () => {
    await caretAt(a, 'hello'.length);
    await a.keyboard.press('Backspace');
    await a.waitForTimeout(600);
    await caretAtEnd(a, 'q');
    await a.keyboard.press('Enter');
    await a.keyboard.type('foo bar', { delay: 10 });
  });
  const text = await converge(request, doc.id, a, b);
  console.log('QA1', await dump(request, doc.id));
  expect(text).toContain('hell world mine uno dos tres cuatro cinco seis siete ocho');
  expect(text).toContain('foo bar');
  await close();
});

test('QA1b: lo mismo, Enter al final de p con B escribiendo en otro lado de p', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [
    { id: 'p', type: 'paragraph', content: 'hello world mine' },
    { id: 'q', type: 'paragraph', content: 'other' },
  ]);
  await caretAt(b, 'hello world'.length);
  const typing = (async () => { for (const w of TYPED) await b.keyboard.type(w, { delay: 45 }); })();
  await b.waitForTimeout(500);
  await caretAt(a, 'hel'.length);
  await a.keyboard.press('Delete');
  await a.waitForTimeout(600);
  await caretAtEnd(a, 'p');
  await a.keyboard.press('Enter');
  await a.keyboard.type('zzz lol', { delay: 10 });
  await typing;
  const text = await converge(request, doc.id, a, b);
  console.log('QA1b', await dump(request, doc.id));
  expect(text).toBe('helo world uno dos tres cuatro cinco seis siete ocho mine | zzz lol | other');
  await close();
});

for (const [name, content, cutAt] of [
  ['aaaa', 'xaaaa yy', 3],
  ['ttt', 'butttt ttt end', 4],
  ['acentos', 'café 😀 naïve ação fin', 'café 😀 na'.length],
  ['nbsp', 'one&nbsp;&nbsp;two three', 4],
  ['italic-link', 'pre <em>itálico</em> <a href="https://example.com">linkito</a> post', 'pre itálico lin'.length],
] as const) {
  test(`QA2 ${name}: A parte dos veces mientras B escribe al final`, async ({ browser, request }) => {
    test.setTimeout(150_000);
    const { doc, a, b, close } = await twoPeople(browser, request, [{ id: 'p', type: 'paragraph', content }]);
    const orig = await serverText(request, doc.id);
    await typeWhile(b, async () => {
      await caretAt(a, cutAt as number);
      await a.keyboard.press('Enter');
      await a.keyboard.type('AA', { delay: 30 });
      await a.keyboard.press('Enter');
      await a.keyboard.type('BB', { delay: 30 });
    });
    let text = await converge(request, doc.id, a, b);
    console.log('QA2', name, await dump(request, doc.id));
    const flat = text.split(' | ');
    expect(flat.length).toBe(3);
    expect(flat[0] + flat[1].replace(/^AA/, '') + flat[2].replace(/^BB/, '')).toBe(orig + TYPED.join(''));
    text = await afterReload(request, doc.id, a, b);
    expect(text.split(' | ').length).toBe(3);
    await close();
  });
}

for (const kind of ['heading', 'bulleted_list_item'] as const) {
  test(`QA3 ${kind}: A parte en el medio mientras B escribe al final`, async ({ browser, request }) => {
    test.setTimeout(150_000);
    const blk: Block = { id: 'p', type: kind, content: 'title <strong>bold</strong> words here', ...(kind === 'heading' ? { level: 2 } : {}) };
    const { doc, a, b, close } = await twoPeople(browser, request, [blk]);
    await typeWhile(b, async () => {
      await caretAt(a, 'title bo'.length);
      await a.keyboard.press('Enter');
      await a.keyboard.type('X1', { delay: 30 });
      await a.keyboard.press('Enter');
      await a.keyboard.type('X2', { delay: 30 });
    });
    const text = await converge(request, doc.id, a, b);
    console.log('QA3', kind, await dump(request, doc.id));
    for (const w of [...TYPED.map((x) => x.trim()), 'title', 'words', 'here', 'X1', 'X2']) expect(count(text, w), text).toBe(1);
    expect(text.endsWith(TYPED.join('')), text).toBeTruthy();
    await afterReload(request, doc.id, a, b);
    await close();
  });
}

test('QA4: A une con Backspace mientras B escribe en el bloque unido', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [
    { id: 'p', type: 'paragraph', content: 'first line' },
    { id: 'q', type: 'paragraph', content: 'second <strong>line</strong>' },
  ]);
  await typeWhile(b, async () => {
    await caretAtStart(a, 'q');
    await a.keyboard.press('Backspace');
    await a.keyboard.type('MM', { delay: 30 });
  }, 'q');
  let text = await converge(request, doc.id, a, b);
  console.log('QA4', await dump(request, doc.id));
  expect(text).toBe('first lineMMsecond line' + TYPED.join(''));
  text = await afterReload(request, doc.id, a, b);
  expect(text).toBe('first lineMMsecond line' + TYPED.join(''));
  await close();
});

// Tres personas partiendo a la vez el bloque donde escribe una tercera: limitación conocida
// (la reubicación sigue un solo corte ajeno por tanda de bloques nuevos).
test.fixme('QA5: tres personas, A y C parten mientras B escribe', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [{ id: 'p', type: 'paragraph', content: 'one two three four five six' }]);
  const email = `carl-${uid()}@darwin-e2e.io`;
  const ctxC = await sessionAs(browser, email);
  await shareWith(request, ctxC, doc.id, email);
  const c = await ctxC.newPage();
  await openLive(c, doc.id);
  await typeWhile(b, async () => {
    await caretAt(a, 'one'.length);
    await caretAt(c, 'one two three'.length);
    await Promise.all([
      (async () => { await a.keyboard.press('Enter'); await a.keyboard.type('Aa', { delay: 30 }); await a.keyboard.press('Enter'); await a.keyboard.type('Ab', { delay: 30 }); })(),
      (async () => { await c.keyboard.press('Enter'); await c.keyboard.type('Ca', { delay: 30 }); await c.keyboard.press('Enter'); await c.keyboard.type('Cb', { delay: 30 }); })(),
    ]);
  });
  let text = await converge(request, doc.id, a, b, c);
  console.log('QA5', await dump(request, doc.id));
  for (const w of ['one', 'two', 'three', 'four', 'five', 'six', 'Aa', 'Ab', 'Ca', 'Cb', ...TYPED.map((x) => x.trim())]) expect(count(text, w), text).toBe(1);
  expect(text.endsWith('six' + TYPED.join('')), text).toBeTruthy();
  text = await afterReload(request, doc.id, a, b, c);
  await ctxC.close();
  await close();
});

test('QA6: deshacer en B después de que un corte ajeno movió su texto', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [{ id: 'p', type: 'paragraph', content: 'alpha beta gamma delta' }]);
  await typeWhile(b, async () => {
    await caretAt(a, 'alpha be'.length);
    await a.keyboard.press('Enter');
    await a.keyboard.type('AA', { delay: 30 });
  });
  let text = await converge(request, doc.id, a, b);
  console.log('QA6-before', await dump(request, doc.id));
  await b.waitForTimeout(1500);
  for (let i = 0; i < 12; i++) { await b.keyboard.press('ControlOrMeta+z'); await b.waitForTimeout(150); }
  text = await converge(request, doc.id, a, b);
  console.log('QA6-after', await dump(request, doc.id));
  // Lo de A queda; lo de B se deshace (todo o parte), sin letras sueltas ni duplicadas.
  expect(count(text, 'AA')).toBe(1);
  for (const w of ['alpha', 'gamma', 'delta']) expect(count(text, w), text).toBe(1);
  for (const w of TYPED.map((x) => x.trim())) expect(count(text, w), text).toBeLessThanOrEqual(1);
  text = await afterReload(request, doc.id, a, b);
  await close();
});

for (const [name, second, mm] of [['plain+MM', 'second line', true], ['bold-noMM', 'second <strong>line</strong>', false], ['plain-noMM', 'second line', false]] as const) {
  test(`QA4v ${name}`, async ({ browser, request }) => {
    test.setTimeout(150_000);
    const { doc, a, b, close } = await twoPeople(browser, request, [
      { id: 'p', type: 'paragraph', content: 'first line' },
      { id: 'q', type: 'paragraph', content: second },
    ]);
    await typeWhile(b, async () => {
      await caretAtStart(a, 'q');
      await a.keyboard.press('Backspace');
      if (mm) await a.keyboard.type('MM', { delay: 30 });
    }, 'q');
    const text = await converge(request, doc.id, a, b);
    console.log('QA4v', name, await dump(request, doc.id));
    expect(text).toBe('first line' + (mm ? 'MM' : '') + 'second line' + TYPED.join(''));
    await close();
  });
}
