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
  return (await blocksOf(request, id)).map((b) => b.content).join(' | ');
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

test('Docs en vivo: deshacer solo deshace lo propio aunque la otra persona escribió en el medio', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [{ id: 'p', type: 'paragraph', content: 'The quick brown fox' }]);

  // A escribe al final.
  await caretAtEnd(a);
  await a.keyboard.type(' jumps', { delay: 30 });
  await expect.poll(() => textOf(request, doc.id), { timeout: 10_000 }).toBe('The quick brown fox jumps');
  // Ana escribe al principio.
  await caretAtStart(b);
  await b.keyboard.type('Hey ', { delay: 30 });
  await expect.poll(() => textOf(request, doc.id), { timeout: 10_000 }).toBe('Hey The quick brown fox jumps');
  await expect(editable(a)).toHaveText('Hey The quick brown fox jumps', { timeout: 10_000 });
  // A sigue (otro paso de deshacer) y Ana escribe al final, después de lo de A.
  await a.waitForTimeout(1200);
  await a.keyboard.type(' high', { delay: 30 });
  await expect.poll(() => textOf(request, doc.id), { timeout: 10_000 }).toBe('Hey The quick brown fox jumps high');
  await caretAtEnd(b);
  await b.keyboard.type(' BKEEP', { delay: 30 });
  await expect(editable(a)).toHaveText('Hey The quick brown fox jumps high BKEEP', { timeout: 10_000 });

  // A deshace dos veces: se van " high" y " jumps"; lo de Ana queda.
  await editable(a).click();
  await a.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => textOf(request, doc.id), { timeout: 10_000 }).toBe('Hey The quick brown fox jumps BKEEP');
  await a.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => textOf(request, doc.id), { timeout: 10_000 }).toBe('Hey The quick brown fox BKEEP');
  // Rehacer vuelve a poner lo de A, sin tocar lo de Ana.
  await a.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => textOf(request, doc.id), { timeout: 10_000 }).toBe('Hey The quick brown fox jumps BKEEP');
  await converge(request, doc.id, a, b);
  await close();
});

test('Docs en vivo: deshacer lo propio cuando la otra persona escribió adentro de eso', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [{ id: 'p', type: 'paragraph', content: 'The fox' }]);
  // A escribe una frase al final (un paso de deshacer).
  await caretAtEnd(a);
  await a.keyboard.type(' jumps over', { delay: 30 });
  await expect.poll(() => textOf(request, doc.id), { timeout: 10_000 }).toBe('The fox jumps over');
  await expect(editable(b)).toHaveText('The fox jumps over', { timeout: 10_000 });
  // Ana escribe en el medio de lo de A (entre "jumps" y " over").
  await caretAt(b, 'The fox jumps'.length);
  await b.keyboard.type('XY', { delay: 40 });
  await expect.poll(() => textOf(request, doc.id), { timeout: 10_000 }).toBe('The fox jumpsXY over');
  await expect(editable(a)).toHaveText('The fox jumpsXY over', { timeout: 10_000 });
  // A deshace: se va lo suyo, lo de Ana queda entero.
  await editable(a).click();
  await a.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => textOf(request, doc.id), { timeout: 10_000 }).toBe('The foxXY');
  await converge(request, doc.id, a, b);
  await close();
});

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

test('Docs en vivo: partir el bloque con Enter mientras la otra persona escribe en él', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [{ id: 'p', type: 'paragraph', content: 'alpha beta gamma delta' }]);
  await typeWhile(b, async () => {
    await caretAt(a, 'alpha beta'.length);
    await a.keyboard.press('Enter');
  });
  const text = await converge(request, doc.id, a, b);
  everyKeystrokeOnce(text, ['alpha', 'beta', 'gamma', 'delta']);
  // Dos bloques: lo de antes del corte en el primero, el resto en el nuevo.
  const blocks = await blocksOf(request, doc.id);
  expect(blocks.length).toBe(2);
  expect(blocks[0].content.startsWith('alpha beta'), text).toBeTruthy();
  // El espacio del principio del bloque nuevo queda (el parser no lo tira).
  expect(blocks[1].content.startsWith(' gamma delta'), text).toBeTruthy();
  await close();
});

