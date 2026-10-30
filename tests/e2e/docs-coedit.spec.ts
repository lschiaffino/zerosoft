import { createClient } from '@libsql/client';
import { expect, request as pwRequest, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { textHash } from '../../lib/docs-ot';

/**
 * Docs: edición simultánea tecla por tecla (como Notion). Dos personas
 * distintas (el usuario demo y una invitada con su propia sesión, cookie
 * zs_e2e_as) escriben en la misma página y en el mismo bloque, a la vez y en
 * el mismo punto: no se pierde ninguna tecla, las dos pantallas convergen y
 * cada una ve el cursor de la otra con su nombre. Sin red, lo escrito se
 * fusiona al volver. A quien solo lee y le sacan el acceso se le corta la
 * página en el acto.
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

type Block = { id: string; type: string; content: string };

async function pageWith(request: APIRequestContext, title: string, content: Block[]) {
  const doc = (await (await request.post('/api/docs/pages', { data: { title } })).json()) as { id: string };
  const res = await request.patch(`/api/docs/pages/${doc.id}`, { data: { content } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return doc;
}

async function textOf(request: APIRequestContext, id: string, block = 'p'): Promise<string | undefined> {
  const page = (await (await request.get(`/api/docs/pages/${id}`)).json()) as { content: Block[] };
  const raw = page.content.find((b) => b.id === block)?.content;
  return raw?.replace(/&nbsp;|\u00a0/g, ' ');
}

/** Otra persona: su propia sesión (el server la reconoce por la cookie de e2e). */
async function sessionAs(browser: Browser, email: string): Promise<BrowserContext> {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  return ctx;
}

/** Comparte la página con esa persona (la cuenta se crea con su primera visita). */
async function shareWith(request: APIRequestContext, ctx: BrowserContext, pageId: string, email: string, role: 'edit' | 'view') {
  const visit = await ctx.newPage();
  await visit.goto('/en/app/docs', { waitUntil: 'domcontentloaded' });
  await visit.close();
  // Sin el onboarding de la primera vez (no es lo que se prueba acá).
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    await db.execute({ sql: "UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", args: [email] });
  } finally {
    db.close();
  }
  const res = await request.post(`/api/docs/pages/${pageId}/share`, { data: { kind: 'user', email, role } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string };
}

const editable = (p: Page, id = 'p') => p.locator(`[data-block-anchor="${id}"] .docs-editable`);

/** Espera a que el stream en vivo de la página esté conectado. */
async function openLive(p: Page, pageId: string) {
  const ready = p.waitForRequest((r) => r.url().includes(`/api/docs/collab?page=${pageId}`) && r.method() === 'GET', { timeout: 30_000 });
  await p.goto(`/en/app/docs/${pageId}`, { waitUntil: 'domcontentloaded' });
  await ready;
  // El stream ya mandó `ready` (lo de antes de engancharse se recupera por la huella).
  await p.waitForTimeout(500);
  await expect(editable(p).or(p.locator('.docs-readonly-body')).first()).toBeVisible();
}

/**
 * Caret al principio con un clic en el borde izquierdo (como lo haría una persona):
 * Inicio después de un clic a la derecha del texto no mueve el caret en Chromium headless.
 */
async function caretAtStart(p: Page, id = 'p') {
  await editable(p, id).click({ position: { x: 1, y: 6 } });
}

async function caretAtEnd(p: Page, id = 'p') {
  await editable(p, id).click();
  await p.keyboard.press('End');
}

test('Docs en vivo: dos personas en el mismo bloque y en el mismo punto, sin perder teclas, con cursores', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const doc = await pageWith(request, `Vivo ${uid()}`, [{ id: 'p', type: 'paragraph', content: 'Plan:' }]);
  const email = `ana-${uid()}@darwin-e2e.io`;
  const ctxA = await browser.newContext();
  const ctxB = await sessionAs(browser, email);
  await shareWith(request, ctxB, doc.id, email, 'edit');
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const conflicts: number[] = [];
  for (const p of [a, b]) {
    p.on('response', (r) => {
      if (r.url().includes('/api/docs/') && r.status() === 409) conflicts.push(409);
    });
  }
  await openLive(a, doc.id);
  await openLive(b, doc.id);

  // Las dos al final del mismo párrafo, tipeando a la vez.
  await caretAtEnd(a);
  await caretAtEnd(b);
  await Promise.all([a.keyboard.type(' uno dos tres', { delay: 35 }), b.keyboard.type(' alfa beta gama', { delay: 35 })]);

  // El servidor tiene cada tecla una sola vez (las palabras no se mezclan: cada tanda entra entera o intercalada, pero completa).
  const letters = (t: string) => [...t.replace(/\s/g, '')].sort().join('');
  const want = letters('Plan:unodostresalfabetagama');
  let seen = '';
  for (let i = 0; i < 40 && letters(seen) !== want; i++) {
    seen = (await textOf(request, doc.id)) ?? '';
    if (letters(seen) !== want) await a.waitForTimeout(500);
  }
  expect(letters(seen), `texto en el servidor: ${seen}`).toBe(want);
  const final = (await textOf(request, doc.id))!;
  // Las dos pantallas convergen al mismo texto sin recargar.
  await expect(editable(a)).toHaveText(final, { timeout: 15_000 });
  await expect(editable(b)).toHaveText(final, { timeout: 15_000 });

  // Cursores: A ve el de Ana con su nombre y Ana ve el de A.
  await caretAtStart(b);
  await expect(a.getByTestId('docs-peer-caret').filter({ hasText: email.split('@')[0] })).toBeVisible({ timeout: 10_000 });
  await editable(a).click();
  await expect(b.getByTestId('docs-peer-caret')).toBeVisible({ timeout: 10_000 });

  // Una tecla de Ana aparece en la pantalla de A enseguida (no al próximo pulso).
  await b.keyboard.type('¡');
  await expect(editable(a)).toHaveText(`¡${final}`, { timeout: 4_000 });

  // Deshacer en A solo deshace lo de A.
  await caretAtEnd(a);
  await a.keyboard.type(' fin', { delay: 20 });
  await expect.poll(() => textOf(request, doc.id), { timeout: 10_000 }).toBe(`¡${final} fin`);
  await a.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => textOf(request, doc.id), { timeout: 10_000 }).toBe(`¡${final}`);
  await expect(editable(b)).toHaveText(`¡${final}`, { timeout: 10_000 });

  expect(conflicts).toEqual([]);
  await expect(a.locator('.docs-banner-bad')).toHaveCount(0);
  await expect(b.locator('.docs-banner-bad')).toHaveCount(0);
  await ctxA.close();
  await ctxB.close();
});

