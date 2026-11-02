/**
 * Send: de PDF a imágenes, y el watermark sobre la imagen. Server-only.
 *
 * El visor nunca recibe el PDF: recibe una imagen por página. pdf.js corre en el
 * servidor sin scripts ni fuentes del sistema, con @napi-rs/canvas de lienzo.
 * Las imágenes se guardan limpias y el watermark se dibuja en cada pedido, con el
 * email de la sesión, antes de que la imagen salga del servidor.
 */
import path from 'path';
import { SendError } from './types';

type Canvas = typeof import('@napi-rs/canvas');

let canvasMod: Canvas | null = null;
let fontsReady = false;

/** El lienzo con la familia de letra del watermark y de PowerPoint. */
export async function canvas(): Promise<Canvas> {
  canvasMod ??= await import('@napi-rs/canvas');
  if (!fontsReady) {
    fontsReady = true;
    const dir = path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts');
    for (const face of ['Regular', 'Bold', 'Italic', 'BoldItalic']) canvasMod.GlobalFonts.registerFromPath(path.join(dir, `LiberationSans-${face}.ttf`), 'SendSans');
  }
  return canvasMod;
}

/** Ancho de la imagen de una página: nítida en una pantalla retina de escritorio. */
export const PAGE_WIDTH = 1600;
const MAX_HEIGHT = 4000;
const WEBP_QUALITY = 84;

export interface RenderedPage {
  page: number;
  bytes: Buffer;
  width: number;
  height: number;
}

interface PdfHandle {
  numPages: number;
  renderPage(n: number): Promise<RenderedPage>;
  close(): Promise<void>;
}

/**
 * Carga el lienzo y pdf.js. Si falla (dependencia que no llegó al deploy) no es culpa
 * del archivo: quien llama deja la versión en cola, para reintentar.
 */
export async function loadRenderEngine(): Promise<void> {
  await canvas();
  await import(/* webpackIgnore: true */ 'pdfjs-dist/legacy/build/pdf.mjs');
}

/** Abre un PDF con pdf.js. Con contraseña o roto: error que la interfaz explica. */
export async function openPdf(bytes: Buffer): Promise<PdfHandle> {
  const c = await canvas();
  // Sin pasar por webpack: Notes y Sign usan pdf.js en el navegador y no puede ser externo para todos.
  const pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs') = await import(/* webpackIgnore: true */ 'pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: `${path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts')}/`,
    // PDFs con letras CJK sin incrustar, y escaneados en JPEG 2000 o JBIG2.
    cMapUrl: `${path.join(process.cwd(), 'node_modules/pdfjs-dist/cmaps')}/`,
    cMapPacked: true,
    wasmUrl: `${path.join(process.cwd(), 'node_modules/pdfjs-dist/wasm')}/`,
    verbosity: 0,
  });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy().catch(() => undefined);
    const e = err as { name?: string; message?: string };
    // Cifrado que no abre sin más: lo que hay que pedir es sacarle la contraseña.
    if (e?.name === 'PasswordException' || bytes.includes('/Encrypt')) throw new SendError('pdf_password', 422);
    // Un worker o una fuente que no cargó es del servidor, no del archivo.
    if (/worker|cannot find|module not found|ENOENT/i.test(e?.message ?? '')) throw new SendError('render_unavailable', 503);
    throw new SendError('pdf_invalid', 422);
  }
  return {
    numPages: doc.numPages,
    async renderPage(n) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      let scale = PAGE_WIDTH / base.width;
      if (base.height * scale > MAX_HEIGHT) scale = MAX_HEIGHT / base.height;
      const vp = page.getViewport({ scale });
      const width = Math.max(1, Math.round(vp.width));
      const height = Math.max(1, Math.round(vp.height));
      const cv = c.createCanvas(width, height);
      const ctx = cv.getContext('2d');
      // Un PDF sin fondo es transparente: papel blanco.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      await page.render({ canvas: cv as never, canvasContext: ctx as never, viewport: vp }).promise;
      page.cleanup();
      return { page: n, bytes: await cv.encode('webp', WEBP_QUALITY), width, height };
    },
    async close() {
      await task.destroy().catch(() => undefined);
    },
  };
}

/**
 * Texto repetido en diagonal sobre toda la imagen. Con relleno y borde para que
 * se lea en páginas claras y en diapositivas oscuras.
 */
export async function watermarkImage(bytes: Buffer, text: string): Promise<Buffer> {
  const c = await canvas();
  const img = await c.loadImage(bytes);
  const cv = c.createCanvas(img.width, img.height);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const size = Math.max(16, Math.round(img.width / 42));
  ctx.font = `${size}px SendSans`;
  const stepX = Math.max(ctx.measureText(text).width + size * 3, size * 12);
  const stepY = size * 7;
  const diagonal = Math.hypot(img.width, img.height);
  ctx.translate(img.width / 2, img.height / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.lineWidth = Math.max(1, size / 18);
  ctx.textBaseline = 'middle';
  let row = 0;
  for (let y = -diagonal / 2; y < diagonal / 2; y += stepY, row++) {
    const shift = row % 2 ? stepX / 2 : 0;
    for (let x = -diagonal / 2 - shift; x < diagonal / 2; x += stepX) {
      ctx.fillStyle = 'rgba(40,40,40,0.2)';
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    }
  }
  return cv.encode('webp', WEBP_QUALITY);
}

/** Miniatura o imagen más chica para el panel del dueño. */
export async function resizeImage(bytes: Buffer, width: number): Promise<Buffer> {
  const c = await canvas();
  const img = await c.loadImage(bytes);
  const w = Math.min(width, img.width);
  const h = Math.max(1, Math.round((img.height * w) / img.width));
  const cv = c.createCanvas(w, h);
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  return cv.encode('webp', 80);
}

/** Una imagen como JPEG, para armar un PDF con pdf-lib (no lee WebP). */
export async function imageToJpeg(bytes: Buffer): Promise<Buffer> {
  const c = await canvas();
  const img = await c.loadImage(bytes);
  const cv = c.createCanvas(img.width, img.height);
  cv.getContext('2d').drawImage(img, 0, 0);
  return cv.encode('jpeg', 88);
}
