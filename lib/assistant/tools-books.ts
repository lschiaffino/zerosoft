/**
 * Herramientas de Books para el asistente. Lectura: facturas (abiertas,
 * vencidas, por cliente), una factura, saldos por cobrar y pagar, y el
 * resultado de un período. Escritura (con confirmación): factura borrador,
 * enviar una factura y registrar un cobro. Mismas funciones que la app
 * (lib/books*.ts), con el rol de Books de la persona: sales no ve informes
 * ni compras.
 */
import { z } from 'zod';
import { booksActor, ensureBooks, listContacts, listTaxRates } from '../books';
import { can } from '../books-roles';
import { createDraft, getDocRow, getDocument, listDocuments, recordPayment } from '../books-docs';
import { sendDocument } from '../books-integrations';
import { aging, profitAndLoss } from '../books-reports';
import { formatMoney, parseAmount, todayIso } from '../books-money';
import type { BooksActor } from '../books-schema';
import { readTool, writeTool, type AssistantTool, type ToolCtx } from './registry';

const actorOf = (ctx: ToolCtx): Promise<BooksActor> => booksActor({ ws: ctx.workspaceId, person: ctx.personId, workspaceRole: ctx.user.role });

async function findInvoice(ws: string, ref: string) {
  const { items } = await listDocuments(ws, { docType: ['invoice', 'credit_note'], q: ref, limit: 5 });
  const exact = items.find((d) => d.numberLabel === ref || d.reference === ref);
  return exact ?? (items.length === 1 ? items[0] : null);
}

