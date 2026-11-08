import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Modo sin conexión de la suite con Track: se abre un issue, se corta la red,
 * se edita el título y se comenta, se recarga sin red (se ve lo editado), y al
 * volver la red todo llega al servidor una sola vez. También: el aviso de
 * "editado en otro lado", un cambio rechazado que se descarta desde la banda
 * y la clave de idempotencia de las altas.
 */

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z]/g, 'Q');
const SHOTS = process.env.E2E_SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

type Project = { id: string; name: string };
type Issue = { id: string; identifier: string; title: string; priority: string };

/** Abre la URL hasta que el service worker la controla y la guardó para leerla sin red. */
async function openAndCache(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload({ waitUntil: 'networkidle' });
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // Una navegación con el worker al mando la guarda (network-first).
  await page.reload({ waitUntil: 'networkidle' });
  await expect
    .poll(() =>
      // La página de un issue pasa a su URL canónica (/issue/<ref>/<slug>): esa es la que se guarda y se recarga.
      page.evaluate(async () => {
        for (const name of await caches.keys()) {
          if (!name.includes('-pages-')) continue;
          const c = await caches.open(name);
          if (await c.match(location.origin + location.pathname, { ignoreSearch: true })) return true;
        }
        return false;
      }),
    )
    .toBe(true);
}

test.describe('Sin conexión: Track', () => {
  test.skip(!process.env.CI, 'El service worker solo se registra con el build de producción (CI=1).');

  test('editar y comentar sin red, recargar sin red y sincronizar al volver', async ({ page, context, request }) => {
    const p = await ok<Project>(request.post('/api/track/projects', { data: { name: `Offline ${uid()}` } }));
    const issue = await ok<Issue>(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Antes de cortar la red' } }));
    const url = `/en/app/track/issues/${issue.id}`;
    await openAndCache(page, url);

    await context.setOffline(true);
    const title = page.getByTestId('track-issue-title');
    await title.fill(`Editado sin red ${issue.identifier}`);
    await title.press('Enter');
    const status = page.getByTestId('offline-status');
    await expect(status).toContainText('Offline');
    await expect(status).toContainText('1 change on this device');

    const comment = `Comentario sin señal ${uid()}`;
    await page.getByTestId('track-comment-input').click();
    await page.keyboard.type(comment);
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(page.getByTestId('track-queued-comments')).toContainText(comment);
    await expect(status).toContainText('2 changes on this device');

    // Mientras tanto, otra persona cambia el mismo issue en el servidor.
    const other = await request.patch(`/api/track/issues/${issue.id}`, { data: { priority: 'high' } });
    expect(other.ok()).toBe(true);

    // Recargar sin red: la copia guardada, con lo editado encima.
    await page.reload();
    await expect(page.getByTestId('track-issue-title')).toHaveValue(`Editado sin red ${issue.identifier}`);
    await expect(page.getByTestId('track-queued-comments')).toContainText(comment);
    await status.click();
    await expect(page.getByTestId('offline-panel')).toContainText('Saved on this device');
    await shot(page, 'offline-track-panel');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('offline-panel')).toBeHidden();

    await context.setOffline(false);
    await expect
      .poll(async () => ((await (await request.get(`/api/track/issues/${issue.id}`)).json()) as Issue).title, { timeout: 30_000 })
      .toBe(`Editado sin red ${issue.identifier}`);
    const after = (await (await request.get(`/api/track/issues/${issue.id}`)).json()) as Issue;
    // Gana lo último que llega, campo por campo: la prioridad de la otra persona queda.
    expect(after.priority).toBe('high');
    await expect
      .poll(async () => {
        const res = await request.get(`/api/track/issues/${issue.id}/activities`);
        const text = JSON.stringify(await res.json());
        return text.split(comment).length - 1;
      })
      .toBe(1);
    // El título se guardó sobre una versión más nueva: la banda lo avisa.
    await expect(status).toContainText('Edited elsewhere');
    await status.click();
    await expect(page.getByTestId('offline-panel')).toContainText('Someone saved another version');
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(status).toBeHidden({ timeout: 10_000 });
  });

  test('un cambio que el servidor rechaza queda para reintentar o descartar', async ({ page, context, request }) => {
    const p = await ok<Project>(request.post('/api/track/projects', { data: { name: `Rechazo ${uid()}` } }));
    const issue = await ok<Issue>(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Se borra mientras tanto' } }));
    await openAndCache(page, `/en/app/track/issues/${issue.id}`);

    await context.setOffline(true);
    const title = page.getByTestId('track-issue-title');
    await title.fill('Nunca llega');
    await title.press('Enter');
    await expect(page.getByTestId('offline-status')).toContainText('1 change on this device');
    // Otra persona borra el issue: al volver la red el cambio da 404.
    expect((await request.delete(`/api/track/issues/${issue.id}`)).ok()).toBe(true);

    await context.setOffline(false);
    const status = page.getByTestId('offline-status');
    await expect(status).toContainText('1 change was not saved', { timeout: 30_000 });
    await status.click();
    const panel = page.getByTestId('offline-panel');
    await expect(panel).toContainText('Could not be saved');
    await expect(panel).toContainText('no longer exists');
    await shot(page, 'offline-track-failed');
    await panel.getByRole('button', { name: 'Discard' }).click();
    await expect(status).toBeHidden({ timeout: 10_000 });
  });
});

test.describe('Sin conexión: altas que llegan dos veces', () => {
  test('una alta reenviada con la misma clave no se crea dos veces', async ({ request }) => {
    const p = await ok<Project>(request.post('/api/track/projects', { data: { name: `Clave ${uid()}` } }));
    const key = `e2e-${uid()}-${Date.now()}`;
    const headers = { 'x-zs-idempotency-key': key };
    const first = await ok<Issue>(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Una sola vez' }, headers }));
    const again = await request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Una sola vez' }, headers });
    expect(again.status()).toBe(201);
    expect(again.headers()['x-zs-replayed']).toBe('1');
    expect(((await again.json()) as Issue).id).toBe(first.id);
    const list = (await (await request.get(`/api/track/projects/${p.id}/issues?q=${encodeURIComponent('Una sola vez')}`)).json()) as { rows?: Issue[]; issues?: Issue[] };
    const rows = list.rows ?? list.issues ?? [];
    expect(rows.filter((i) => i.title === 'Una sola vez')).toHaveLength(1);
  });
});
