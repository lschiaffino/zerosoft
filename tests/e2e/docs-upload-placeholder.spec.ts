import { deflateSync } from 'node:zlib';
import { expect, test, type APIRequestContext, type Locator, type Page, type Route } from '@playwright/test';

/**
 * Subidas en Docs y Notes: mientras sube, un esqueleto ocupa el lugar y el
 * tamaño del bloque; al terminar lo reemplaza el bloque real sin saltos; si
 * falla, queda un aviso con Reintentar y Quitar. Nada se dibuja fuera de la
 * columna de la página.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

/** PNG gris liso de w×h (válido), para medir el lugar que se reserva. */
function png(w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0xcc)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const IMAGE = { name: 'paisaje.png', mimeType: 'image/png', buffer: png(640, 360) };
const VIDEO = { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fake video bytes') };
const FILE = { name: 'informe.zip', mimeType: 'application/zip', buffer: Buffer.from('PK fake zip') };

type Block = { id: string; type: string; content: string };

async function docWith(request: APIRequestContext, content: Block[]) {
  const doc = (await (await request.post('/api/docs/pages', { data: { title: `Subidas ${uid()}` } })).json()) as { id: string };
  await request.patch(`/api/docs/pages/${doc.id}`, { data: { content } });
  return doc;
}

/** Retiene las subidas (POST multipart) hasta que se llame a release. */
async function holdUploads(page: Page, pattern: string) {
  const held: Route[] = [];
  let open = false;
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    if (open) return route.continue();
    held.push(route);
  });
  return {
    count: () => held.length,
    release: async () => {
      open = true;
      for (const r of held.splice(0)) await r.continue();
    },
  };
}

async function slash(p: Page, query: string) {
  await p.keyboard.type(`/${query}`);
  await expect(p.locator('.docs-command-menu')).toBeVisible();
  await p.keyboard.press('Enter');
}

