/**
 * Send: dibuja páginas de un PDF en un hilo aparte (lo arranca lib/send/render.ts).
 * Un PDF pesado no tumba el proceso: el hilo tiene su tope de memoria, y quien lo
 * lanzó lo corta si una página tarda demasiado. pdf.js no cede mientras arma una
 * página, así que ese corte solo se puede hacer desde afuera.
 *
 * Mensajes: { type: 'unavailable' | 'open_error' | 'info' | 'start' | 'page' | 'too_complex' | 'done' }.
 */
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

const { data, from, root, pageWidth, maxHeight, maxOperators, quality } = workerData;
const post = (m, transfer) => parentPort.postMessage(m, transfer);

/**
 * Links de la página: a la web o a otra página del documento. La posición va en
 * fracciones de la imagen; la URL se revisa de nuevo antes de guardarla.
 */
async function pageLinks(doc, page, vp, width, height) {
  const out = [];
  let annots = [];
  try {
    annots = await page.getAnnotations({ intent: 'display' });
  } catch {
    return out;
  }
  for (const a of annots) {
    if (out.length >= 200) break;
    if (a.subtype !== 'Link' || !Array.isArray(a.rect)) continue;
    // Del sistema del PDF al de la imagen, con la matriz de la vista (sirve con la página rotada).
    const [ta, tb, tc, td, te, tf] = vp.transform;
    const pt = (x, y) => [ta * x + tc * y + te, tb * x + td * y + tf];
    const [x1, y1] = pt(a.rect[0], a.rect[1]);
    const [x2, y2] = pt(a.rect[2], a.rect[3]);
    const box = { x: Math.min(x1, x2) / width, y: Math.min(y1, y2) / height, w: Math.abs(x2 - x1) / width, h: Math.abs(y2 - y1) / height };
    const url = a.url || a.unsafeUrl;
    if (typeof url === 'string') {
      out.push({ ...box, url });
      continue;
    }
    if (!a.dest) continue;
    try {
      const dest = typeof a.dest === 'string' ? await doc.getDestination(a.dest) : a.dest;
      const ref = Array.isArray(dest) ? dest[0] : null;
      const index = typeof ref === 'number' ? ref : ref ? await doc.getPageIndex(ref) : null;
      if (typeof index === 'number') out.push({ ...box, page: index + 1 });
    } catch {
      // Un destino roto no es un link.
    }
  }
  return out;
}

async function main() {
  let canvas;
  let pdfjs;
  try {
    canvas = await import('@napi-rs/canvas');
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (err) {
    post({ type: 'unavailable', message: String(err?.message ?? err) });
    return;
  }
  const dir = path.join(root, 'node_modules/pdfjs-dist');
  const task = pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: `${dir}/standard_fonts/`,
    // PDFs con letras CJK sin incrustar, y escaneados en JPEG 2000 o JBIG2.
    cMapUrl: `${dir}/cmaps/`,
    cMapPacked: true,
    wasmUrl: `${dir}/wasm/`,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    post({ type: 'open_error', name: err?.name, message: String(err?.message ?? '') });
    return;
  }
  post({ type: 'info', numPages: doc.numPages });
  for (let n = from; n <= doc.numPages; n++) {
    post({ type: 'start', page: n });
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    let scale = pageWidth / base.width;
    if (base.height * scale > maxHeight) scale = maxHeight / base.height;
    const vp = page.getViewport({ scale });
    // Antes de dibujar: cuántas operaciones pide la página.
    const ops = await page.getOperatorList();
    if (ops.fnArray.length > maxOperators) {
      post({ type: 'too_complex', page: n });
      return;
    }
    const width = Math.max(1, Math.round(vp.width));
    const height = Math.max(1, Math.round(vp.height));
    const cv = canvas.createCanvas(width, height);
    const ctx = cv.getContext('2d');
    // Un PDF sin fondo es transparente: papel blanco.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    await page.render({ canvas: cv, canvasContext: ctx, viewport: vp }).promise;
    // Un link raro no le cuesta la página a nadie.
    const links = await pageLinks(doc, page, vp, width, height).catch(() => []);
    page.cleanup();
    const encoded = await cv.encode('webp', quality);
    const bytes = new Uint8Array(encoded);
    post({ type: 'page', page: n, width, height, bytes, links }, [bytes.buffer]);
  }
  post({ type: 'done' });
}

main().catch((err) => {
  // Lo que falla acá adentro (un PDF raro) lo decide quien lanzó el hilo.
  post({ type: 'crash', message: String(err?.message ?? err) });
});
