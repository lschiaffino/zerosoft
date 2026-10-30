/**
 * Books: PDF de una factura, nota de crédito o factura de proveedor,
 * generado en el servidor con el escritor de PDF de Docs (lib/docs-pdf.ts:
 * sin navegador ni dependencias, entra en el límite de Vercel). Lleva el
 * logo (JPEG o PNG), los datos del emisor y del cliente, las líneas, el
 * impuesto por alícuota, los totales, el estado de cobro, el CAE si está
 * autorizada y el pie configurado.
 */
import type { DocsBlock } from './docs-types';
import { blocksToPdf, type PdfImageData } from './docs-pdf';
import { ensureBooks, getContactRow } from './books';
import { getDocument, type DocDto } from './books-docs';
import { bpsToPercent, formatMoney } from './books-money';

const LABELS = {
  en: { invoice: 'Invoice', credit_note: 'Credit note', bill: 'Bill', billTo: 'Bill to', from: 'From', issued: 'Issue date', due: 'Due date', desc: 'Description', qty: 'Qty', price: 'Unit price', disc: 'Disc.', tax: 'Tax', amount: 'Amount', subtotal: 'Subtotal', discount: 'Discount', total: 'Total', paid: 'Paid', balance: 'Balance due', notes: 'Notes', cae: 'Authorization', caeDue: 'expires', test: 'Test authorization, no fiscal validity', taxId: 'Tax ID', rate: 'Exchange rate', status: { void: 'VOID', paid: 'PAID' } },
  es: { invoice: 'Factura', credit_note: 'Nota de crédito', bill: 'Factura de proveedor', billTo: 'Cliente', from: 'Emisor', issued: 'Fecha de emisión', due: 'Vencimiento', desc: 'Descripción', qty: 'Cant.', price: 'Precio unit.', disc: 'Desc.', tax: 'IVA', amount: 'Importe', subtotal: 'Subtotal', discount: 'Descuento', total: 'Total', paid: 'Cobrado', balance: 'Saldo', notes: 'Notas', cae: 'CAE', caeDue: 'vence', test: 'Autorización de prueba, sin validez fiscal', taxId: 'CUIT/ID fiscal', rate: 'Tipo de cambio', status: { void: 'ANULADA', paid: 'PAGADA' } },
  pt: { invoice: 'Fatura', credit_note: 'Nota de crédito', bill: 'Conta a pagar', billTo: 'Cliente', from: 'Emitente', issued: 'Emissão', due: 'Vencimento', desc: 'Descrição', qty: 'Qtd.', price: 'Preço unit.', disc: 'Desc.', tax: 'Imposto', amount: 'Valor', subtotal: 'Subtotal', discount: 'Desconto', total: 'Total', paid: 'Pago', balance: 'Saldo', notes: 'Notas', cae: 'Autorização', caeDue: 'vence', test: 'Autorização de teste, sem validade fiscal', taxId: 'CNPJ/ID fiscal', rate: 'Câmbio', status: { void: 'CANCELADA', paid: 'PAGA' } },
} as const;

let blockSeq = 0;
const block = (type: DocsBlock['type'], content: string, extra: Partial<DocsBlock> = {}): DocsBlock => ({ id: `b${++blockSeq}`, type, content, ...extra }) as DocsBlock;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function logoBytes(url: string | null): Promise<PdfImageData | null> {
  if (!url) return null;
  try {
    const { localUploadPath } = await import('./uploads');
    const local = url.startsWith('/') ? localUploadPath(url) : null;
    let bytes: Buffer | null = null;
    if (local) bytes = await (await import('fs/promises')).readFile(local);
    else if (url.startsWith('https://')) {
      const { safeFetch } = await import('./safe-fetch');
      const res = await safeFetch(url, {}, 8_000);
      if (res.ok) bytes = Buffer.from(await res.arrayBuffer());
    }
    if (!bytes || bytes.length > 2_000_000) return null;
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, mime: 'image/jpeg' };
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return { bytes, mime: 'image/png' };
    return null;
  } catch {
    return null;
  }
}

