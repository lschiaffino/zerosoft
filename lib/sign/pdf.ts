/**
 * Sign: PDFs en el servidor con pdf-lib. Server-only.
 *
 * - sniffPdf: el archivo se reconoce por sus bytes, no por el nombre.
 * - sanitizePdf: carga el PDF (cifrado no), aplana el formulario, y saca todo
 *   lo que ejecuta o abre algo: JavaScript, acciones al abrir y por página o
 *   anotación (Launch, SubmitForm, ImportData, GoToR…), formularios y XFA,
 *   archivos adjuntos y anotaciones que no son links. Lo que se manda a firmar
 *   es esta versión limpia; su SHA-256 es el "original" del certificado.
 * - flattenFields: dibuja los valores y las firmas en las páginas.
 * - appendCertificate: suma el certificado de finalización al final.
 * - textToPdf: una carta en texto (ofertas de Hiring) como PDF A4.
 * - imageToPdf: una foto o un escaneo (JPEG o PNG) como una página A4.
 *
 * Las fuentes son las estándar (Helvetica, WinAnsi): lo que no entra sale como "?".
 */
import {
  degrees,
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFStream,
  PDFString,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';
import zlib from 'zlib';
import { ESIGN_LEGAL_NOTE, signatureBytes, utcStamp } from '../esign';
import { SignError, type FieldKind } from './types';

/** Tope del PDF subido (el cuerpo de una función de Vercel no pasa de 4,5 MB). */
export const MAX_PDF_BYTES = 4 * 1024 * 1024;
export const MAX_PDF_PAGES = 100;

export interface PageBox {
  /** Ancho y alto como se ve la página (con su rotación), en puntos. */
  w: number;
  h: number;
}

export function sniffPdf(buf: Buffer | Uint8Array): boolean {
  const b = Buffer.from(buf);
  if (b.length < 16) return false;
  const head = b.subarray(0, 1024).toString('latin1');
  const tail = b.subarray(Math.max(0, b.length - 2048)).toString('latin1');
  return head.includes('%PDF-') && tail.includes('%%EOF');
}

const DROP_KEYS = ['JS', 'JavaScript', 'AA', 'OpenAction', 'AcroForm', 'XFA', 'EmbeddedFiles', 'RichMediaContent', 'RichMediaSettings'];
/** Acciones que ejecutan, abren o mandan algo: quedan inertes. */
const DANGEROUS_ACTIONS = new Set(['JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'ResetForm', 'GoToR', 'GoToE', 'Rendition', 'Sound', 'Movie', 'RichMediaExecute', 'Hide', 'SetOCGState', 'Trans', 'GoTo3DView']);

// ---------- Topes antes de dejar que pdf-lib lea el archivo ----------

/** Objetos por archivo (un PDF de 100 páginas normal anda por los cientos o pocos miles). */
export const MAX_PDF_OBJECTS = 20_000;
/** Lo que puede crecer un stream comprimido al descomprimirse, y todos juntos. */
export const MAX_STREAM_INFLATED = 32 * 1024 * 1024;
export const MAX_TOTAL_INFLATED = 64 * 1024 * 1024;
/** Anidamiento de diccionarios y arrays por objeto. */
export const MAX_PDF_DEPTH = 64;

/** Filtros que no se aceptan en streams que pdf-lib descomprime (objetos, xref, contenido). */
const RISKY_FILTERS = /\/(LZWDecode|LZW|RunLengthDecode|RL|Crypt)\b/;

function tooLarge(err: unknown): boolean {
  return (err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE';
}

/** Bytes descomprimidos de un stream Flate, con tope; null si no es Flate legible. */
function inflateCapped(data: Buffer, cap: number): number | null {
  const opts = { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: cap };
  try {
    return zlib.inflateSync(data, opts).length;
  } catch (err) {
    if (tooLarge(err)) throw new SignError('pdf_too_complex', 413);
    try {
      return zlib.inflateRawSync(data, opts).length;
    } catch (err2) {
      if (tooLarge(err2)) throw new SignError('pdf_too_complex', 413);
      return null;
    }
  }
}

/**
 * Mira el archivo crudo antes de parsearlo: cuántos objetos tiene, cuán
 * anidados están y cuánto ocupa cada stream comprimido una vez descomprimido
 * (desde su comienzo hasta el final del archivo, así un /Length mentiroso no
 * esconde nada). Una bomba de descompresión, decenas de miles de objetos o un
 * anidamiento patológico se rechazan sin cargarlos.
 * Errores: pdf_too_complex, pdf_unsupported.
 */
export function guardPdf(input: Buffer, limits: { objects?: number; stream?: number; total?: number; render?: boolean } = {}): void {
  const text = input.toString('latin1');
  const maxStream = limits.stream ?? MAX_STREAM_INFLATED;
  const maxTotal = limits.total ?? MAX_TOTAL_INFLATED;
  // Cifrado (con o sin contraseña de apertura): no se puede limpiar ni dibujar encima.
  // `render`: el PDF solo se dibuja a imagen (Send), sin reescribirlo; lo cifrado o con filtros viejos abre igual.
  if (!limits.render && /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(text)) throw new SignError('pdf_encrypted', 415);
  const objCount = (text.match(/\d+\s+\d+\s+obj\b/g) ?? []).length;
  if (objCount > (limits.objects ?? MAX_PDF_OBJECTS)) throw new SignError('pdf_too_complex', 413);
  let total = 0;
  const streamRe = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = streamRe.exec(text))) {
    if (m.index > 0 && /[a-z]/i.test(text[m.index - 1] ?? '')) continue; // "endstream"
    const dictStart = Math.max(last, text.lastIndexOf('obj', m.index));
    const dict = text.slice(dictStart, m.index);
    last = m.index;
    if (!/\/Filter\b/.test(dict)) continue;
    const isImage = /\/Subtype\s*\/Image\b/.test(dict);
    if (!limits.render && !isImage && RISKY_FILTERS.test(dict)) throw new SignError('pdf_unsupported', 415);
    if (!/\/(FlateDecode|Fl)\b/.test(dict)) continue;
    // Flate detrás de otro filtro (ASCII85, ASCIIHex) no se puede medir acá: solo en imágenes, que pdf-lib no descomprime.
    const filters = /\/Filter\s*\[([^\]]*)\]/.exec(dict)?.[1];
    if (!limits.render && filters && !isImage && !/^\s*\/(FlateDecode|Fl)\b/.test(filters)) throw new SignError('pdf_unsupported', 415);
    if (isImage) continue;
    const start = m.index + m[0].length;
    const out = inflateCapped(input.subarray(start), Math.min(maxStream, maxTotal - total + 1));
    if (out === null) continue;
    total += out;
    if (total > maxTotal) throw new SignError('pdf_too_complex', 413);
  }
  // Anidamiento por objeto, sin contar el contenido de los streams.
  const noStreams = text.replace(/stream\r?\n[\s\S]*?endstream/g, ' ');
  for (const body of noStreams.split(/\bendobj\b/)) {
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
      const c = body.charCodeAt(i);
      if (c === 0x5b || (c === 0x3c && body.charCodeAt(i + 1) === 0x3c)) {
        if (c === 0x3c) i++;
        if (++depth > MAX_PDF_DEPTH) throw new SignError('pdf_too_complex', 413);
      } else if (c === 0x5d || (c === 0x3e && body.charCodeAt(i + 1) === 0x3e)) {
        if (c === 0x3e) i++;
        depth = Math.max(0, depth - 1);
      }
    }
  }
}

