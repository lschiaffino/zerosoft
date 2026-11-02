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
    page.cleanup();
    const encoded = await cv.encode('webp', quality);
    const bytes = new Uint8Array(encoded);
    post({ type: 'page', page: n, width, height, bytes }, [bytes.buffer]);
  }
  post({ type: 'done' });
}

main().catch((err) => {
  // Lo que falla acá adentro (un PDF raro) lo decide quien lanzó el hilo.
  post({ type: 'crash', message: String(err?.message ?? err) });
});
