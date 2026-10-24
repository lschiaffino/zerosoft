/**
 * Firma electrónica de cotizaciones: hash del contenido firmado, validación
 * de la imagen de la firma y certificado de auditoría en PDF. Server-only.
 *
 * Qué prueba el certificado: quién firmó (nombre tipeado, email, dibujo),
 * cuándo (UTC), desde dónde (IP y navegador) y qué firmó (SHA-256 del
 * contenido de la cotización tal como estaba al firmar; una cotización
 * enviada ya no se puede editar).
 */
import { createHash } from 'crypto';
import { getDb } from './db';
import { buildPdf, jpegSize, type PdfLine } from './pdf-lite';
import type { CrmQuoteRow } from './db';

/** Máximo de la firma dibujada (data URL JPEG). */
export const MAX_SIGNATURE_BYTES = 200 * 1024;

/** Contenido que se firma, en un orden fijo. */
export function quoteSignedContent(q: Pick<
  CrmQuoteRow,
  | 'number'
  | 'title'
  | 'currency'
  | 'items'
  | 'subtotal'
  | 'discount_total'
  | 'tax_total'
  | 'total'
  | 'expires_at'
  | 'terms'
  | 'notes'
  | 'sender_name'
  | 'sender_email'
  | 'sender_company'
  | 'recipient_name'
  | 'recipient_email'
  | 'recipient_company'
>): string {
  let items: unknown = [];
  try {
    items = JSON.parse(q.items || '[]');
  } catch {
    items = [];
  }
  return JSON.stringify([
    q.number,
    q.title,
    q.currency,
    items,
    q.subtotal,
    q.discount_total,
    q.tax_total,
    q.total,
    q.expires_at ?? null,
    q.terms,
    q.notes,
    [q.sender_name, q.sender_email, q.sender_company],
    [q.recipient_name, q.recipient_email, q.recipient_company],
  ]);
}

export function quoteContentHash(q: Parameters<typeof quoteSignedContent>[0]): string {
  return createHash('sha256').update(quoteSignedContent(q), 'utf8').digest('hex');
}

/** Valida la firma dibujada: data URL JPEG, tamaño acotado. Devuelve el data URL o '' si no sirve. */
export function cleanSignatureImage(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('data:image/jpeg;base64,')) return '';
  if (raw.length > MAX_SIGNATURE_BYTES * 1.4) return '';
  const buf = Buffer.from(raw.slice('data:image/jpeg;base64,'.length), 'base64');
  const size = jpegSize(buf);
  if (!size || size.width < 20 || size.height < 10 || size.width > 2000 || size.height > 1000) return '';
  return raw;
}

export interface QuoteSignatureRow {
  id: string;
  quote_id: string;
  user_id: string;
  signer_name: string;
  signer_email: string;
  signature_image: string;
  ip: string;
  user_agent: string;
  content_hash: string;
  viewed_at: string | null;
  signed_at: string;
  created_at: string;
}

export async function getQuoteSignature(quoteId: string): Promise<QuoteSignatureRow | null> {
  return (
    ((await getDb().prepare('SELECT * FROM crm_quote_signatures WHERE quote_id = ?').get(quoteId)) as QuoteSignatureRow | undefined) ??
    null
  );
}

function utc(d: string | null | undefined): string {
  if (!d) return '-';
  const iso = d.includes('T') ? d : `${d.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? d : `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

/** Certificado de auditoría (PDF) de una cotización firmada. */
export function signatureCertificate(q: CrmQuoteRow, sig: QuoteSignatureRow, publicUrl: string): Buffer {
  const money = (() => {
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency: q.currency || 'USD' }).format(q.total);
    } catch {
      return `${q.total} ${q.currency}`;
    }
  })();
  const currentHash = quoteContentHash(q);
  const lines: PdfLine[] = [
    { text: 'Certificate of electronic signature', size: 18, bold: true },
    { text: `Certificate ${sig.id}`, size: 9, gray: 0.4, gap: 2 },
    { text: 'Document', size: 11, bold: true, gap: 14 },
    { text: `Quote ${q.number}${q.title ? ` - ${q.title}` : ''}` },
    { text: `Total: ${money}` },
    { text: `From: ${[q.sender_name, q.sender_company, q.sender_email].filter(Boolean).join(', ') || '-'}` },
    { text: `To: ${[q.recipient_name, q.recipient_company, q.recipient_email].filter(Boolean).join(', ') || '-'}` },
    { text: `Content SHA-256 at signature: ${sig.content_hash}`, size: 8.5, gap: 4 },
    {
      text:
        currentHash === sig.content_hash
          ? 'The quote has not changed since it was signed.'
          : 'Warning: the current content of the quote does not match the signed hash.',
      size: 9,
      gray: currentHash === sig.content_hash ? 0.35 : 0,
      bold: currentHash !== sig.content_hash,
    },
    { text: 'Signer', size: 11, bold: true, gap: 14 },
    { text: `Name: ${sig.signer_name}` },
    { text: `Email: ${sig.signer_email || '-'}` },
    { text: `Signed at: ${utc(sig.signed_at)}` },
    { text: `IP address: ${sig.ip || '-'}` },
    { text: `Browser: ${sig.user_agent || '-'}`, size: 8.5 },
    { text: 'Signature', size: 11, bold: true, gap: 14 },
    { text: 'Audit trail', size: 11, bold: true, gap: 14 },
    { text: `Created: ${utc(q.created_at)}` },
    { text: `Sent: ${utc(q.sent_at)}` },
    { text: `First opened: ${utc(sig.viewed_at ?? q.first_viewed_at ?? null)}` },
    { text: `Signed by ${sig.signer_name}: ${utc(sig.signed_at)}` },
    ...(q.payment_status === 'paid' ? [{ text: `Paid with Stripe: ${utc(q.paid_at)}` }] : []),
    {
      text: `The signer typed their name, drew a signature and agreed to the terms on the quote page ${publicUrl}. Generated by Zerosoft.`,
      size: 8.5,
      gray: 0.4,
      gap: 18,
    },
  ];
  const jpeg = sig.signature_image ? Buffer.from(sig.signature_image.slice('data:image/jpeg;base64,'.length), 'base64') : null;
  const signatureIdx = lines.findIndex((l) => l.text === 'Signature');
  return buildPdf({
    title: `Signature certificate ${q.number}`,
    lines: jpeg ? lines : lines.filter((_, i) => i !== signatureIdx),
    image: jpeg ? { jpeg, width: 220 } : null,
    imageAfter: signatureIdx + 1,
  });
}
