import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { upsertUser } from '@/lib/db';
import { ensureWorkspace } from '@/lib/workspace';
import { createEnvelope, envelopeFile, getEnvelopeRow, setDocument } from '@/lib/sign/core';
import type { SignActor } from '@/lib/sign/types';
import { createTemplate, setTemplateDocument } from '@/lib/sign/templates';
import { imageToPdf, jpegOrientation, MAX_PNG_PIXELS, pngSize, sanitizePdf, signDocumentName, sniffImage, sniffPdf } from '@/lib/sign/pdf';
import { sha256Hex } from '@/lib/esign';

process.env.UPLOADS_DIR = path.join(os.tmpdir(), `zs-sign-img-uploads-${process.pid}`);

const uid = () => Math.random().toString(36).slice(2, 10);

/** JPEG mínimo válido de 40x20 (el mismo de la firma en sign.test.ts). */
const JPEG_40x20 = Buffer.from(
  'ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080014002801011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbfcffd9',
  'hex',
);

/** El mismo JPEG con un bloque EXIF (APP1) que dice cómo girarlo. */
function withOrientation(jpeg: Buffer, orientation: number, order: 'MM' | 'II' = 'MM'): Buffer {
  const tiff = Buffer.alloc(26);
  const le = order === 'II';
  tiff.write(order, 0, 'latin1');
  const w16 = (v: number, o: number) => (le ? tiff.writeUInt16LE(v, o) : tiff.writeUInt16BE(v, o));
  const w32 = (v: number, o: number) => (le ? tiff.writeUInt32LE(v, o) : tiff.writeUInt32BE(v, o));
  w16(42, 2);
  w32(8, 4);
  w16(1, 8); // una entrada
  w16(0x0112, 10);
  w16(3, 12); // SHORT
  w32(1, 14);
  w16(orientation, 18);
  w32(0, 22); // sin IFD siguiente
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const header = Buffer.from([0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]);
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** PNG RGB real de w x h (gris). Con `fakeHeader`, solo el encabezado dice ese tamaño. */
function png(w: number, h: number, fakeHeader?: { w: number; h: number }): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(fakeHeader?.w ?? w, 0);
  ihdr.writeUInt32BE(fakeHeader?.h ?? h, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x80);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0; // filtro 0 por fila
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function onePage(bytes: Buffer) {
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(1);
  const page = doc.getPage(0);
  const content = page.node.Contents();
  const streams = content instanceof PDFArray ? content.asArray().map((r) => doc.context.lookup(r)) : [content];
  const ops = streams
    .filter((st): st is PDFRawStream => st instanceof PDFRawStream)
    .map((st) => Buffer.from(decodePDFRawStream(st).decode()).toString('latin1'))
    .join('\n');
  return { size: page.getSize(), ops, hasImage: !!page.node.Resources()?.lookup(PDFName.of('XObject')) };
}

describe('Sign: imágenes como documento', () => {
  it('reconoce JPEG y PNG por sus bytes, no por el nombre', () => {
    expect(sniffImage(JPEG_40x20)).toBe('jpeg');
    expect(sniffImage(png(4, 3))).toBe('png');
    expect(sniffImage(Buffer.from('GIF89a......................'))).toBeNull();
    expect(pngSize(png(4, 3))).toEqual({ width: 4, height: 3 });
  });

  it('lee la orientación EXIF en los dos órdenes de bytes, y 1 si no hay', () => {
    expect(jpegOrientation(JPEG_40x20)).toBe(1);
    expect(jpegOrientation(withOrientation(JPEG_40x20, 6))).toBe(6);
    expect(jpegOrientation(withOrientation(JPEG_40x20, 8, 'II'))).toBe(8);
    expect(jpegOrientation(withOrientation(JPEG_40x20, 42))).toBe(1);
  });

  it('una imagen ancha va en A4 horizontal; girada por EXIF, en vertical', async () => {
    const wide = await onePage((await imageToPdf(JPEG_40x20))!);
    expect(wide.hasImage).toBe(true);
    expect(wide.size.width).toBeGreaterThan(wide.size.height);
    expect(Math.round(wide.size.width)).toBe(842);

    // 40x20 guardada de costado (EXIF 6): se ve de 20x40, en página vertical y dibujada girada.
    const turned = await onePage((await imageToPdf(withOrientation(JPEG_40x20, 6)))!);
    expect(turned.size.height).toBeGreaterThan(turned.size.width);
    expect(Math.round(turned.size.width)).toBe(595);
    // Girada: la matriz de la imagen lleva el giro (coseno 0, seno -1), la derecha no.
    expect(turned.ops).toMatch(/^[\d.e-]+ -1 1 [\d.e-]+ 0 0 cm$/m);
    expect(wide.ops).not.toMatch(/ -1 1 /);
    expect(turned.ops).not.toBe(wide.ops);
  });

  it('un PNG real se convierte; uno enorme se rechaza por su encabezado sin descomprimirlo', async () => {
    const out = await onePage((await imageToPdf(png(30, 60)))!);
    expect(out.size.height).toBeGreaterThan(out.size.width);
    const side = Math.ceil(Math.sqrt(MAX_PNG_PIXELS)) + 1;
    await expect(imageToPdf(png(2, 2, { w: side, h: side }))).rejects.toThrow('image_too_large');
    await expect(imageToPdf(png(2, 2, { w: 20_000, h: 10 }))).rejects.toThrow('image_too_large');
  });

  it('una imagen rota es pdf_invalid; lo que no es PDF ni imagen también', async () => {
    const broken = Buffer.concat([png(4, 4).subarray(0, 33), Buffer.from('garbage-garbage')]);
    await expect(sanitizePdf(broken)).rejects.toThrow('pdf_invalid');
    await expect(sanitizePdf(Buffer.from('hello, not a document at all'))).rejects.toThrow('pdf_invalid');
    expect(await imageToPdf(Buffer.from('%PDF-1.7 nope'))).toBeNull();
  });

  it('sanitizePdf acepta la imagen y devuelve el PDF limpio con su página', async () => {
    const clean = await sanitizePdf(JPEG_40x20);
    expect(sniffPdf(clean.bytes)).toBe(true);
    expect(clean.pages).toHaveLength(1);
    expect(clean.pages[0].w).toBeGreaterThan(clean.pages[0].h);
  });

  it('el nombre guardado pasa a .pdf', () => {
    expect(signDocumentName('scan.JPG')).toBe('scan.pdf');
    expect(signDocumentName('photo.jpeg')).toBe('photo.pdf');
    expect(signDocumentName('id.png')).toBe('id.pdf');
    expect(signDocumentName('contract.pdf')).toBe('contract.pdf');
  });
});

describe('Sign: subir una imagen a un borrador y a una plantilla', () => {
  let owner: SignActor;
  beforeAll(async () => {
    const email = `sg-img-${uid()}@example.com`;
    const o = await upsertUser({ email, name: 'Owner', image: null });
    await ensureWorkspace(o.id);
    owner = { ws: o.id, person: o.id, admin: true, email, name: 'Owner' };
  });

  it('el borrador guarda un PDF de una página; el hash de subida es el de la foto', async () => {
    const photo = withOrientation(JPEG_40x20, 6);
    const env = await createEnvelope(owner, { title: `Photo ${uid()}` });
    await setDocument(owner, env.id, { bytes: photo, name: 'lease-photo.jpg' });
    const row = (await getEnvelopeRow(owner.ws, env.id))!;
    expect(row.document_name).toBe('lease-photo.pdf');
    expect(row.upload_hash).toBe(sha256Hex(photo));
    expect(JSON.parse(row.pages as unknown as string)).toHaveLength(1);
    const file = await envelopeFile(owner, env.id, 'original');
    expect(sniffPdf(file.bytes)).toBe(true);
    expect(row.document_hash).toBe(sha256Hex(file.bytes));
  });

  it('una plantilla también acepta un PNG', async () => {
    const t = await createTemplate(owner, { name: `Waiver ${uid()}` });
    const saved = await setTemplateDocument(owner, t.id, { bytes: png(30, 60), name: 'waiver.png' });
    expect(saved.document_name).toBe('waiver.pdf');
    expect(JSON.parse(saved.pages as unknown as string)).toHaveLength(1);
  });
});