test('Docs en vivo: sin red se sigue escribiendo y al volver se fusiona con lo de la otra persona', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const doc = await pageWith(request, `Offline ${uid()}`, [{ id: 'p', type: 'paragraph', content: 'centro' }]);
  const email = `leo-${uid()}@darwin-e2e.io`;
  const ctxA = await browser.newContext();
  const ctxB = await sessionAs(browser, email);
  await shareWith(request, ctxB, doc.id, email, 'edit');
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await openLive(a, doc.id);
  await openLive(b, doc.id);

  // B se queda sin red y escribe al final del mismo párrafo.
  await ctxB.setOffline(true);
  await caretAtEnd(b);
  await b.keyboard.type(' derecha', { delay: 25 });
  await expect(b.getByTestId('docs-offline-banner')).toBeVisible({ timeout: 10_000 });
  // Mientras, A escribe en el mismo párrafo (al principio y al final).
  await caretAtStart(a);
  await a.keyboard.type('izquierda ', { delay: 25 });
  await a.keyboard.press('End');
  await a.keyboard.type(' (A)', { delay: 25 });
  await expect.poll(() => textOf(request, doc.id), { timeout: 15_000 }).toBe('izquierda centro (A)');

  // Vuelve la red: queda todo, sin conflicto ni duplicados.
  await ctxB.setOffline(false);
  await b.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(() => textOf(request, doc.id), { timeout: 30_000 })
    .toMatch(/^izquierda centro( \(A\) derecha| derecha \(A\))$/);
  const final = (await textOf(request, doc.id))!;
  await expect(editable(a)).toHaveText(final, { timeout: 20_000 });
  await expect(editable(b)).toHaveText(final, { timeout: 20_000 });
  await ctxA.close();
  await ctxB.close();
});

