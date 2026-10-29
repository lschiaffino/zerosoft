import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

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
  await editable(b).click();
  await b.keyboard.press('Home');
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
  await editable(a).click();
  await a.keyboard.press('Home');
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