function nameOf(v: PDFObject | undefined): string | null {
  return v instanceof PDFName ? v.decodeText() : null;
}

function textOf(v: PDFObject | undefined): string {
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '';
}

/** Limpia un diccionario: claves activas fuera y acciones peligrosas inertes. */
function cleanDictShallow(dict: PDFDict, drop: PDFRef[]): void {
  for (const key of DROP_KEYS) {
    const k = PDFName.of(key);
    const v = dict.get(k);
    if (v === undefined) continue;
    if (v instanceof PDFRef) drop.push(v);
    dict.delete(k);
  }
  const s = nameOf(dict.get(PDFName.of('S')));
  if (s && DANGEROUS_ACTIONS.has(s)) {
    for (const key of ['S', 'F', 'Next', 'D', 'URI', 'Win', 'Mac', 'Unix', 'Fields', 'R', 'AN', 'T']) dict.delete(PDFName.of(key));
  }
  // Un link a algo que no es http(s) (javascript:, file:, smb:) queda sin URI.
  if (s === 'URI' && !/^https?:\/\//i.test(textOf(dict.get(PDFName.of('URI'))).trim())) {
    dict.delete(PDFName.of('URI'));
    dict.delete(PDFName.of('S'));
  }
}

/** Recorre un valor sin recursión (un anidamiento profundo no rompe la pila); las referencias se limpian por su cuenta. */
function cleanValue(root: PDFObject, drop: PDFRef[]): void {
  const stack: PDFObject[] = [root];
  let steps = 0;
  while (stack.length) {
    if (++steps > 2_000_000) throw new SignError('pdf_too_complex', 413);
    const v = stack.pop()!;
    const dict = v instanceof PDFDict ? v : v instanceof PDFStream ? v.dict : null;
    if (dict) {
      cleanDictShallow(dict, drop);
      for (const [, x] of dict.entries()) if (!(x instanceof PDFRef)) stack.push(x);
    } else if (v instanceof PDFArray) {
      for (const x of v.asArray()) if (!(x instanceof PDFRef)) stack.push(x);
    }
  }
}