export const booksTools: AssistantTool[] = [
  readTool({
    name: 'books_invoices',
    app: 'books',
    description: 'List Books invoices, newest first. Filter by status (draft, sent, partial, paid, overdue, void, or "open" for anything not fully paid) and search by number, reference or customer name.',
    input: z.object({ status: z.enum(['draft', 'sent', 'partial', 'paid', 'overdue', 'void', 'open']).optional(), query: z.string().trim().max(200).optional() }),
    run: async (ctx, { status, query }) => {
      const actor = await actorOf(ctx);
      if (!can(actor.role, 'invoices.read')) return { error: 'forbidden' };
      const res = await listDocuments(ctx.workspaceId, { docType: 'invoice', status, q: query, limit: 25 });
      return {
        total: res.total,
        invoices: res.items.map((d) => ({
          number: d.numberLabel || '(draft)',
          reference: d.reference,
          customer: d.contactName,
          status: d.status,
          issueDate: d.issueDate,
          dueDate: d.dueDate,
          total: formatMoney(d.total, d.currency),
          amountDue: formatMoney(d.amountDue, d.currency),
          href: `/app/books/invoices/${d.id}`,
        })),
      };
    },
  }),
  readTool({
    name: 'books_invoice',
    app: 'books',
    description: 'One Books invoice by its number (e.g. "B 00001-00000012") or reference: lines, taxes, totals, payments and status.',
    input: z.object({ number: z.string().trim().min(1).max(60) }),
    run: async (ctx, { number }) => {
      const actor = await actorOf(ctx);
      if (!can(actor.role, 'invoices.read')) return { error: 'forbidden' };
      const hit = await findInvoice(ctx.workspaceId, number);
      const d = hit ? await getDocument(ctx.workspaceId, hit.id) : null;
      if (!d) return { error: 'not_found' };
      const m = (v: number) => formatMoney(v, d.currency);
      return {
        number: d.numberLabel || '(draft)',
        status: d.status,
        customer: d.contactName,
        issueDate: d.issueDate,
        dueDate: d.dueDate,
        lines: d.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: m(l.unitPrice), taxPercent: l.taxBps / 100, total: m(l.total) })),
        subtotal: m(d.subtotal),
        tax: m(d.taxTotal),
        total: m(d.total),
        paid: m(d.paidTotal + d.creditedTotal),
        amountDue: m(d.amountDue),
        payments: d.payments.map((p) => ({ date: p.date, amount: m(p.amount), method: p.method })),
        href: `/app/books/invoices/${d.id}`,
      };
    },
  }),
  readTool({
    name: 'books_balances',
    app: 'books',
    description: 'What customers owe (accounts receivable) and what the business owes suppliers (payables), by age bucket (current, 1-30, 31-60, 61-90, 90+ days overdue), with the top debtors.',
    input: z.object({}),
    run: async (ctx) => {
      const actor = await actorOf(ctx);
      const out: Record<string, unknown> = {};
      const fmt = (r: Awaited<ReturnType<typeof aging>>) => ({
        total: formatMoney(r.totals.total, r.currency),
        buckets: Object.fromEntries((['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const).map((b) => [b, formatMoney(r.totals[b], r.currency)])),
        top: r.rows.slice(0, 5).map((x) => ({ contact: x.contactName, owed: formatMoney(x.total, r.currency) })),
      });
      if (can(actor.role, 'invoices.read')) out.receivables = fmt(await aging(ctx.workspaceId, 'receivables'));
      if (can(actor.role, 'bills.read')) out.payables = fmt(await aging(ctx.workspaceId, 'payables'));
      return out;
    },
  }),
  readTool({
    name: 'books_profit_loss',
    app: 'books',
    description: 'Profit and loss for a period (dates YYYY-MM-DD; default: this month): income, cost of sales, expenses by account and net profit. Needs a Books role with reports (accountant or viewer).',
    input: z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
    run: async (ctx, { from, to }) => {
      const actor = await actorOf(ctx);
      if (!can(actor.role, 'reports.read')) return { error: 'forbidden', hint: 'Your Books role does not include reports.' };
      const today = todayIso();
      const r = await profitAndLoss(ctx.workspaceId, from ?? `${today.slice(0, 7)}-01`, to ?? today);
      const m = (v: number) => formatMoney(v, r.currency);
      return {
        from: r.from,
        to: r.to,
        income: m(r.totalIncome),
        costOfSales: m(r.totalCostOfSales),
        expenses: m(r.totalExpenses),
        netProfit: m(r.netProfit),
        byAccount: [...r.income, ...r.costOfSales, ...r.expenses].map((l) => ({ account: `${l.code} ${l.name}`, amount: m(l.amount) })),
        href: `/app/books/reports/pnl?from=${r.from}&to=${r.to}`,
      };
    },
  }),
  writeTool({
    name: 'propose_books_invoice',
    app: 'books',
    description:
      'Prepare a draft Books invoice for an existing customer (matched by name) with one or more lines (description, quantity, unit price in the base currency like 1500.50, optional tax percent like 21). It stays a draft until someone approves it. The person confirms first.',
    input: z.object({
      customer: z.string().trim().min(1).max(160),
      lines: z
        .array(z.object({ description: z.string().trim().min(1).max(500), quantity: z.number().positive().max(1_000_000).optional(), unitPrice: z.number().min(0).max(1_000_000_000), taxPercent: z.number().min(0).max(100).optional() }))
        .min(1)
        .max(30),
      reference: z.string().trim().max(120).optional(),
    }),
    prepare: async (ctx, input) => {
      const actor = await actorOf(ctx);
      if (!can(actor.role, 'invoices.write')) return { error: 'forbidden' };
      const s = await ensureBooks(ctx.workspaceId);
      const matches = await listContacts(ctx.workspaceId, { q: input.customer, kind: 'customer', limit: 5 });
      const contact = matches.find((c) => c.name.toLowerCase() === input.customer.toLowerCase()) ?? (matches.length === 1 ? matches[0] : null);
      if (!contact) return { error: matches.length ? 'ambiguous_customer' : 'customer_not_found', hint: { candidates: matches.map((c) => c.name) } };
      const taxes = await listTaxRates(ctx.workspaceId);
      const lines = input.lines.map((l) => {
        const tax = l.taxPercent === undefined ? (taxes.find((t) => t.is_default) ?? null) : (taxes.find((t) => t.rate_bps === Math.round(l.taxPercent! * 100)) ?? null);
        return { description: l.description, quantity: l.quantity ?? 1, unitPrice: parseAmount(l.unitPrice, s.base_currency) ?? 0, taxRateId: tax?.id ?? null, taxName: tax?.name ?? 'No tax' };
      });
      return {
        summary: `Draft invoice for ${contact.name}`,
        details: [
          { label: 'Customer', after: contact.name },
          ...lines.map((l, i) => ({ label: `Line ${i + 1}`, after: `${l.description} × ${l.quantity} @ ${formatMoney(l.unitPrice, s.base_currency)} (${l.taxName})` })),
          ...(input.reference ? [{ label: 'Reference', after: input.reference }] : []),
        ],
        input: { contactId: contact.id, reference: input.reference ?? '', lines: lines.map(({ taxName: _t, ...l }) => l) },
      };
    },
    execute: async (ctx, input) => {
      try {
        const actor = await actorOf(ctx);
        const doc = await createDraft(actor, { docType: 'invoice', contactId: String(input.contactId), reference: String(input.reference ?? ''), lines: input.lines as never });
        return { ok: true, message: `Draft invoice created for ${doc.contactName}.`, href: `/app/books/invoices/${doc.id}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'error' };
      }
    },
  }),
  writeTool({
    name: 'propose_books_send_invoice',
    app: 'books',
    description: 'Prepare sending a Books invoice by email to its customer (approving it first if it is a draft). The person confirms first.',
    input: z.object({ number: z.string().trim().min(1).max(60), to: z.string().trim().email().optional() }),
    prepare: async (ctx, input) => {
      const actor = await actorOf(ctx);
      if (!can(actor.role, 'invoices.write')) return { error: 'forbidden' };
      const hit = await findInvoice(ctx.workspaceId, input.number);
      const d = hit ? await getDocument(ctx.workspaceId, hit.id) : null;
      if (!d || d.docType !== 'invoice') return { error: 'not_found' };
      if (d.status === 'void') return { error: 'invalid_status' };
      const to = input.to ?? d.contactEmail;
      if (!to) return { error: 'email_required' };
      return {
        summary: `Send invoice ${d.numberLabel || d.reference || '(draft)'} to ${to}`,
        details: [
          { label: 'Customer', after: d.contactName },
          { label: 'Total', after: formatMoney(d.total, d.currency) },
          ...(d.status === 'draft' ? [{ label: 'Status', before: 'Draft', after: 'Approved and sent' }] : []),
        ],
        input: { id: d.id, to },
      };
    },
    execute: async (ctx, input) => {
      try {
        const d = await sendDocument(await actorOf(ctx), String(input.id), { to: String(input.to), locale: ctx.locale });
        return { ok: true, message: `Invoice ${d.numberLabel} sent.`, href: `/app/books/invoices/${d.id}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'error' };
      }
    },
  }),
  writeTool({
    name: 'propose_books_payment',
    app: 'books',
    description: 'Prepare recording a payment received for a Books invoice (amount in the invoice currency, e.g. 1500.50; date YYYY-MM-DD, default today; method bank, cash, card or other). The person confirms first.',
    input: z.object({
      number: z.string().trim().min(1).max(60),
      amount: z.number().positive().max(1_000_000_000),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      method: z.enum(['bank', 'cash', 'card', 'other']).optional(),
    }),
    prepare: async (ctx, input) => {
      const actor = await actorOf(ctx);
      if (!can(actor.role, 'invoices.write')) return { error: 'forbidden' };
      const hit = await findInvoice(ctx.workspaceId, input.number);
      const d = hit ? await getDocRow(ctx.workspaceId, hit.id) : null;
      if (!d || d.doc_type !== 'invoice') return { error: 'not_found' };
      if (!['sent', 'partial', 'overdue'].includes(d.status)) return { error: 'invalid_status', hint: { status: d.status } };
      const amount = parseAmount(input.amount, d.currency) ?? 0;
      const due = d.total - d.paid_total - d.credited_total;
      if (amount > due) return { error: 'amount_exceeds_due', hint: { due: formatMoney(due, d.currency) } };
      return {
        summary: `Record ${formatMoney(amount, d.currency)} for ${d.number_label}`,
        details: [
          { label: 'Invoice', after: d.number_label },
          { label: 'Amount due', before: formatMoney(due, d.currency), after: formatMoney(due - amount, d.currency) },
          { label: 'Date', after: input.date ?? todayIso() },
          { label: 'Method', after: input.method ?? 'bank' },
        ],
        input: { id: d.id, amount, date: input.date ?? todayIso(), method: input.method ?? 'bank' },
      };
    },
    execute: async (ctx, input) => {
      try {
        const res = await recordPayment(await actorOf(ctx), String(input.id), { amount: Number(input.amount), date: String(input.date), method: input.method as 'bank' });
        return { ok: true, message: `Payment recorded. ${res.doc.status === 'paid' ? 'The invoice is paid.' : `Still due: ${formatMoney(res.doc.amountDue, res.doc.currency)}.`}`, href: `/app/books/invoices/${res.doc.id}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'error' };
      }
    },
  }),
];
