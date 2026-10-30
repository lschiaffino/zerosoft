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
  // A y B escriben en el mismo lugar (el borde de la unión): sus letras pueden quedar intercaladas, ninguna se pierde.
  expect(count(text, 'M')).toBe(2);
  expect(text.replace(/M/g, '')).toBe('first line uno dos tres cuatro cinco seis siete ochosecond line');
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
