import { expect, test, type Page } from '@playwright/test';

/**
 * Board sin conexión: una pizarra ya abierta se abre sin red, lo que se dibuja
 * queda en el dispositivo (la banda lo cuenta), sobrevive a una recarga sin
 * red y al volver la red llega al servidor una sola vez.
 */

const SHOTS = process.env.E2E_SHOTS_DIR;
type El = { id: string; type: string; isDeleted?: boolean };
type BoardApi = {
  getSceneElements: () => El[];
  getSceneElementsIncludingDeleted: () => Array<Record<string, unknown>>;
  updateScene: (s: unknown) => void;
};

async function openAndCache(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload({ waitUntil: 'networkidle' });
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.reload({ waitUntil: 'networkidle' });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        for (const name of await caches.keys()) {
          if (!name.includes('-pages-')) continue;
          if (await (await caches.open(name)).match(location.origin + location.pathname, { ignoreSearch: true })) return true;
        }
        return false;
      }),
    )
    .toBe(true);
}

async function waitCanvas(page: Page) {
  await page.waitForFunction(() => Boolean((window as unknown as { __boardApi?: unknown }).__boardApi));
}

/** Un rectángulo nuevo, como si la persona lo dibujara. */
function addRect(page: Page, id: string) {
  return page.evaluate((rid) => {
    const api = (window as unknown as { __boardApi: BoardApi }).__boardApi;
    const rect = {
      id: rid, type: 'rectangle', x: 100, y: 100, width: 160, height: 90, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent',
      fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null,
      seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: Date.now(), link: null, locked: false, index: 'a0',
    };
    api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), rect] });
  }, id);
}

test.describe('Sin conexión: Board', () => {
  test.skip(!process.env.CI && !process.env.E2E_SW, 'El service worker solo se registra con el build de producción (CI=1) o NEXT_PUBLIC_SW_DEV=1 (E2E_SW=1).');
  test.setTimeout(180_000);

  test('dibujar sin red, recargar sin red y sincronizar una sola vez al volver', async ({ page, context }) => {
    const res = await page.request.post('/api/boards', { data: { name: `Sin red ${Date.now()}` } });
    expect(res.ok()).toBe(true);
    const id = ((await res.json()) as { id: string }).id;
    await openAndCache(page, `/en/app/board/${id}`);
    await waitCanvas(page);

    await context.setOffline(true);
    const rid = `offline-${Date.now().toString(36)}`;
    await addRect(page, rid);
    const status = page.getByTestId('offline-status');
    await expect(status).toContainText('Offline');
    // Lo dibujado ya está en el dispositivo (no solo al salir): la banda lo cuenta.
    await expect(status).toContainText('1 change on this device', { timeout: 20_000 });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/offline-board.png` });

    // Recargar sin red: la pizarra guardada, y lo dibujado se recupera.
    await page.reload();
    await waitCanvas(page);
    await page.getByRole('button', { name: 'Restore them' }).click();
    await expect.poll(() => page.evaluate((r) => (window as unknown as { __boardApi: BoardApi }).__boardApi.getSceneElements().some((e) => e.id === r), rid)).toBe(true);

    await context.setOffline(false);
    await expect
      .poll(
        async () => {
          const b = (await (await page.request.get(`/api/boards/${id}`)).json()) as { scene: { elements: El[] } };
          return b.scene.elements.filter((e) => e.id === rid && !e.isDeleted).length;
        },
        { timeout: 30_000 },
      )
      .toBe(1);
    // Sin cambios pendientes: la banda se va.
    await expect(status).toBeHidden({ timeout: 20_000 });
  });
});