/** ¿Este link se queda? Solo los que van a una URL http(s) o a una página del mismo documento. */
function safeLink(doc: PDFDocument, ref: PDFObject): boolean {
  const a = ref instanceof PDFRef ? doc.context.lookupMaybe(ref, PDFDict) : ref instanceof PDFDict ? ref : undefined;
  if (!a || nameOf(a.get(PDFName.of('Subtype'))) !== 'Link') return false;
  const action = a.lookupMaybe(PDFName.of('A'), PDFDict);
  if (!action) return a.get(PDFName.of('Dest')) !== undefined;
  const s = nameOf(action.get(PDFName.of('S')));
  if (s === 'GoTo') return true;
  return s === 'URI' && /^https?:\/\//i.test(textOf(action.get(PDFName.of('URI'))).trim());
}

function keepSafeLinks(doc: PDFDocument): void {
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    const keep = annots.asArray().filter((ref) => safeLink(doc, ref));
    if (keep.length) page.node.set(PDFName.of('Annots'), doc.context.obj(keep));
    else page.node.delete(PDFName.of('Annots'));
  }
}

/** Vista de la página (ancho y alto como se ve, con la rotación). */
function viewBox(page: PDFPage): { cx: number; cy: number; W: number; H: number; rot: number; vw: number; vh: number } {
  const c = page.getCropBox();
  const rot = (((page.getRotation().angle % 360) + 360) % 360) as number;
  const sideways = rot === 90 || rot === 270;
  return { cx: c.x, cy: c.y, W: c.width, H: c.height, rot, vw: sideways ? c.height : c.width, vh: sideways ? c.width : c.height };
}

export function pageBoxes(doc: PDFDocument): PageBox[] {
  return doc.getPages().map((p) => {
    const v = viewBox(p);
    return { w: Math.round(v.vw * 100) / 100, h: Math.round(v.vh * 100) / 100 };
  });
}