test('Docs en vivo: quien lee ve escribir en vivo y, al sacarle el acceso, se le corta la página', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const doc = await pageWith(request, `Lectura ${uid()}`, [{ id: 'p', type: 'paragraph', content: 'Hola' }]);
  const email = `eva-${uid()}@darwin-e2e.io`;
  const ctxA = await browser.newContext();
  const ctxV = await sessionAs(browser, email);
  const share = await shareWith(request, ctxV, doc.id, email, 'view');
  const a = await ctxA.newPage();
  const v = await ctxV.newPage();
  await openLive(a, doc.id);
  await openLive(v, doc.id);
  const body = v.locator('.docs-readonly-body');
  await expect(body).toContainText('Hola');

  await caretAtEnd(a);
  await a.keyboard.type(' a todos', { delay: 30 });
  await expect(body).toContainText('Hola a todos', { timeout: 8_000 });

  // El dueño le saca el acceso: la página se le corta sin recargar.
  const del = await request.delete(`/api/docs/pages/${doc.id}/share/${share.id}`);
  expect(del.ok(), await del.text()).toBeTruthy();
  await expect(v.getByTestId('docs-access-revoked')).toBeVisible({ timeout: 10_000 });
  await expect(body).toHaveCount(0);
  // Y lo que se escribe después ya no le llega por ningún lado.
  const after = await ctxV.request.get(`/api/docs/collab?page=${doc.id}&poll=1&cursor=1`);
  expect(((await after.json()) as { events: Array<{ kind: string }> }).events[0]?.kind).toBe('revoked');
  await ctxA.close();
  await ctxV.close();
});

test('Docs en vivo: una operación con HTML peligroso no se guarda ni se pinta en otra pantalla', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const doc = await pageWith(request, `XSS ${uid()}`, [{ id: 'p', type: 'paragraph', content: 'ab' }]);
  const email = `xss-${uid()}@darwin-e2e.io`;
  const ctxV = await sessionAs(browser, email);
  await shareWith(request, ctxV, doc.id, email, 'view');
  const v = await ctxV.newPage();
  const dialogs: string[] = [];
  v.on('dialog', async (d) => {
    dialogs.push(d.message());
    await d.dismiss();
  });
  await openLive(v, doc.id);
  // Quien edita manda a mano (sin el editor) una operación con un <img onerror>.
  const res = await request.post('/api/docs/collab', {
    data: { page: doc.id, session: 'xsssession0001', items: [{ block: 'p', rev: 0, hash: textHash('ab'), op: [1, '<img src=x onerror=alert(1)>ok', 1], seq: 'x1' }] },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  expect(await res.text()).not.toMatch(/onerror|<img/i);
  await expect.poll(() => textOf(request, doc.id), { timeout: 10_000 }).toBe('aokb');
  await expect(v.locator('.docs-readonly-body')).toContainText('aokb', { timeout: 10_000 });
  await expect(v.locator('.docs-readonly-body img')).toHaveCount(0);
  expect(dialogs).toEqual([]);
  // Nada de eso quedó en el feed.
  const poll = await ctxV.request.get(`/api/docs/collab?page=${doc.id}&poll=1&cursor=1`);
  expect(await poll.text()).not.toMatch(/onerror|<img/i);
  await ctxV.close();
});

test('Docs en vivo: el título de un link a una página privada no sale por la foto de los bloques', async ({ browser, request }) => {
  const secret = (await (await request.post('/api/docs/pages', { data: { title: `Adquisicion ${uid()}` } })).json()) as { id: string; title: string };
  const link = `<a href="/app/docs/${secret.id}" data-page="${secret.id}">${secret.title}</a>`;
  const doc = await pageWith(request, `Links ${uid()}`, [
    { id: 'p', type: 'paragraph', content: `ver ${link}` },
    { id: 'q', type: 'paragraph', content: 'texto' },
  ]);
  const email = `lnk-${uid()}@darwin-e2e.io`;
  const ctxV = await sessionAs(browser, email);
  await shareWith(request, ctxV, doc.id, email, 'view');
  const snap = await ctxV.request.get(`/api/docs/collab?page=${doc.id}&blocks=p,q`);
  const body = await snap.text();
  expect(body).not.toContain(secret.title);
  expect((JSON.parse(body) as { blocks: Record<string, unknown> }).blocks.p).toBeNull();
  // En su pantalla tampoco: ve "Página privada".
  const v = await ctxV.newPage();
  await openLive(v, doc.id);
  await expect(v.locator('.docs-readonly-body')).not.toContainText(secret.title);
  await ctxV.close();
});

test('Docs en vivo: "sin red" con el stream vivo y recargar no duplica el texto de la otra persona', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const doc = await pageWith(request, `Sin red vivo ${uid()}`, [{ id: 'p', type: 'paragraph', content: 'base' }]);
  const email = `onl-${uid()}@darwin-e2e.io`;
  const ctxA = await browser.newContext();
  const ctxB = await sessionAs(browser, email);
  await shareWith(request, ctxB, doc.id, email, 'edit');
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await openLive(a, doc.id);
  await openLive(b, doc.id);
  // El navegador de B dice que no tiene red, pero la conexión sigue (le llega lo de A).
  await b.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await caretAtEnd(b);
  await b.keyboard.type(' bee', { delay: 30 });
  await caretAtStart(a);
  await a.keyboard.type('AAA ', { delay: 30 });
  await expect(editable(b)).toHaveText('AAA base bee', { timeout: 15_000 });
  await caretAtEnd(b);
  await b.keyboard.type(' dos', { delay: 30 });
  await b.waitForTimeout(1500);
  await b.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => textOf(request, doc.id), { timeout: 30_000 }).toBe('AAA base bee dos');
  await b.waitForTimeout(3000);
  expect(await textOf(request, doc.id)).toBe('AAA base bee dos');
  await expect(editable(b)).toHaveText('AAA base bee dos', { timeout: 15_000 });
  await expect(editable(a)).toHaveText('AAA base bee dos', { timeout: 15_000 });
  await ctxA.close();
  await ctxB.close();
});

