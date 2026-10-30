import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Docs en vivo, segunda parte: deshacer con texto ajeno en el medio (solo se
 * deshace lo propio) y cambios de estructura (partir con Enter, unir con
 * Backspace, "# ") mientras la otra persona sigue escribiendo en ese bloque:
 * ninguna tecla se pierde ni se escribe dos veces y las dos pantallas
 * terminan iguales que el servidor.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

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
  expect(blocks[0].content.startsWith('alpha beta')).toBeTruthy();
  // El espacio del principio del bloque nuevo queda (el parser no lo tira).
  expect(blocks[1].content.startsWith(' gamma delta')).toBeTruthy();
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
  expect(count(text, '#')).toBe(0);
  const blocks = await blocksOf(request, doc.id);
  expect(blocks.find((x) => x.id === 'p')?.type).toBe('heading');
  await close();
});