/**
 * Revisa el archivo crudo (guardPdf), lo carga, aplana el formulario, saca lo
 * activo y arma un documento nuevo copiando solo las páginas: lo que no
 * cuelga de una página (adjuntos, XFA, nombres, acciones del catálogo) no
 * llega al archivo limpio. Errores: pdf_invalid, pdf_encrypted, pdf_pages,
 * pdf_too_complex, pdf_unsupported. Cualquier otra falla del parser (pila,
 * tipos) es pdf_invalid, nunca un 500.
 */
export async function sanitizePdf(input: Buffer | Uint8Array): Promise<{ bytes: Buffer; pages: PageBox[] }> {
  let buf: Buffer = Buffer.from(input);
  if (buf.length > MAX_PDF_BYTES) throw new SignError('pdf_too_large', 413);
  if (!sniffPdf(buf)) {
    // Una foto o un escaneo: se arma el PDF y sigue el mismo camino que uno subido.
    const fromImage = await imageToPdf(buf);
    if (!fromImage) throw new SignError('pdf_invalid', 415);
    buf = fromImage;
  }
  try {
    guardPdf(buf);
    return await sanitizeLoaded(buf);
  } catch (err) {
    if (err instanceof SignError) throw err;
    if (err instanceof EncryptedPDFError) throw new SignError('pdf_encrypted', 415);
    throw new SignError('pdf_invalid', 415);
  }
}

async function sanitizeLoaded(buf: Buffer): Promise<{ bytes: Buffer; pages: PageBox[] }> {
  const src = await PDFDocument.load(buf, { updateMetadata: false, throwOnInvalidObject: false });
  if (src.context.enumerateIndirectObjects().length > MAX_PDF_OBJECTS) throw new SignError('pdf_too_complex', 413);
  const count = src.getPageCount();
  if (count < 1) throw new SignError('pdf_invalid', 415);
  if (count > MAX_PDF_PAGES) throw new SignError('pdf_pages', 413);

  // Un formulario se aplana (los valores quedan dibujados) antes de sacarlo.
  if (src.catalog.get(PDFName.of('AcroForm'))) {
    try {
      src.getForm().flatten();
    } catch {
      /* formulario roto: se saca igual abajo */
    }
  }
  keepSafeLinks(src);
  // Todo objeto del archivo, incluso los que ya no cuelgan de nada.
  const drop: PDFRef[] = [];
  for (const [, obj] of src.context.enumerateIndirectObjects()) cleanValue(obj, drop);
  for (const ref of drop) src.context.delete(ref);
  // Un link que quedó sin acción al limpiar, afuera.
  keepSafeLinks(src);

  // Documento nuevo con solo las páginas: el catálogo viejo (nombres, adjuntos, XFA, acciones) no viaja.
  const out = await PDFDocument.create({ updateMetadata: false });
  for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  const drop2: PDFRef[] = [];
  for (const [, obj] of out.context.enumerateIndirectObjects()) cleanValue(obj, drop2);
  for (const ref of drop2) out.context.delete(ref);
  const bytes = Buffer.from(await out.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false }));
  return { bytes, pages: pageBoxes(out) };
}

// ---------- Texto con las fuentes estándar ----------

function safeTextFor(font: PDFFont) {
  const allowed = new Set(font.getCharacterSet());
  return (s: string) =>
    Array.from(
      s
        .normalize('NFC')
        .replace(/[–—]/g, '-')
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/\s+/g, ' '),
    )
      .map((ch) => (allowed.has(ch.codePointAt(0) ?? 0) ? ch : '?'))
      .join('');
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= maxWidth || !line) {
        // Una palabra más larga que la línea se corta por caracteres.
        if (!line && font.widthOfTextAtSize(w, size) > maxWidth) {
          let chunk = '';
          for (const ch of w) {
            if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) {
              out.push(chunk);
              chunk = '';
            }
            chunk += ch;
          }
          line = chunk;
        } else line = next;
      } else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