test('Docs: con la edición simultánea apagada en Ajustes, dos personas editan y se fusiona al guardar', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const off = await request.patch('/api/docs/settings', { data: { coedit: false } });
  expect(off.ok(), await off.text()).toBeTruthy();
  try {
    const doc = await pageWith(request, `Apagada ${uid()}`, [{ id: 'p', type: 'paragraph', content: 'centro' }]);
    const email = `off-${uid()}@darwin-e2e.io`;
    const ctxA = await browser.newContext();
    const ctxB = await sessionAs(browser, email);
    await shareWith(request, ctxB, doc.id, email, 'edit');
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    const collab: string[] = [];
    for (const p of [a, b]) p.on('request', (r) => r.url().includes('/api/docs/collab') && collab.push(`${r.method()} ${r.url()}`));
    await a.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
    await b.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
    await caretAtStart(a);
    await a.keyboard.type('izq ', { delay: 30 });
    await expect.poll(() => textOf(request, doc.id), { timeout: 15_000 }).toBe('izq centro');
    await expect(editable(b)).toHaveText('izq centro', { timeout: 15_000 });
    await caretAtEnd(b);
    await b.keyboard.type(' der', { delay: 30 });
    await expect.poll(() => textOf(request, doc.id), { timeout: 15_000 }).toBe('izq centro der');
    await expect(editable(a)).toHaveText('izq centro der', { timeout: 15_000 });
    // Nada viajó por la edición simultánea (ni el stream ni operaciones).
    expect(collab).toEqual([]);
    // Y el servidor rechaza operaciones mientras está apagada.
    const ops = await request.post('/api/docs/collab', { data: { page: doc.id, session: 'offsession0001', items: [{ block: 'p', rev: null, hash: textHash('izq centro der'), op: [14, '!'], seq: 'o1' }] } });
    expect(ops.status()).toBe(409);
    await ctxA.close();
    await ctxB.close();
  } finally {
    await request.patch('/api/docs/settings', { data: { coedit: true } });
  }
});

test('Docs en vivo: sin red, recargar con el borrador lo fusiona y la pantalla sigue en vivo', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const doc = await pageWith(request, `Recarga ${uid()}`, [{ id: 'p', type: 'paragraph', content: 'alfa beta' }]);
  const email = `rec-${uid()}@darwin-e2e.io`;
  const ctxA = await browser.newContext();
  const ctxB = await sessionAs(browser, email);
  await shareWith(request, ctxB, doc.id, email, 'edit');
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await openLive(a, doc.id);
  await openLive(b, doc.id);
  await ctxB.setOffline(true);
  await b.evaluate(() => window.dispatchEvent(new Event('offline')));
  await caretAtEnd(b);
  await b.keyboard.type(' borrador', { delay: 30 });
  await expect(b.getByTestId('docs-offline-banner')).toBeVisible({ timeout: 10_000 });
  await caretAtStart(a);
  await a.keyboard.type('A ', { delay: 30 });
  await expect.poll(() => textOf(request, doc.id), { timeout: 15_000 }).toBe('A alfa beta');
  // Vuelve la red y recarga: el borrador entra, sin perder lo de A.
  await ctxB.setOffline(false);
  await b.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => textOf(request, doc.id), { timeout: 30_000 }).toBe('A alfa beta borrador');
  await expect(editable(b)).toHaveText('A alfa beta borrador', { timeout: 20_000 });
  await expect(b.locator('.docs-banner-bad')).toHaveCount(0);
  // Y sigue en vivo para las dos.
  await caretAtEnd(b);
  await b.keyboard.type(' B', { delay: 30 });
  await expect(editable(a)).toHaveText('A alfa beta borrador B', { timeout: 15_000 });
  await caretAtEnd(a);
  await a.keyboard.type(' fin', { delay: 30 });
  await expect(editable(b)).toHaveText('A alfa beta borrador B fin', { timeout: 15_000 });
  await ctxA.close();
  await ctxB.close();
});