/** Nada de la subida queda fuera de la columna de bloques. */
async function insideColumn(scope: Locator, el: Locator) {
  const col = (await scope.locator('.docs-blocks').boundingBox())!;
  const box = (await el.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(col.x - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(col.x + col.width + 1);
  expect(box.y).toBeGreaterThanOrEqual(col.y - 1);
  expect(box.y + box.height).toBeLessThanOrEqual(col.y + col.height + 1);
}

async function uploadFlow(p: Page, scope: Locator, uploadPattern: string) {
  // 1. Imagen con "/image" en una línea vacía: el esqueleto va en ese lugar con la forma de la imagen y la línea queda debajo.
  const hold = await holdUploads(p, uploadPattern);
  await scope.locator('.docs-blocks .docs-editable').last().click();
  const chooser = p.waitForEvent('filechooser');
  await slash(p, 'image');
  await (await chooser).setFiles(IMAGE);
  const ph = scope.getByTestId('docs-upload-placeholder');
  await expect(ph).toHaveCount(1);
  await expect(ph).toHaveAttribute('data-kind', 'image');
  await expect(ph.getByRole('progressbar')).toBeVisible();
  await expect(ph.getByRole('button', { name: /Cancel upload of paisaje\.png/ })).toBeVisible();
  // La forma real del archivo (640×360) apenas se lee.
  const box = ph.locator('.docs-upload-box');
  // (16:9; en una columna más angosta que la imagen se achica con ella).
  await expect
    .poll(async () => {
      const b = await box.boundingBox();
      return b ? Math.round((b.width / b.height) * 100) : 0;
    })
    .toBe(178);
  expect((await box.boundingBox())!.width).toBeLessThanOrEqual(640);
  await insideColumn(scope, ph);
  // El texto de "Subiendo" ya no aparece abajo, pegado al borde.
  await expect(scope.locator('.docs-upload-status')).toHaveCount(0);
  const before = (await box.boundingBox())!;
  await expect.poll(() => hold.count()).toBe(1);
  await hold.release();
  const img = scope.getByTestId('docs-image-block').locator('img');
  await expect(img).toBeVisible();
  await expect(ph).toHaveCount(0);
  const after = (await img.boundingBox())!;
  // En el mismo lugar y del mismo tamaño: sin salto.
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(2);
  await p.unroute(uploadPattern);

  // 2. Video y archivo a la vez desde el botón de subir: cada uno con su esqueleto, en orden.
  const hold2 = await holdUploads(p, uploadPattern);
  const chooser2 = p.waitForEvent('filechooser');
  await slash(p, 'video');
  await (await chooser2).setFiles([VIDEO, FILE]);
  await expect(ph).toHaveCount(2);
  await expect(ph.nth(0)).toHaveAttribute('data-kind', 'video');
  await expect(ph.nth(1)).toHaveAttribute('data-kind', 'file');
  await expect(ph.nth(1)).toHaveAttribute('data-status', 'queued');
  await insideColumn(scope, ph.nth(0));
  await insideColumn(scope, ph.nth(1));
  await expect.poll(() => hold2.count()).toBe(1);
  await hold2.release();
  await expect(scope.getByTestId('docs-video-block')).toBeVisible();
  await expect(scope.getByTestId('docs-file-block')).toBeVisible();
  await expect(ph).toHaveCount(0);
  await p.unroute(uploadPattern);
}

async function failFlow(p: Page, scope: Locator, uploadPattern: string) {
  // La red falla: el esqueleto pasa a un aviso con Reintentar y Quitar en el mismo lugar.
  let fail = true;
  await p.route(uploadPattern, async (route) => {
    if (route.request().method() !== 'POST' || !fail) return route.continue();
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"failed"}' });
  });
  await scope.locator('.docs-blocks .docs-editable').last().click();
  const chooser = p.waitForEvent('filechooser');
  await slash(p, 'image');
  await (await chooser).setFiles(IMAGE);
  const ph = scope.getByTestId('docs-upload-placeholder');
  await expect(ph).toHaveAttribute('data-status', 'error');
  await expect(ph).toHaveAttribute('role', 'alert');
  await expect(ph).toContainText('paisaje.png');
  await insideColumn(scope, ph);
  fail = false;
  await ph.getByRole('button', { name: 'Retry' }).click();
  await expect(scope.getByTestId('docs-image-block').last().locator('img')).toBeVisible();
  await expect(ph).toHaveCount(0);

  // Otra que falla y se quita.
  fail = true;
  await scope.locator('.docs-blocks .docs-editable').last().click();
  const chooser2 = p.waitForEvent('filechooser');
  await slash(p, 'image');
  await (await chooser2).setFiles(IMAGE);
  await expect(ph).toHaveAttribute('data-status', 'error');
  await ph.getByRole('button', { name: 'Remove paisaje.png' }).click();
  await expect(ph).toHaveCount(0);
  await p.unroute(uploadPattern);
}

test('Docs: video, imagen y archivo suben con un esqueleto en su lugar que el bloque reemplaza sin saltar', async ({ request, page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const doc = await docWith(request, [{ id: 'a', type: 'paragraph', content: 'Arriba' }, { id: 'b', type: 'paragraph', content: '' }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await uploadFlow(page, page.locator('.docs-editor'), '**/api/docs/pages/*/files');
  await expect
    .poll(async () => ((await (await request.get(`/api/docs/pages/${doc.id}`)).json()) as { content: Block[] }).content.map((b) => b.type))
    .toEqual(['paragraph', 'image', 'video', 'file', 'paragraph']);
});

test('Docs: una subida que falla queda con Reintentar y Quitar', async ({ request, page }) => {
  const doc = await docWith(request, [{ id: 'a', type: 'paragraph', content: '' }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await failFlow(page, page.locator('.docs-editor'), '**/api/docs/pages/*/files');
});

test('Docs: cancelar una subida saca el esqueleto y no crea el bloque', async ({ request, page }) => {
  const doc = await docWith(request, [{ id: 'a', type: 'paragraph', content: 'Texto' }, { id: 'b', type: 'paragraph', content: '' }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const hold = await holdUploads(page, '**/api/docs/pages/*/files');
  await page.locator('.docs-blocks .docs-editable').last().click();
  const chooser = page.waitForEvent('filechooser');
  await slash(page, 'image');
  await (await chooser).setFiles(IMAGE);
  const ph = page.getByTestId('docs-upload-placeholder');
  await expect.poll(() => hold.count()).toBe(1);
  await ph.getByRole('button', { name: 'Cancel upload of paisaje.png' }).click();
  await expect(ph).toHaveCount(0);
  // La línea vacía sigue ahí y no se creó ningún bloque de imagen.
  await expect(page.getByTestId('docs-image-block')).toHaveCount(0);
  await expect(page.locator('.docs-blocks .docs-editable')).toHaveCount(2);
});

test('Docs: pegar y soltar un archivo también muestran el esqueleto en su lugar', async ({ request, page }) => {
  const doc = await docWith(request, [{ id: 'a', type: 'paragraph', content: 'Uno' }, { id: 'b', type: 'paragraph', content: 'Dos' }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const hold = await holdUploads(page, '**/api/docs/pages/*/files');
  // Soltar sobre "Dos": va entre "Uno" y "Dos".
  const target = page.locator('.docs-blocks .docs-editable', { hasText: 'Dos' });
  const dt = await page.evaluateHandle((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const d = new DataTransfer();
    d.items.add(new File([bytes], 'paisaje.png', { type: 'image/png' }));
    return d;
  }, IMAGE.buffer.toString('base64'));
  const t = (await target.boundingBox())!;
  const at = { dataTransfer: dt, clientX: Math.round(t.x + 20), clientY: Math.round(t.y + 3) };
  await target.dispatchEvent('dragover', at);
  await target.dispatchEvent('drop', at);
  const ph = page.getByTestId('docs-upload-placeholder');
  await expect(ph).toHaveCount(1);
  const phBox = (await ph.boundingBox())!;
  const unoBox = (await page.locator('.docs-blocks .docs-editable', { hasText: 'Uno' }).boundingBox())!;
  const dosBox = (await target.boundingBox())!;
  expect(phBox.y).toBeGreaterThan(unoBox.y);
  expect(phBox.y).toBeLessThan(dosBox.y);
  await expect.poll(() => hold.count()).toBe(1);
  await hold.release();
  await expect(page.getByTestId('docs-image-block')).toBeVisible();
  await expect(ph).toHaveCount(0);

  // Pegar una captura en una línea vacía al final.
  const hold2 = await holdUploads(page, '**/api/docs/pages/*/files');
  await target.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const d = new DataTransfer();
    d.items.add(new File([bytes], 'captura.png', { type: 'image/png' }));
    document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true, cancelable: true }));
  }, IMAGE.buffer.toString('base64'));
  await expect(ph).toHaveCount(1);
  await expect(ph).toHaveAttribute('aria-label', /captura\.png/);
  await expect.poll(() => hold2.count()).toBe(1);
  await hold2.release();
  await expect(page.getByTestId('docs-image-block')).toHaveCount(2);
});

test('Notes: video e imagen suben con esqueleto, y una falla muestra Reintentar', async ({ request, page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const note = (await (
    await request.post('/api/notes', { data: { title: `Nota subidas ${uid()}`, content: [{ id: 'n1', type: 'paragraph', content: '' }] } })
  ).json()) as { id: string };
  await page.goto(`/en/app/notes?note=${note.id}`, { waitUntil: 'networkidle' });
  const scope = page.locator('.note-body');
  await uploadFlow(page, scope, '**/api/notes/*/files');
  await failFlow(page, scope, '**/api/notes/*/files');
});