// ---------- Campos sobre las páginas ----------

export interface FlattenField {
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: string | null;
  /** Firma o iniciales del destinatario (data URL JPEG validado). */
  image?: string | null;
}

/** Punto de la vista (en puntos desde arriba a la izquierda) → espacio del PDF, según la rotación. */
function mapPoint(v: ReturnType<typeof viewBox>, px: number, py: number): { x: number; y: number } {
  const u = px / v.vw;
  const t = py / v.vh;
  switch (v.rot) {
    case 90:
      return { x: v.cx + t * v.W, y: v.cy + u * v.H };
    case 180:
      return { x: v.cx + (1 - u) * v.W, y: v.cy + t * v.H };
    case 270:
      return { x: v.cx + (1 - t) * v.W, y: v.cy + v.H - u * v.H };
    default:
      return { x: v.cx + u * v.W, y: v.cy + v.H - t * v.H };
  }
}

/** Dibuja los valores y las firmas. Devuelve los bytes del documento firmado (sin certificado). */
export async function flattenFields(original: Buffer, fields: FlattenField[]): Promise<Buffer> {
  const doc = await PDFDocument.load(original, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const safe = safeTextFor(font);
  const pages = doc.getPages();
  const images = new Map<string, Awaited<ReturnType<PDFDocument['embedJpg']>>>();
  for (const f of fields) {
    const page = pages[f.page - 1];
    if (!page) continue;
    const v = viewBox(page);
    const bx = f.x * v.vw;
    const by = f.y * v.vh;
    const bw = f.w * v.vw;
    const bh = f.h * v.vh;
    const rotate = degrees(v.rot);
    if (f.kind === 'signature' || f.kind === 'initials') {
      const bytes = f.image ? signatureBytes(f.image) : null;
      if (!bytes || f.value !== 'signed') continue;
      let img = images.get(f.image!);
      if (!img) {
        img = await doc.embedJpg(new Uint8Array(bytes)); // copia: pdf-lib lee el ArrayBuffer sin el offset del Buffer
        images.set(f.image!, img);
      }
      const scale = Math.min(bw / img.width, bh / img.height);
      const iw = img.width * scale;
      const ih = img.height * scale;
      const at = mapPoint(v, bx + (bw - iw) / 2, by + (bh + ih) / 2);
      page.drawImage(img, { x: at.x, y: at.y, width: iw, height: ih, rotate });
      continue;
    }
    if (f.kind === 'checkbox') {
      if (f.value !== 'true') continue;
      const size = Math.min(bw, bh) * 0.9;
      const at = mapPoint(v, bx + (bw - font.widthOfTextAtSize('X', size)) / 2, by + bh / 2 + size * 0.35);
      page.drawText('X', { x: at.x, y: at.y, size, font, color: rgb(0.07, 0.07, 0.07), rotate });
      continue;
    }
    const text = safe(f.value ?? '');
    if (!text) continue;
    let size = Math.max(5, Math.min(12, bh * 0.7));
    while (size > 5 && font.widthOfTextAtSize(text, size) > bw - 2) size -= 0.5;
    const at = mapPoint(v, bx + 1, by + bh / 2 + size * 0.35);
    page.drawText(text, { x: at.x, y: at.y, size, font, color: rgb(0.07, 0.07, 0.07), rotate });
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

// ---------- Certificado de finalización ----------

export interface CertificateRecipient {
  name: string;
  email: string;
  role: string;
  routingOrder: number;
  status: string;
  sentAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  declinedAt?: string | null;
  otpVerifiedAt: string | null;
  consentAt: string | null;
  ip: string;
  userAgent: string;
  signatureImage: string | null;
}

export interface CertificateEvent {
  at: string;
  text: string;
  ip: string;
  userAgent: string;
}

export interface CertificateInput {
  envelopeId: string;
  title: string;
  documentName: string;
  pageCount: number;
  sender: string;
  createdAt: string;
  sentAt: string | null;
  completedAt: string;
  documentHash: string;
  uploadHash: string | null;
  flattenedHash: string;
  recipients: CertificateRecipient[];
  events: CertificateEvent[];
}

/** El navegador lo manda el cliente: va entre comillas, sin saltos y acotado, para que no parezca parte del certificado. */
export function quoteUa(ua: string | null | undefined): string {
  const clean = (ua ?? '').replace(/[\r\n\t"]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return '-';
  return `"${clean.length > 160 ? `${clean.slice(0, 157)}...` : clean}"`;
}

/** Suma las páginas del certificado al documento firmado y devuelve el PDF final. */
export async function appendCertificate(flattened: Buffer, c: CertificateInput): Promise<Buffer> {
  const doc = await PDFDocument.load(flattened, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const safe = safeTextFor(font);
  const W = 595.28;
  const H = 841.89;
  const M = 48;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const ensure = (need: number) => {
    if (y - need < M) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };
  const line = (text: string, o: { size?: number; bold?: boolean; gray?: number; gap?: number; indent?: number } = {}) => {
    const size = o.size ?? 9;
    const f = o.bold ? bold : font;
    y -= o.gap ?? 0;
    for (const l of wrap(safe(text), f, size, W - M * 2 - (o.indent ?? 0))) {
      ensure(size + 3);
      y -= size + 3;
      page.drawText(l, { x: M + (o.indent ?? 0), y, size, font: f, color: rgb(o.gray ?? 0.07, o.gray ?? 0.07, o.gray ?? 0.07) });
    }
  };

  line('Certificate of completion', { size: 18, bold: true });
  line(`Envelope ${c.envelopeId}`, { size: 8.5, gray: 0.4, gap: 2 });
  line('Document', { size: 11, bold: true, gap: 14 });
  line(`Title: ${c.title}`);
  line(`File: ${c.documentName || '-'} (${c.pageCount} page${c.pageCount === 1 ? '' : 's'} before this certificate)`);
  line(`Sender: ${c.sender}`);
  line(`Created: ${utcStamp(c.createdAt)}   Sent: ${utcStamp(c.sentAt)}   Completed: ${utcStamp(c.completedAt)}`);
  line('Hashes (SHA-256)', { size: 11, bold: true, gap: 14 });
  line(`Original document as sent for signature: ${c.documentHash}`, { size: 8 });
  if (c.uploadHash && c.uploadHash !== c.documentHash) line(`File as uploaded, before converting it or removing scripts and actions: ${c.uploadHash}`, { size: 8 });
  line(`Signed pages, as saved before this certificate was added: ${c.flattenedHash}`, { size: 8 });
  line('That intermediate file is re-saved together with this certificate, so its hash cannot be recomputed from this PDF. The hash of the final file, with this certificate, is in the completion email and on the envelope page: compute the SHA-256 of this file to check it.', { size: 8, gray: 0.4 });

  line('Recipients', { size: 11, bold: true, gap: 14 });
  for (const r of c.recipients) {
    ensure(120);
    line(`${r.name} <${r.email}>`, { bold: true, gap: 6 });
    line(`Role: ${r.role}   Routing order: ${r.routingOrder}   Status: ${r.status}`, { indent: 10 });
    line(`Sent: ${utcStamp(r.sentAt)}   Viewed: ${utcStamp(r.viewedAt)}   ${r.declinedAt ? `Declined: ${utcStamp(r.declinedAt)}` : `Signed: ${utcStamp(r.signedAt)}`}`, { indent: 10 });
    line(`Email code verified: ${r.otpVerifiedAt ? utcStamp(r.otpVerifiedAt) : 'not required'}   Consent to sign electronically: ${utcStamp(r.consentAt)}`, { indent: 10 });
    if (r.ip || r.userAgent) line(`IP: ${r.ip || '-'}   Browser: ${quoteUa(r.userAgent)}`, { indent: 10, size: 8 });
    const img = r.signatureImage ? signatureBytes(r.signatureImage) : null;
    if (img) {
      try {
        const j = await doc.embedJpg(new Uint8Array(img));
        const w = Math.min(160, j.width);
        const h = (w * j.height) / j.width;
        ensure(h + 8);
        y -= h + 4;
        page.drawImage(j, { x: M + 10, y, width: w, height: h });
        page.drawRectangle({ x: M + 10, y, width: w, height: h, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
      } catch {
        /* firma ilegible: queda el resto */
      }
    }
  }

  line('Audit trail (UTC)', { size: 11, bold: true, gap: 14 });
  for (const e of c.events) {
    line(`${utcStamp(e.at)}  ${e.text}`, { size: 8.5, gap: 2 });
    if (e.ip || e.userAgent) line(`IP ${e.ip || '-'}  Browser ${quoteUa(e.userAgent)}`, { size: 7.5, gray: 0.4, indent: 10 });
  }
  line(ESIGN_LEGAL_NOTE, { size: 7.5, gray: 0.4, gap: 16 });
  line('Generated by zerosoft Sign.', { size: 7.5, gray: 0.4 });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** Una carta en texto (párrafos separados por línea en blanco) como PDF A4 limpio. */
export async function textToPdf(title: string, body: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(title.slice(0, 200));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const safe = safeTextFor(font);
  const W = 595.28;
  const H = 841.89;
  const M = 56;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const put = (text: string, f: PDFFont, size: number, gap = 0) => {
    y -= gap;
    for (const l of wrap(safe(text), f, size, W - M * 2)) {
      if (y - size - 4 < M) {
        page = doc.addPage([W, H]);
        y = H - M;
      }
      y -= size + 4;
      page.drawText(l, { x: M, y, size, font: f, color: rgb(0.07, 0.07, 0.07) });
    }
  };
  put(title, bold, 16);
  for (const para of body.replace(/\r/g, '').split(/\n{2,}/)) put(para.replace(/^#+\s*/gm, '').replace(/\*\*/g, ''), font, 10.5, 10);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

// ---------- Imágenes (JPEG y PNG) como documento ----------

/** Lado máximo de una imagen, en píxeles. */
export const MAX_IMAGE_SIDE = 10_000;
/**
 * Píxeles de un PNG: pdf-lib lo descomprime entero en memoria (4 bytes por
 * píxel), así que se acota antes de leerlo. Un JPEG viaja sin descomprimir.
 */
export const MAX_PNG_PIXELS = 16_000_000;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ImageKind = 'jpeg' | 'png';

/** JPEG o PNG por sus bytes, o null. */
export function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 24 && buf.subarray(0, 8).equals(PNG_MAGIC) && buf.subarray(12, 16).toString('latin1') === 'IHDR') return 'png';
  return null;
}

/** Ancho y alto de un PNG desde su encabezado (IHDR), sin descomprimirlo. */
export function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (sniffImage(buf) !== 'png') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Tamaño de un JPEG: el primer marcador SOF (el de la imagen; las miniaturas EXIF van dentro de APP1 y se saltean). */
function jpegDims(buf: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    if (marker === 0xda || marker === 0xd9) return null;
    i += 2 + len;
  }
  return null;
}

/**
 * Orientación EXIF de un JPEG (1 a 8; 1 si no hay). Los celulares guardan la
 * foto como sale del sensor y anotan acá cómo girarla.
 */
export function jpegOrientation(buf: Buffer): number {
  let i = 2;
  while (i + 4 < buf.length) {
    if (buf[i] !== 0xff) return 1;
    const marker = buf[i + 1];
    if (marker === 0xda || marker === 0xd9) return 1;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return 1;
    if (marker === 0xe1 && buf.subarray(i + 4, i + 10).toString('latin1') === 'Exif\0\0') {
      const tiff = i + 10;
      const end = Math.min(buf.length, i + 2 + len);
      if (tiff + 8 > end) return 1;
      const order = buf.subarray(tiff, tiff + 2).toString('latin1');
      if (order !== 'II' && order !== 'MM') return 1;
      const le = order === 'II';
      const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
      const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > end) return 1;
      const count = u16(ifd);
      for (let k = 0; k < count; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 12 > end) return 1;
        if (u16(e) === 0x0112) {
          const v = u16(e + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

const A4: [number, number] = [595.28, 841.89];
const IMAGE_MARGIN = 36;

/**
 * Una imagen JPEG o PNG como PDF de una página A4 (vertical u horizontal según
 * la imagen), centrada dentro de márgenes de media pulgada y girada según su
 * EXIF. null si no es una imagen. Errores: image_too_large, pdf_invalid.
 */
export async function imageToPdf(input: Buffer | Uint8Array): Promise<Buffer | null> {
  const buf = Buffer.from(input);
  const kind = sniffImage(buf);
  if (!kind) return null;
  const dims = kind === 'png' ? pngSize(buf) : jpegDims(buf);
  if (!dims || dims.width < 1 || dims.height < 1) throw new SignError('pdf_invalid', 415);
  if (dims.width > MAX_IMAGE_SIDE || dims.height > MAX_IMAGE_SIDE) throw new SignError('image_too_large', 413);
  if (kind === 'png' && dims.width * dims.height > MAX_PNG_PIXELS) throw new SignError('image_too_large', 413);
  const orientation = kind === 'jpeg' ? jpegOrientation(buf) : 1;
  // 5 a 8 van de costado: el ancho que se ve es el alto guardado. Los espejados se muestran sin espejar.
  const sideways = orientation >= 5;
  const shownW = sideways ? dims.height : dims.width;
  const shownH = sideways ? dims.width : dims.height;
  try {
    const doc = await PDFDocument.create();
    // Copia con su propio ArrayBuffer: pdf-lib lee el buffer de fondo e ignora el offset de un Buffer chico de Node.
    const bytes = new Uint8Array(buf);
    const img = kind === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const [pw, ph] = shownW > shownH ? [A4[1], A4[0]] : A4;
    const scale = Math.min((pw - 2 * IMAGE_MARGIN) / shownW, (ph - 2 * IMAGE_MARGIN) / shownH);
    const w = shownW * scale;
    const h = shownH * scale;
    const left = (pw - w) / 2;
    const bottom = (ph - h) / 2;
    const page = doc.addPage([pw, ph]);
    // El ancho y alto de drawImage son los de la imagen guardada; la rotación es alrededor de (x, y).
    const drawW = sideways ? h : w;
    const drawH = sideways ? w : h;
    if (orientation === 3 || orientation === 4) page.drawImage(img, { x: left + w, y: bottom + h, width: drawW, height: drawH, rotate: degrees(180) });
    else if (orientation === 6 || orientation === 5) page.drawImage(img, { x: left, y: bottom + h, width: drawW, height: drawH, rotate: degrees(-90) });
    else if (orientation === 8 || orientation === 7) page.drawImage(img, { x: left + w, y: bottom, width: drawW, height: drawH, rotate: degrees(90) });
    else page.drawImage(img, { x: left, y: bottom, width: drawW, height: drawH });
    return Buffer.from(await doc.save({ useObjectStreams: false }));
  } catch (err) {
    if (err instanceof SignError) throw err;
    throw new SignError('pdf_invalid', 415);
  }
}

/** Nombre del documento guardado: una imagen pasa a llamarse .pdf. */
export function signDocumentName(name: string): string {
  const clean = name.slice(0, 200);
  return /\.(jpe?g|png)$/i.test(clean) ? clean.replace(/\.(jpe?g|png)$/i, '.pdf') : clean;
}