export async function documentPdf(ws: string, doc: DocDto, locale = 'en'): Promise<Buffer> {
  const s = await ensureBooks(ws);
  const L = LABELS[(locale in LABELS ? locale : 'en') as keyof typeof LABELS];
  const contact = await getContactRow(ws, doc.contactId);
  const money = (v: number) => formatMoney(v, doc.currency, locale);
  const blocks: DocsBlock[] = [];
  const logo = await logoBytes(s.logo_url);
  if (logo) blocks.push(block('image', '', { url: 'logo', name: 'logo' }));
  const issuer = [s.legal_name || s.trade_name, s.tax_id ? `${L.taxId}: ${s.tax_id}` : '', s.address, [s.email, s.phone].filter(Boolean).join(' · ')].filter(Boolean);
  blocks.push(block('paragraph', `<b>${esc(L.from)}</b><br>${issuer.map(esc).join('<br>')}`));
  const receiver = contact ? [contact.name, contact.tax_id ? `${L.taxId}: ${contact.tax_id}` : '', contact.address, contact.email].filter(Boolean) : [];
  if (receiver.length) blocks.push(block('paragraph', `<b>${esc(doc.docType === 'bill' ? L.from : L.billTo)}</b><br>${receiver.map(esc).join('<br>')}`));
  const meta = [`${L.issued}: ${doc.issueDate}`, doc.dueDate && doc.docType !== 'credit_note' ? `${L.due}: ${doc.dueDate}` : '', doc.reference ? doc.reference : '', doc.fxRate !== '1' ? `${L.rate}: ${doc.fxRate} ${s.base_currency}/${doc.currency}` : ''].filter(Boolean);
  blocks.push(block('paragraph', meta.map(esc).join('<br>')));
  if (doc.status === 'void' || doc.status === 'paid') blocks.push(block('heading', esc(L.status[doc.status]), { level: 2 }));
  const anyDisc = doc.lines.some((l) => l.discountBps);
  const head = [L.desc, L.qty, L.price, ...(anyDisc ? [L.disc] : []), L.tax, L.amount];
  const rows = doc.lines.map((l) => [l.description, String(l.quantity), money(l.unitPrice), ...(anyDisc ? [l.discountBps ? `${bpsToPercent(l.discountBps)}%` : ''] : []), l.taxBps ? `${bpsToPercent(l.taxBps)}%` : '0%', money(l.net)]);
  blocks.push(block('table', '', { rows: [head, ...rows].map((r) => r.map(esc)) }));
  const totals: string[][] = [[L.subtotal, money(doc.subtotal)]];
  if (doc.discountTotal) totals.push([L.discount, `-${money(doc.discountTotal)}`]);
  for (const r of doc.taxBreakdown) if (r.taxBps) totals.push([`${L.tax} ${bpsToPercent(r.taxBps)}%`, money(r.tax)]);
  totals.push([L.total, money(doc.total)]);
  if (doc.docType !== 'credit_note' && doc.paidTotal + doc.creditedTotal > 0 && doc.status !== 'void') {
    totals.push([L.paid, money(doc.paidTotal + doc.creditedTotal)], [L.balance, money(doc.amountDue)]);
  }
  blocks.push(block('table', '', { rows: [['', ''], ...totals].map((r) => r.map(esc)) }));
  if (doc.notes) blocks.push(block('paragraph', `<b>${esc(L.notes)}</b><br>${esc(doc.notes).replace(/\n/g, '<br>')}`));
  if (doc.einvoice.status === 'authorized') {
    const data = doc.einvoice.data as { code?: string; expiresAt?: string; test?: boolean };
    blocks.push(block('paragraph', `<b>${esc(L.cae)}</b> ${esc(String(data.code ?? ''))}${data.expiresAt ? ` · ${esc(L.caeDue)} ${esc(String(data.expiresAt))}` : ''}${data.test ? `<br>${esc(L.test)}` : ''}`));
  }
  const title = `${L[doc.docType]} ${doc.numberLabel || ''}`.trim();
  return blocksToPdf(blocks, title, { footer: s.footer || s.trade_name || s.legal_name, imageFor: async (b) => (b.url === 'logo' ? logo : null) });
}

export async function documentPdfById(ws: string, id: string, locale = 'en'): Promise<{ pdf: Buffer; filename: string } | null> {
  const doc = await getDocument(ws, id);
  if (!doc) return null;
  const pdf = await documentPdf(ws, doc, locale);
  const name = (doc.numberLabel || doc.reference || doc.id).replace(/[^\w.-]+/g, '_');
  return { pdf, filename: `${name}.pdf` };
}
