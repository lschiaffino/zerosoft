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
 *
 * Las fuentes son las estándar (Helvetica, WinAnsi): lo que no entra sale como "?".
 */
import {
  degrees,
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFStream,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';
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

function nameOf(v: PDFObject | undefined): string | null {
  return v instanceof PDFName ? v.decodeText() : null;
}

/** Limpia un diccionario y lo que tiene adentro (sin seguir referencias: esas se limpian por su cuenta). */
function cleanDict(dict: PDFDict, drop: PDFRef[]): void {
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
  for (const [, v] of dict.entries()) cleanValue(v, drop);
}

function cleanValue(v: PDFObject, drop: PDFRef[]): void {
  if (v instanceof PDFDict) cleanDict(v, drop);
  else if (v instanceof PDFStream) cleanDict(v.dict, drop);
  else if (v instanceof PDFArray) for (const x of v.asArray()) cleanValue(x, drop);
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
 * Carga, aplana el formulario y saca lo activo. Devuelve los bytes limpios y el
 * tamaño de cada página. Errores: pdf_invalid, pdf_encrypted, pdf_pages.
 */
export async function sanitizePdf(input: Buffer | Uint8Array): Promise<{ bytes: Buffer; pages: PageBox[] }> {
  if (!sniffPdf(input)) throw new SignError('pdf_invalid', 415);
  if (input.length > MAX_PDF_BYTES) throw new SignError('pdf_too_large', 413);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (err) {
    if (err instanceof EncryptedPDFError) throw new SignError('pdf_encrypted', 415);
    throw new SignError('pdf_invalid', 415);
  }
  const count = doc.getPageCount();
  if (count < 1) throw new SignError('pdf_invalid', 415);
  if (count > MAX_PDF_PAGES) throw new SignError('pdf_pages', 413);

  // Un formulario se aplana (los valores quedan dibujados) antes de sacarlo.
  if (doc.catalog.get(PDFName.of('AcroForm'))) {
    try {
      doc.getForm().flatten();
    } catch {
      /* formulario roto: se saca igual abajo */
    }
  }
  // Nombres: sin JavaScript ni adjuntos.
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (names) {
    for (const key of ['JavaScript', 'EmbeddedFiles']) {
      const v = names.get(PDFName.of(key));
      if (v instanceof PDFRef) doc.context.delete(v);
      names.delete(PDFName.of(key));
    }
  }
  // Anotaciones: quedan solo los links (sin acciones peligrosas, que se limpian abajo).
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    const keep = annots.asArray().filter((ref) => {
      const a = doc.context.lookupMaybe(ref, PDFDict);
      return Boolean(a && nameOf(a.get(PDFName.of('Subtype'))) === 'Link');
    });
    for (const ref of annots.asArray()) if (!keep.includes(ref) && ref instanceof PDFRef) doc.context.delete(ref);
    if (keep.length) page.node.set(PDFName.of('Annots'), doc.context.obj(keep));
    else page.node.delete(PDFName.of('Annots'));
  }
  // Todo objeto del archivo, incluso los que ya no cuelgan de nada.
  const drop: PDFRef[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) cleanValue(obj, drop);
  for (const ref of drop) doc.context.delete(ref);
  cleanDict(doc.catalog, []);

  const bytes = Buffer.from(await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false }));
  return { bytes, pages: pageBoxes(doc) };
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
  if (c.uploadHash && c.uploadHash !== c.documentHash) line(`File as uploaded, before removing scripts and actions: ${c.uploadHash}`, { size: 8 });
  line(`Signed document, before these certificate pages: ${c.flattenedHash}`, { size: 8 });
  line('The hash of the final file, with this certificate, is in the completion email and on the envelope page.', { size: 8, gray: 0.4 });

  line('Recipients', { size: 11, bold: true, gap: 14 });
  for (const r of c.recipients) {
    ensure(120);
    line(`${r.name} <${r.email}>`, { bold: true, gap: 6 });
    line(`Role: ${r.role}   Routing order: ${r.routingOrder}   Status: ${r.status}`, { indent: 10 });
    line(`Sent: ${utcStamp(r.sentAt)}   Viewed: ${utcStamp(r.viewedAt)}   ${r.declinedAt ? `Declined: ${utcStamp(r.declinedAt)}` : `Signed: ${utcStamp(r.signedAt)}`}`, { indent: 10 });
    line(`Email code verified: ${r.otpVerifiedAt ? utcStamp(r.otpVerifiedAt) : 'not required'}   Consent to sign electronically: ${utcStamp(r.consentAt)}`, { indent: 10 });
    if (r.ip || r.userAgent) line(`IP: ${r.ip || '-'}   Browser: ${r.userAgent || '-'}`, { indent: 10, size: 8 });
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
    if (e.ip || e.userAgent) line(`IP ${e.ip || '-'}  ${e.userAgent || ''}`, { size: 7.5, gray: 0.4, indent: 10 });
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
