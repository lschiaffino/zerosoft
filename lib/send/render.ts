/**
 * Send: de PDF a imágenes, y el watermark sobre la imagen. Server-only.
 *
 * El visor nunca recibe el PDF: recibe una imagen por página. pdf.js corre en el
 * servidor sin scripts ni fuentes del sistema, con @napi-rs/canvas de lienzo.
 * Las imágenes se guardan limpias y el watermark se dibuja en cada pedido, con el
 * email de la sesión, antes de que la imagen salga del servidor.
 */
import path from 'path';
import { Worker } from 'worker_threads';
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
/** Por página: tiempo, operaciones de dibujo y memoria del hilo. */
const PAGE_LIMIT_MS = 15_000;
const MAX_PAGE_OPERATORS = 1_500_000;
const WORKER_HEAP_MB = 1024;

export interface RenderedPage {
  page: number;
  bytes: Buffer;
  width: number;
  height: number;
}

/** Carga el lienzo. Si falla (una dependencia que no llegó al deploy) no es culpa del archivo. */
export async function loadRenderEngine(): Promise<void> {
  await canvas();
}

/**
 * Dibuja páginas en un hilo aparte: con tope de memoria y de tiempo por página, sin
 * frenar a nadie más. Si se pasa, el hilo se corta y sale render_stalled: la versión lo
 * reintenta y, a los 4 intentos sin avance, falla con un motivo.
 */
export async function renderPdfPages(
  bytes: Buffer,
  o: { from: number; deadline: number; onInfo: (numPages: number) => Promise<void>; onPage: (page: RenderedPage) => Promise<void> },
): Promise<void> {
  const data = new Uint8Array(bytes);
  const worker = new Worker(path.join(process.cwd(), 'lib/send/render-worker.mjs'), {
    workerData: { data, from: o.from, root: process.cwd(), pageWidth: PAGE_WIDTH, maxHeight: MAX_HEIGHT, maxOperators: MAX_PAGE_OPERATORS, quality: WEBP_QUALITY },
    resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
  });
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let queue: Promise<void> = Promise.resolve();
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      void worker.terminate();
      if (err) reject(err);
      else resolve();
    };
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish(new SendError('render_stalled', 503)), PAGE_LIMIT_MS);
    };
    const inOrder = (fn: () => Promise<void>) => {
      queue = queue.then(fn).catch((err) => finish(err as Error));
    };
    arm();
    worker.on('message', (m: { type: string; [k: string]: unknown }) => {
      if (m.type === 'start') arm();
      else if (m.type === 'unavailable') finish(new SendError('render_unavailable', 503, { message: String(m.message ?? '') }));
      else if (m.type === 'too_complex') inOrder(async () => finish(new SendError('page_too_complex', 422)));
      else if (m.type === 'crash') inOrder(async () => finish(new SendError('render_stalled', 503)));
      else if (m.type === 'open_error') {
        const message = String(m.message ?? '');
        // Cifrado que no abre sin más: lo que hay que pedir es sacarle la contraseña.
        if (m.name === 'PasswordException' || bytes.includes('/Encrypt')) finish(new SendError('pdf_password', 422));
        // Un worker o una fuente que no cargó es del servidor, no del archivo.
        else if (/worker|cannot find|module not found|ENOENT/i.test(message)) finish(new SendError('render_unavailable', 503, { message }));
        else finish(new SendError('pdf_invalid', 422));
      } else if (m.type === 'info') inOrder(() => o.onInfo(Number(m.numPages)));
      else if (m.type === 'page')
        inOrder(async () => {
          await o.onPage({ page: Number(m.page), bytes: Buffer.from(m.bytes as Uint8Array), width: Number(m.width), height: Number(m.height) });
          // Se acabó el turno: el resto sigue en el pedido siguiente.
          if (Date.now() >= o.deadline) finish();
        });
      else if (m.type === 'done') inOrder(async () => finish());
    });
    worker.on('error', (err: Error & { code?: string }) => {
      // Sin memoria: es la página. Sin el archivo o sin un módulo: es el servidor.
      if (err.code === 'ERR_WORKER_OUT_OF_MEMORY') finish(new SendError('render_stalled', 503));
      else if (/cannot find|module not found|ENOENT/i.test(err.message) || err.code === 'ERR_MODULE_NOT_FOUND') finish(new SendError('render_unavailable', 503, { message: err.message }));
      else finish(new SendError('render_stalled', 503));
    });
    worker.on('exit', () => inOrder(async () => finish(new SendError('render_stalled', 503))));
  });
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