test('Docs en vivo: la otra persona parte antes de mi caret y escribe en el bloque nuevo mientras sigo escribiendo', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const PH = ' typed-by-A-all-of-it';
  const { doc, a, b, close } = await twoPeople(browser, request, [{ id: 'p', type: 'paragraph', content: 'alpha beta gamma delta' }]);
  // A escribe sin parar al final del párrafo.
  await caretAtEnd(a);
  const typing = a.keyboard.type(PH, { delay: 90 });
  await b.waitForTimeout(700);
  // B parte después de "alpha" y escribe al principio del bloque nuevo.
  await caretAt(b, 'alpha'.length);
  await b.keyboard.press('Enter');
  await b.keyboard.type('Bnew ', { delay: 30 });
  await typing;
  const text = await converge(request, doc.id, a, b);
  const blocks = await blocksOf(request, doc.id);
  // Lo de A quedó entero y seguido, en el bloque nuevo (donde estaba su caret), con lo de B.
  const tail = blocks.find((x) => x.content.includes('delta'));
  expect(tail?.content, text).toContain('Bnew');
  expect(tail?.content.endsWith(PH), text).toBeTruthy();
  expect(count(text, 'typed-by-A-all-of-it'), text).toBe(1);
  await close();
});

test('Docs en vivo: la otra persona va al final, aprieta Enter y escribe mientras escribo en el mismo bloque', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const PH = ' typed-by-A-all-of-it';
  const { doc, a, b, close } = await twoPeople(browser, request, [{ id: 'p', type: 'paragraph', content: 'alpha beta gamma delta' }]);
  await caretAt(a, 'alpha'.length);
  const typing = a.keyboard.type(PH, { delay: 90 });
  await b.waitForTimeout(700);
  await caretAtEnd(b);
  await b.keyboard.press('Enter');
  await b.keyboard.type('Bline', { delay: 30 });
  await typing;
  const text = await converge(request, doc.id, a, b);
  const blocks = await blocksOf(request, doc.id);
  expect(blocks.length, text).toBe(2);
  expect(blocks[0].content, text).toBe(`alpha${PH} beta gamma delta`);
  expect(blocks[1].content, text).toBe('Bline');
  await close();
});

test('Docs en vivo: componiendo con IME mientras la otra persona parte el bloque antes del caret', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [{ id: 'p', type: 'paragraph', content: 'alpha beta gamma' }]);
  await caretAtEnd(a);
  const cdp = await a.context().newCDPSession(a);
  await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
  await caretAt(b, 'alpha'.length);
  await b.keyboard.press('Enter');
  await a.waitForTimeout(600);
  await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 });
  await a.waitForTimeout(300);
  await cdp.send('Input.insertText', { text: '日本' });
  await a.keyboard.type('X', { delay: 50 });
  const text = await converge(request, doc.id, a, b);
  const blocks = await blocksOf(request, doc.id);
  expect(blocks.map((x) => x.content), text).toEqual(['alpha', ' beta gamma日本X']);
  await close();
});

test('Docs en vivo: unir con Backspace mientras la otra persona escribe en el bloque que se une', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [
    { id: 'a', type: 'paragraph', content: 'first line' },
    { id: 'p', type: 'paragraph', content: 'second line' },
  ]);
  await typeWhile(b, async () => {
    await caretAtStart(a, 'p');
    await a.keyboard.press('Backspace');
  });
  const text = await converge(request, doc.id, a, b);
  everyKeystrokeOnce(text, ['first', 'second']);
  await close();
});

test('Docs en vivo: "# " convierte en título mientras la otra persona escribe en el bloque', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { doc, a, b, close } = await twoPeople(browser, request, [{ id: 'p', type: 'paragraph', content: 'Agenda del lunes' }]);
  await typeWhile(b, async () => {
    await caretAtStart(a);
    await a.keyboard.type('# ', { delay: 40 });
  });
  const text = await converge(request, doc.id, a, b);
  everyKeystrokeOnce(text, ['Agenda', 'lunes']);
  everyKeystrokeOnce(text, ['Agenda', 'lunes']);
  expect(count(text, '#')).toBe(0);
  const blocks = await blocksOf(request, doc.id);
  expect(blocks.find((x) => x.id === 'p')?.type).toBe('heading');
  await close();
});
