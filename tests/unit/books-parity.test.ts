import { describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import { convert, docTotals, endOfMonth, fiscalYearStart, lineAmounts, mulDiv, toDecimalString } from '@/lib/books-money';
import { accountByKey, createContact, createItem, ensureBooks, listAccounts, listTaxRates, setRole, updateSettings } from '@/lib/books';
import { approveDocument, createCreditNote, createDraft, deletePayment, getDocument, recordPayment, voidDocument } from '@/lib/books-docs';
import { aging, balanceSheet, budgetVariance, comparePeriod, generalLedger, profitAndLoss, salesByItem, taxReport, trialBalance, csvCell } from '@/lib/books-reports';
import { deleteBatch, getBatch, listBatches, recordBatchPayment } from '@/lib/books-batch';
import { contactByPortalToken, contactStatement, setPortal } from '@/lib/books-statements';
import { createQuote, decideQuote, deleteQuote, effectiveQuoteStatus, getQuote, quoteByToken, quoteToInvoice, sendQuote, updateQuote } from '@/lib/books-quotes';
import { applyRules, createRule, createTransfer, firstRule, ruleMatches, ruleSuggestions } from '@/lib/books-bankrules';
import { createBankAccount, importStatement, listTxns, reconcile, unreconcile, suggestions } from '@/lib/books-bank';
import { accumulatedAt, createAsset, createOpeningBalances, depreciationPreview, disposeAsset, getAsset, listTracking, rollbackDepreciation, runDepreciation, saveBudget, saveTrackingCategory, saveTrackingOption, updateAsset } from '@/lib/books-accounting';
import { createExpense, postExpense } from '@/lib/books-purchasing';
import { importContactsCsv, importItemsCsv, parseCsvTable, contactsCsv } from '@/lib/books-import';
import { createRecurring, runRecurring } from '@/lib/books-recurring';
import { assertBooksMailAllowed, BOOKS_MAIL_LIMITS, freeTextAllowed } from '@/lib/books-mail-guard';
import { sendDocument } from '@/lib/books-integrations';
import { searchBooks } from '@/lib/books-search';
import { BooksError, type BooksActor } from '@/lib/books-schema';

const uid = () => Math.random().toString(36).slice(2, 10);

async function workspace(country: 'AR' | 'MX' | 'generic' = 'generic', base?: string): Promise<BooksActor> {
  const u = await upsertUser({ email: `bkp-${uid()}@example.com`, name: 'Owner', image: null });
  await ensureBooks(u.id, { country });
  const actor: BooksActor = { ws: u.id, person: u.id, admin: true, role: 'accountant' };
  if (base) await updateSettings(actor, { baseCurrency: base });
  return actor;
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof BooksError && e.code === code);
}

/** Saldo de una cuenta en el libro, debe − haber. */
async function ledger(ws: string, key: 'ar' | 'ap' | 'fx' | 'retained' | 'bank' | 'sales'): Promise<number> {
  const acc = await accountByKey(ws, key);
  const r = (await getDb().prepare('SELECT COALESCE(SUM(debit - credit), 0) AS v FROM books_journal_lines WHERE account_id = ?').get(acc.id)) as { v: number };
  return Number(r.v);
}

async function allBalanced(ws: string): Promise<void> {
  const rows = (await getDb().prepare('SELECT j.id, SUM(l.debit) AS d, SUM(l.credit) AS c FROM books_journals j JOIN books_journal_lines l ON l.journal_id = j.id WHERE j.workspace_id = ? GROUP BY j.id').all(ws)) as Array<{ d: number; c: number }>;
  for (const r of rows) expect(Number(r.d)).toBe(Number(r.c));
}

async function invoice(a: BooksActor, opts: { contactId: string; date?: string; currency?: string; fxRate?: string; taxInclusive?: boolean; lines: Array<{ description: string; unitPrice: number; quantity?: number; taxRateId?: string | null; discountBps?: number; trackingA?: string | null }> }) {
  const d = await createDraft(a, { docType: 'invoice', contactId: opts.contactId, issueDate: opts.date, currency: opts.currency, fxRate: opts.fxRate, taxInclusive: opts.taxInclusive, lines: opts.lines });
  return approveDocument(a, d.id);
}

const customer = async (a: BooksActor, name = 'Cliente') => (await createContact(a, { name, kind: 'customer', email: `${uid()}@example.com` }, { syncCrm: false })).id;
const supplier = async (a: BooksActor, name = 'Proveedor') => (await createContact(a, { name, kind: 'supplier' }, { syncCrm: false })).id;

describe('Books dinero: exacto al centavo', () => {
  it('convierte multiplicando antes de redondear', () => {
    // USD 12,34 a 900 son CLP 11.106: redondear primero daba 12 × 900 = 10.800.
    expect(convert(1234, 'USD', '900', 'CLP')).toBe(11106);
    // KWD tiene 3 decimales: 1,234 KWD a 3,25 son USD 4,01 (4,0105).
    expect(convert(1234, 'KWD', '3.25', 'USD')).toBe(401);
    // CLP a USD sigue bien.
    expect(convert(15990, 'CLP', '0.00105', 'USD')).toBe(1679);
    // Mitad lejos del cero, también en negativo.
    expect(convert(1, 'USD', '1.5', 'EUR')).toBe(2);
    expect(convert(-1, 'USD', '1.5', 'EUR')).toBe(-2);
    expect(convert(1999, 'ARS', '1', 'ARS')).toBe(1999);
  });

  it('mulDiv no pierde precisión arriba de 2^53', () => {
    expect(mulDiv(9_999_999_999_999, 2100, 10_000)).toBe(2_100_000_000_000);
    expect(mulDiv(5, 1, 10)).toBe(1);
    expect(mulDiv(-5, 1, 10)).toBe(-1);
    expect(mulDiv(4, 1, 10)).toBe(0);
  });

  it('una línea grande con cantidad fraccionaria da el importe exacto', () => {
    // 1,2345 × 9.999.999.999,99: en float el error ya se ve en los centavos.
    const a = lineAmounts({ quantity: 1.2345, unitPrice: 999_999_999_999, taxBps: 2100 });
    expect(a.gross).toBe(1_234_499_999_999);
    expect(a.tax).toBe(259_245_000_000);
    expect(a.total).toBe(a.net + a.tax);
  });

  it('precio con impuesto incluido', () => {
    const a = lineAmounts({ quantity: 1, unitPrice: 12100, taxBps: 2100, taxInclusive: true });
    expect(a).toMatchObject({ net: 10000, tax: 2100, total: 12100 });
    const b = lineAmounts({ quantity: 1, unitPrice: 10000, taxBps: 2100, taxInclusive: true });
    expect(b).toMatchObject({ net: 8264, tax: 1736, total: 10000 });
    // Descuento sobre el precio con impuesto: el total es lo que el cliente paga.
    const c = lineAmounts({ quantity: 2, unitPrice: 12100, discountBps: 1000, taxBps: 2100, taxInclusive: true });
    expect(c.total).toBe(21780);
    expect(c.net + c.tax).toBe(21780);
    expect(c.gross - c.discount).toBe(c.net);
  });

  it('los totales con impuesto incluido suman lo mismo por los dos caminos', () => {
    const t = docTotals(
      [
        { quantity: 3, unitPrice: 333, taxBps: 2100 },
        { quantity: 1, unitPrice: 999, taxBps: 1050 },
        { quantity: 1, unitPrice: 501, taxBps: 0 },
      ],
      true,
    );
    expect(t.total).toBe(999 + 999 + 501);
    expect(t.subtotal - t.discountTotal + t.taxTotal).toBe(t.total);
  });

  it('fechas de ejercicio', () => {
    expect(fiscalYearStart('2026-03-15', 7)).toBe('2025-07-01');
    expect(fiscalYearStart('2026-07-01', 7)).toBe('2026-07-01');
    expect(fiscalYearStart('2026-01-01', 1)).toBe('2026-01-01');
    expect(endOfMonth('2024-02')).toBe('2024-02-29');
    expect(comparePeriod('2026-03-01', '2026-03-31', 'prev')).toEqual({ from: '2026-01-29', to: '2026-02-28' });
    expect(comparePeriod('2024-02-29', '2024-02-29', 'year')).toEqual({ from: '2023-02-28', to: '2023-02-28' });
  });

  it('csv sin fórmulas y con números negativos intactos', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-12.50')).toBe('-12.50');
    expect(csvCell('@cmd')).toBe("'@cmd");
  });
});

describe('Books libro: el saldo y la cuenta coinciden', () => {
  it('factura en moneda extranjera con redondeos por línea deja deudores en cero al cobrarse', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    // Dos líneas de 0,33 a 1,5: por línea 0,50 + 0,50 = 1,00; el total 0,66 convierte a 0,99.
    const d = await invoice(a, { contactId: c, currency: 'EUR', fxRate: '1.5', date: '2026-02-01', lines: [{ description: 'A', unitPrice: 33 }, { description: 'B', unitPrice: 33 }] });
    expect(await ledger(a.ws, 'ar')).toBe(99);
    await recordPayment(a, d.id, { amount: 66, date: '2026-02-02' });
    expect(await ledger(a.ws, 'ar')).toBe(0);
    await allBalanced(a.ws);
    expect((await balanceSheet(a.ws, '2026-02-28')).difference).toBe(0);
  });

  it('tres cobros parciales de un centavo no dejan un centavo suelto', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    const d = await invoice(a, { contactId: c, currency: 'EUR', fxRate: '1.5', date: '2026-02-01', lines: [{ description: 'A', unitPrice: 3 }] });
    expect(await ledger(a.ws, 'ar')).toBe(5); // 4,5 → 5
    const ar = async () => (await aging(a.ws, 'receivables', '2026-12-31')).totals.total;
    expect(await ar()).toBe(5);
    await recordPayment(a, d.id, { amount: 1, date: '2026-02-02' });
    expect(await ledger(a.ws, 'ar')).toBe(await ar());
    await recordPayment(a, d.id, { amount: 1, date: '2026-02-03' });
    expect(await ledger(a.ws, 'ar')).toBe(await ar());
    await recordPayment(a, d.id, { amount: 1, date: '2026-02-04' });
    expect(await ledger(a.ws, 'ar')).toBe(0);
    expect(await ar()).toBe(0);
    await allBalanced(a.ws);
  });

  it('borrar un cobro y volver a cobrar sigue cerrando en cero', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    const d = await invoice(a, { contactId: c, currency: 'EUR', fxRate: '1.5', date: '2026-02-01', lines: [{ description: 'A', unitPrice: 3 }] });
    const first = await recordPayment(a, d.id, { amount: 1, date: '2026-02-02' });
    await recordPayment(a, d.id, { amount: 2, date: '2026-02-03' });
    await deletePayment(a, first.paymentId);
    await recordPayment(a, d.id, { amount: 1, date: '2026-02-04' });
    expect(await ledger(a.ws, 'ar')).toBe(0);
    await allBalanced(a.ws);
  });

  it('nota de crédito y cobro, en cualquier orden, cierran deudores', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    const d1 = await invoice(a, { contactId: c, currency: 'EUR', fxRate: '1.5', date: '2026-02-01', lines: [{ description: 'A', unitPrice: 2 }, { description: 'B', unitPrice: 1 }] });
    const cn = await createCreditNote(a, d1.id, { lines: [{ description: 'B', unitPrice: 1, quantity: 1 }] });
    await approveDocument(a, cn.id);
    await recordPayment(a, d1.id, { amount: 2, date: '2026-02-05' });
    expect((await getDocument(a.ws, d1.id))!.status).toBe('paid');
    expect(await ledger(a.ws, 'ar')).toBe(0);

    const d2 = await invoice(a, { contactId: c, currency: 'EUR', fxRate: '1.5', date: '2026-02-01', lines: [{ description: 'A', unitPrice: 3 }] });
    await recordPayment(a, d2.id, { amount: 2, date: '2026-02-05' });
    const cn2 = await createCreditNote(a, d2.id, { lines: [{ description: 'A', unitPrice: 1, quantity: 1 }] });
    await approveDocument(a, cn2.id);
    expect((await getDocument(a.ws, d2.id))!.status).toBe('paid');
    expect(await ledger(a.ws, 'ar')).toBe(0);
    await allBalanced(a.ws);
  });

  it('factura de proveedor en moneda extranjera con diferencia de cambio: proveedores en cero y la diferencia en su cuenta', async () => {
    const a = await workspace('generic', 'USD');
    const s = await supplier(a);
    const d = await createDraft(a, { docType: 'bill', contactId: s, reference: 'F-1', issueDate: '2026-02-01', currency: 'EUR', fxRate: '1.1', lines: [{ description: 'X', unitPrice: 10000 }] });
    await approveDocument(a, d.id);
    expect(await ledger(a.ws, 'ap')).toBe(-11000);
    await recordPayment(a, d.id, { amount: 10000, date: '2026-02-10', fxRate: '1.2' });
    expect(await ledger(a.ws, 'ap')).toBe(0);
    expect(await ledger(a.ws, 'fx')).toBe(1000); // pagar más caro es pérdida (saldo deudor)
    await allBalanced(a.ws);
  });

  it('impuesto incluido llega igual al libro, al informe y a la nota de crédito', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    const rate = (await saveTax(a, 2100)).id;
    const d = await invoice(a, { contactId: c, date: '2026-03-01', taxInclusive: true, lines: [{ description: 'Consumidor', unitPrice: 12100, taxRateId: rate }] });
    expect(d.total).toBe(12100);
    expect(d.taxTotal).toBe(2100);
    expect(d.taxInclusive).toBe(true);
    expect(d.taxBreakdown.find((x) => x.taxBps === 2100)).toMatchObject({ net: 10000, tax: 2100 });
    const tax = await taxReport(a.ws, '2026-03-01', '2026-03-31');
    expect(tax.totals).toMatchObject({ salesNet: 10000, salesTax: 2100 });
    expect((await profitAndLoss(a.ws, '2026-03-01', '2026-03-31')).totalIncome).toBe(10000);
    const cn = await createCreditNote(a, d.id);
    expect(cn.taxInclusive).toBe(true);
    expect(cn.total).toBe(12100);
    await approveDocument(a, cn.id);
    expect((await profitAndLoss(a.ws, '2026-03-01', '2099-12-31')).totalIncome).toBe(0);
    expect(await ledger(a.ws, 'ar')).toBe(0);
  });

  it('una línea con importe negativo baja el total y el asiento sigue balanceando', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    const d = await createDraft(a, { docType: 'invoice', contactId: c, issueDate: '2026-03-01', lines: [{ description: 'Venta', unitPrice: 10000 }, { description: 'Bonificación', unitPrice: -2500 }] }, {}, { allowNegativeLines: true });
    const ok = await approveDocument(a, d.id);
    expect(ok.total).toBe(7500);
    expect(await ledger(a.ws, 'ar')).toBe(7500);
    expect(await ledger(a.ws, 'sales')).toBe(-7500);
    await allBalanced(a.ws);
  });

  it('moneda sin decimales: CLP de base con factura en USD', async () => {
    const a = await workspace('generic', 'CLP');
    const c = await customer(a);
    const d = await invoice(a, { contactId: c, currency: 'USD', fxRate: '950.5', date: '2026-03-01', lines: [{ description: 'A', unitPrice: 1999 }] });
    // USD 19,99 × 950,5 = 19.000,495 → 19.000
    expect(await ledger(a.ws, 'ar')).toBe(19000);
    await recordPayment(a, d.id, { amount: 1999, date: '2026-03-02' });
    expect(await ledger(a.ws, 'ar')).toBe(0);
    expect(toDecimalString(19000, 'CLP')).toBe('19000');
  });
});

async function saveTax(a: BooksActor, bps: number) {
  const { saveTaxRate } = await import('@/lib/books');
  return saveTaxRate(a, { name: `T${bps}`, rateBps: bps });
}

describe('Books cierre de período', () => {
  it('nada entra ni sale de un período cerrado, y lo cerrado no cambia', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    const d = await invoice(a, { contactId: c, date: '2026-01-15', lines: [{ description: 'A', unitPrice: 10000 }] });
    const pay = await recordPayment(a, d.id, { amount: 4000, date: '2026-01-20' });
    const before = await profitAndLoss(a.ws, '2026-01-01', '2026-01-31');
    const agedBefore = (await aging(a.ws, 'receivables', '2026-01-31')).totals.total;
    await updateSettings(a, { lockDate: '2026-01-31' });

    const draft = await createDraft(a, { docType: 'invoice', contactId: c, issueDate: '2026-01-20', lines: [{ description: 'B', unitPrice: 500 }] });
    await expectCode(approveDocument(a, draft.id), 'period_locked');
    await expectCode(recordPayment(a, d.id, { amount: 100, date: '2026-01-31' }), 'period_locked');
    await expectCode(deletePayment(a, pay.paymentId), 'period_locked');
    const e = await createExpense(a, { date: '2026-01-05', total: 1000, vendor: 'V' });
    await expectCode(postExpense(a, e.id), 'period_locked');
    await expectCode(createOpeningBalances(a, { date: '2026-01-01', lines: [{ accountId: (await accountByKey(a.ws, 'bank')).id, debit: 100 }] }), 'period_locked');

    // El día siguiente al cierre sí entra.
    const ok = await recordPayment(a, d.id, { amount: 1000, date: '2026-02-01' });
    expect(ok.doc.paidTotal).toBe(5000);

    expect((await profitAndLoss(a.ws, '2026-01-01', '2026-01-31')).netProfit).toBe(before.netProfit);
    expect((await aging(a.ws, 'receivables', '2026-01-31')).totals.total).toBe(agedBefore);
    await allBalanced(a.ws);
  });

  it('anular algo de un período cerrado revierte hoy y el período cerrado queda igual', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    const d = await invoice(a, { contactId: c, date: '2026-01-15', lines: [{ description: 'A', unitPrice: 10000 }] });
    await updateSettings(a, { lockDate: '2026-01-31' });
    await voidDocument(a, d.id, 'error');
    expect((await profitAndLoss(a.ws, '2026-01-01', '2026-01-31')).netProfit).toBe(10000);
    expect((await aging(a.ws, 'receivables', '2026-01-31')).totals.total).toBe(10000);
    expect(await ledger(a.ws, 'ar')).toBe(0);
  });

  it('el balance separa resultado del ejercicio y de ejercicios anteriores según el mes de arranque', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    await updateSettings(a, { fiscalStartMonth: 7 });
    await invoice(a, { contactId: c, date: '2025-06-30', lines: [{ description: 'Viejo', unitPrice: 1000 }] });
    await invoice(a, { contactId: c, date: '2025-07-01', lines: [{ description: 'Nuevo', unitPrice: 2500 }] });
    const bs = await balanceSheet(a.ws, '2025-12-31');
    expect(bs.priorEarnings).toBe(1000);
    expect(bs.currentEarnings).toBe(2500);
    expect(bs.totalEquity).toBe(3500);
    expect(bs.difference).toBe(0);
    const tb = await trialBalance(a.ws, '2025-12-31');
    expect(tb.yearStart).toBe('2025-07-01');
    expect(tb.priorEarnings).toBe(1000);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.totalDebit).toBe(3500);
    // Al pasar el año fiscal, todo lo de antes es de ejercicios anteriores.
    const next = await balanceSheet(a.ws, '2026-07-01');
    expect(next.priorEarnings).toBe(3500);
    expect(next.currentEarnings).toBe(0);
  });
});

describe('Books informes', () => {
  it('sumas y saldos, mayor y ventas por ítem cuadran con los documentos', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    const item = await createItem(a, { name: 'Consultoría', kind: 'service', price: '100' });
    const d = await invoice(a, { contactId: c, date: '2026-04-10', lines: [{ description: 'x', unitPrice: 10000, quantity: 2 }] });
    const withItem = await createDraft(a, { docType: 'invoice', contactId: c, issueDate: '2026-04-12', lines: [{ itemId: item.id, quantity: 1.5 }] });
    await approveDocument(a, withItem.id);
    await recordPayment(a, d.id, { amount: 5000, date: '2026-04-20' });
    const voided = await invoice(a, { contactId: c, date: '2026-04-13', lines: [{ description: 'anulada', unitPrice: 999 }] });
    await voidDocument(a, voided.id);

    const tb = await trialBalance(a.ws, '2026-12-31');
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.rows.find((r) => r.accountId === null)).toBeUndefined();

    const gl = await generalLedger(a.ws, '2026-04-01', '2026-04-30');
    const ar = await accountByKey(a.ws, 'ar');
    const arLedger = gl.accounts.find((x) => x.accountId === ar.id)!;
    expect(arLedger.opening).toBe(0);
    expect(arLedger.entries.map((e) => e.date)).toEqual([...arLedger.entries.map((e) => e.date)].sort());
    expect(arLedger.entries[arLedger.entries.length - 1].balance).toBe(arLedger.closing);
    // 200 + 150 + 9,99 (anulada, se revierte con la fecha de hoy, fuera del período) − 50
    expect(arLedger.closing).toBe(20000 + 15000 + 999 - 5000);

    const may = await generalLedger(a.ws, '2026-05-01', '2026-05-31', { accountId: ar.id });
    expect(may.accounts[0].opening).toBe(arLedger.closing);

    const sales = await salesByItem(a.ws, '2026-04-01', '2026-04-30');
    expect(sales.total).toBe(35000);
    expect(sales.rows.find((r) => r.itemId === item.id)).toMatchObject({ quantity: 1.5, net: 15000 });
    expect(sales.rows.some((r) => r.name === 'anulada')).toBe(false);
  });

  it('presupuesto contra real con el signo correcto', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    await invoice(a, { contactId: c, date: '2026-05-10', lines: [{ description: 'x', unitPrice: 12000 }] });
    const e = await createExpense(a, { date: '2026-05-11', total: 3000, vendor: 'V' });
    await postExpense(a, e.id);
    const sales = await accountByKey(a.ws, 'sales');
    const exp = await accountByKey(a.ws, 'expense');
    const b = await saveBudget(a, { name: 'FY', startMonth: '2026-01', months: 12, lines: [{ accountId: sales.id, month: '2026-05', amount: 10000 }, { accountId: exp.id, month: '2026-05', amount: 5000 }, { accountId: exp.id, month: '2026-06', amount: 7777 }] });
    const r = (await budgetVariance(a.ws, b.id, '2026-05-01', '2026-05-31'))!;
    expect(r.rows.find((x) => x.accountId === sales.id)).toMatchObject({ budget: 10000, actual: 12000, variance: 2000 });
    expect(r.rows.find((x) => x.accountId === exp.id)).toMatchObject({ budget: 5000, actual: 3000, variance: 2000 });
    expect(r.netBudget).toBe(5000);
    expect(r.netActual).toBe(9000);
    await expectCode(saveBudget(a, { name: 'x', startMonth: '2026-01', months: 2, lines: [{ accountId: sales.id, month: '2026-05', amount: 1 }] }), 'invalid_date');
    const ar = await accountByKey(a.ws, 'ar');
    await expectCode(saveBudget(a, { name: 'x', startMonth: '2026-01', lines: [{ accountId: ar.id, month: '2026-01', amount: 1 }] }), 'invalid_account');
    // Otro workspace no ve el presupuesto.
    const other = await workspace('generic', 'USD');
    expect(await budgetVariance(other.ws, b.id, '2026-05-01', '2026-05-31')).toBeNull();
  });

  it('centros de costo filtran el estado de resultados y no aceptan opciones ajenas', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    const cats = await saveTrackingCategory(a, { slot: 'a', name: 'Sucursal' });
    const withOpts = await saveTrackingOption(a, { categoryId: cats[0].id, name: 'Norte' });
    const norte = withOpts[0].options[0].id;
    await invoice(a, { contactId: c, date: '2026-06-01', lines: [{ description: 'n', unitPrice: 7000, trackingA: norte }, { description: 's', unitPrice: 3000 }] });
    expect((await profitAndLoss(a.ws, '2026-06-01', '2026-06-30')).totalIncome).toBe(10000);
    expect((await profitAndLoss(a.ws, '2026-06-01', '2026-06-30', { tracking: norte })).totalIncome).toBe(7000);
    const other = await workspace('generic', 'USD');
    const oc = await customer(other);
    await expectCode(createDraft(other, { docType: 'invoice', contactId: oc, lines: [{ description: 'x', unitPrice: 1, trackingA: norte }] }), 'invalid_tracking');
    expect((await listTracking(other.ws)).length).toBe(0);
    await expectCode(saveTrackingCategory(a, { slot: 'a', name: '' }), 'tracking_in_use');
  });
});

describe('Books cobros por lote', () => {
  it('un asiento, un total de banco, y todo o nada', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    const bank = await createBankAccount(a, { name: 'Main' });
    const d1 = await invoice(a, { contactId: c, date: '2026-07-01', lines: [{ description: 'a', unitPrice: 10000 }] });
    const d2 = await invoice(a, { contactId: c, date: '2026-07-01', lines: [{ description: 'b', unitPrice: 5000 }] });

    // Un documento se pasa del saldo: no se registra ninguno.
    await expectCode(recordBatchPayment(a, { docType: 'invoice', bankAccountId: bank.id, date: '2026-07-05', allocations: [{ docId: d1.id, amount: 10000 }, { docId: d2.id, amount: 5001 }] }), 'amount_exceeds_due');
    expect((await getDocument(a.ws, d1.id))!.paidTotal).toBe(0);
    expect(await ledger(a.ws, 'ar')).toBe(15000);

    const b = await recordBatchPayment(a, { docType: 'invoice', bankAccountId: bank.id, date: '2026-07-05', reference: 'DEP-1', allocations: [{ docId: d1.id, amount: 10000 }, { docId: d2.id, amount: 2000 }] });
    expect(b).toMatchObject({ total: 12000, count: 2, reference: 'DEP-1' });
    expect((await getDocument(a.ws, d1.id))!.status).toBe('paid');
    expect((await getDocument(a.ws, d2.id))!.status).toBe('partial');
    expect(await ledger(a.ws, 'ar')).toBe(3000);
    const journals = (await getDb().prepare("SELECT COUNT(*) AS n FROM books_journals WHERE workspace_id = ? AND source_type = 'batch'").get(a.ws)) as { n: number };
    expect(Number(journals.n)).toBe(1);
    const bankBal = (await getDb().prepare('SELECT SUM(debit - credit) AS v FROM books_journal_lines WHERE account_id = ?').get(bank.accountId)) as { v: number };
    expect(Number(bankBal.v)).toBe(12000);

    // Un pago del lote no se borra suelto.
    const pay = (await getDocument(a.ws, d1.id))!.payments[0];
    await expectCode(deletePayment(a, pay.id), 'payment_in_batch');

    // La línea del extracto concilia contra el lote entero, sin otro asiento.
    await deleteBatch(a, b.id);
    expect((await getDocument(a.ws, d1.id))!.amountDue).toBe(10000);
    expect((await getDocument(a.ws, d2.id))!.status).toBe('sent');
    expect(await ledger(a.ws, 'ar')).toBe(15000);
    expect(await getBatch(a.ws, b.id)).toBeNull();
    await allBalanced(a.ws);
  });

  it('moneda extranjera con otro tipo de cambio: la diferencia va a su cuenta y deudores cierra', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    const bank = await createBankAccount(a, { name: 'Main' });
    const d1 = await invoice(a, { contactId: c, date: '2026-07-01', currency: 'EUR', fxRate: '1.5', lines: [{ description: 'a', unitPrice: 3 }] });
    const d2 = await invoice(a, { contactId: c, date: '2026-07-01', currency: 'EUR', fxRate: '1.5', lines: [{ description: 'b', unitPrice: 3 }] });
    await recordBatchPayment(a, { docType: 'invoice', bankAccountId: bank.id, date: '2026-07-05', fxRate: '2', allocations: [{ docId: d1.id, amount: 3 }, { docId: d2.id, amount: 3 }] });
    expect(await ledger(a.ws, 'ar')).toBe(0);
    expect(await ledger(a.ws, 'fx')).toBe(-2); // 12 cobrado contra 10 registrado: ganancia
    await allBalanced(a.ws);
    const eur = await invoice(a, { contactId: c, date: '2026-07-01', currency: 'EUR', fxRate: '1.5', lines: [{ description: 'c', unitPrice: 3 }] });
    const usd = await invoice(a, { contactId: c, date: '2026-07-01', lines: [{ description: 'd', unitPrice: 3 }] });
    await expectCode(recordBatchPayment(a, { docType: 'invoice', bankAccountId: bank.id, date: '2026-07-05', allocations: [{ docId: eur.id, amount: 3 }, { docId: usd.id, amount: 3 }] }), 'currency_mismatch');
  });

  it('roles: ventas no ve ni paga lotes de compras, lectura no registra', async () => {
    const a = await workspace('generic', 'USD');
    const s = await supplier(a);
    const bank = await createBankAccount(a, { name: 'Main' });
    const bill = await createDraft(a, { docType: 'bill', contactId: s, reference: 'B1', issueDate: '2026-07-01', lines: [{ description: 'x', unitPrice: 100 }] });
    await approveDocument(a, bill.id);
    const batch = await recordBatchPayment(a, { docType: 'bill', bankAccountId: bank.id, date: '2026-07-02', allocations: [{ docId: bill.id, amount: 100 }] });
    const sales: BooksActor = { ...a, person: 'p', admin: false, role: 'sales' };
    const viewer: BooksActor = { ...a, person: 'v', admin: false, role: 'viewer' };
    await expectCode(recordBatchPayment(sales, { docType: 'bill', bankAccountId: bank.id, allocations: [{ docId: bill.id, amount: 1 }] }), 'forbidden');
    await expectCode(deleteBatch(sales, batch.id), 'forbidden');
    await expectCode(recordBatchPayment(viewer, { docType: 'invoice', bankAccountId: bank.id, allocations: [{ docId: bill.id, amount: 1 }] }), 'forbidden');
    expect(await listBatches(a.ws, ['invoice'])).toHaveLength(0);
    expect(await listBatches(a.ws, [])).toHaveLength(0);
    const other = await workspace('generic', 'USD');
    await expectCode(deleteBatch(other, batch.id), 'not_found');
  });
});

describe('Books estado de cuenta y portal', () => {
  it('el saldo final coincide con lo que debe el cliente', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a, 'Acme');
    const otherC = await customer(a, 'Otro');
    const d1 = await invoice(a, { contactId: c, date: '2026-01-10', lines: [{ description: 'a', unitPrice: 10000 }] });
    await invoice(a, { contactId: c, date: '2026-03-10', lines: [{ description: 'b', unitPrice: 5000 }] });
    await invoice(a, { contactId: otherC, date: '2026-03-11', lines: [{ description: 'ajena', unitPrice: 777 }] });
    const voided = await invoice(a, { contactId: c, date: '2026-03-12', lines: [{ description: 'nula', unitPrice: 111 }] });
    await voidDocument(a, voided.id);
    await recordPayment(a, d1.id, { amount: 4000, date: '2026-02-01' });
    const st = await contactStatement(a.ws, c, '2026-02-15', '2026-12-31');
    const usd = st.currencies[0];
    expect(usd.opening).toBe(6000);
    expect(usd.closing).toBe(11000);
    expect(usd.entries.map((e) => e.balance)).toEqual([11000]);
    expect(usd.outstanding.reduce((a2, d) => a2 + d.due, 0)).toBe(11000);
    const aged = await aging(a.ws, 'receivables', '2026-12-31');
    expect(aged.rows.find((r) => r.contactId === c)!.total).toBe(usd.closing);
    expect(JSON.stringify(st)).not.toContain('ajena');
  });

  it('separa por moneda, y una nota sin aplicar queda como crédito', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    const inv = await invoice(a, { contactId: c, date: '2026-01-10', lines: [{ description: 'a', unitPrice: 1000 }] });
    await invoice(a, { contactId: c, date: '2026-01-11', currency: 'EUR', fxRate: '1.1', lines: [{ description: 'e', unitPrice: 2000 }] });
    await recordPayment(a, inv.id, { amount: 1000, date: '2026-01-12' });
    const cn = await createDraft(a, { docType: 'credit_note', contactId: c, issueDate: '2026-01-13', lines: [{ description: 'cred', unitPrice: 300 }] });
    await approveDocument(a, cn.id);
    const st = await contactStatement(a.ws, c, '2026-01-01', '2026-12-31');
    expect(st.currencies.map((x) => [x.currency, x.closing])).toEqual([['EUR', 2000], ['USD', -300]]);
  });

  it('el portal se revoca en el acto y no cruza workspaces', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    const p = await setPortal(a, c, 'enable');
    expect(p.token).toBeTruthy();
    expect((await contactByPortalToken(p.token!))!.ws).toBe(a.ws);
    const again = await setPortal(a, c, 'enable');
    expect(await contactByPortalToken(p.token!)).toBeNull();
    await setPortal(a, c, 'revoke');
    expect(await contactByPortalToken(again.token!)).toBeNull();
    expect(await contactByPortalToken("x' OR 1=1")).toBeNull();
    const other = await workspace('generic', 'USD');
    await expectCode(setPortal(other, c, 'enable'), 'not_found');
    await expectCode(setPortal({ ...a, role: 'viewer', admin: false }, c, 'enable'), 'forbidden');
  });
});

describe('Books presupuestos', () => {
  it('borrador → publicado → aceptado → factura, una sola vez y sin tocar el libro', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    const rate = (await saveTax(a, 2100)).id;
    const q = await createQuote(a, { contactId: c, title: 'Obra', issueDate: '2026-01-05', expiryDate: '2099-01-01', taxInclusive: true, lines: [{ description: 'x', unitPrice: 12100, taxRateId: rate }] });
    expect(q).toMatchObject({ status: 'draft', total: 12100, taxTotal: 2100, label: '' });
    expect(await quoteByToken('nada')).toBeNull();
    const sent = await sendQuote(a, q.id);
    expect(sent.status).toBe('sent');
    expect(sent.label).toBe('Q-000001');
    const token = sent.publicToken!;
    expect((await quoteByToken(token))!.quote.id).toBe(q.id);
    await expectCode(decideQuote(token, 'accepted', '  '), 'name_required');
    await expectCode(updateQuote(a, q.id, { terms: 'x' }), 'document_posted');
    const accepted = await decideQuote(token, 'accepted', 'Ana');
    expect(accepted).toMatchObject({ status: 'accepted', decidedName: 'Ana' });
    await expectCode(decideQuote(token, 'declined', ''), 'quote_decided');
    const journals = (await getDb().prepare('SELECT COUNT(*) AS n FROM books_journals WHERE workspace_id = ?').get(a.ws)) as { n: number };
    expect(Number(journals.n)).toBe(0);
    const inv = await quoteToInvoice(a, q.id);
    expect(inv).toMatchObject({ docType: 'invoice', status: 'draft', total: 12100, taxInclusive: true });
    await expectCode(quoteToInvoice(a, q.id), 'quote_invoiced');
    await expectCode(deleteQuote(a, q.id), 'quote_invoiced');
    expect((await getQuote(a.ws, q.id))!.status).toBe('invoiced');
  });

  it('vencido no se acepta, volver a borrador corta el link y los números no se repiten', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    expect(effectiveQuoteStatus('sent', '2026-01-01', '2026-01-02')).toBe('expired');
    expect(effectiveQuoteStatus('sent', '2026-01-02', '2026-01-02')).toBe('sent');
    expect(effectiveQuoteStatus('accepted', '2026-01-01', '2026-01-02')).toBe('accepted');
    const old = await createQuote(a, { contactId: c, issueDate: '2020-01-01', expiryDate: '2020-01-31', lines: [{ description: 'x', unitPrice: 100 }] });
    const s1 = await sendQuote(a, old.id);
    expect(s1.status).toBe('expired');
    await expectCode(decideQuote(s1.publicToken!, 'accepted', 'Ana'), 'quote_expired');
    const q = await createQuote(a, { contactId: c, expiryDate: '2099-01-01', lines: [{ description: 'y', unitPrice: 100 }] });
    const s2 = await sendQuote(a, q.id);
    expect(s2.label).toBe('Q-000002');
    await updateQuote(a, q.id, { status: 'draft' });
    await expectCode(decideQuote(s2.publicToken!, 'accepted', 'Ana'), 'not_found');
    const resent = await sendQuote(a, q.id);
    expect(resent.label).toBe('Q-000002');
    await expectCode(sendQuote(a, (await createQuote(a, { lines: [{ description: 'z', unitPrice: 1 }] })).id), 'contact_required');
    await expectCode(createQuote({ ...a, role: 'viewer', admin: false }, { lines: [] }), 'forbidden');
    const other = await workspace('generic', 'USD');
    expect(await getQuote(other.ws, q.id)).toBeNull();
    await expectCode(deleteQuote(other, q.id), 'not_found');
  });
});

describe('Books reglas bancarias y transferencias', () => {
  it('coincidencia pura, sin acentos ni mayúsculas, y la primera gana', () => {
    const r = { direction: 'out' as const, op: 'contains' as const, text: 'Comisión', minAmount: null, maxAmount: 5000, bankAccountId: null };
    expect(ruleMatches(r, { description: 'COMISION mantenimiento', amount: -5000 })).toBe(true);
    expect(ruleMatches(r, { description: 'comision', amount: 5000 })).toBe(false);
    expect(ruleMatches(r, { description: 'comision', amount: -5001 })).toBe(false);
    expect(ruleMatches({ ...r, op: 'starts' }, { description: 'pago comision', amount: -1 })).toBe(false);
    expect(ruleMatches({ ...r, op: 'equals' }, { description: ' comision ', amount: -1 })).toBe(true);
    expect(ruleMatches({ ...r, bankAccountId: 'b1' }, { description: 'comision', amount: -1 }, 'b2')).toBe(false);
    expect(ruleMatches({ ...r, text: '' }, { description: 'comision', amount: -1 })).toBe(false);
    const a = { ...r, id: 1 };
    const b = { ...r, id: 2 };
    expect(firstRule([a, b], { description: 'comision', amount: -1 })?.id).toBe(1);
  });

  it('aplica en bloque, deshacer revierte, deudores no se puede usar', async () => {
    const a = await workspace('generic', 'USD');
    const bank = await createBankAccount(a, { name: 'Main' });
    const fees = await accountByKey(a.ws, 'bank_fees');
    const ar = await accountByKey(a.ws, 'ar');
    await expectCode(createRule(a, { text: 'x', accountId: ar.id }), 'account_needs_document');
    await expectCode(createRule(a, { text: ' ', accountId: fees.id }), 'invalid_rule_text');
    await expectCode(createRule({ ...a, role: 'viewer', admin: false }, { text: 'x', accountId: fees.id }), 'forbidden');
    const other = await workspace('generic', 'USD');
    await expectCode(createRule(other, { text: 'x', accountId: fees.id }), 'invalid_account');
    await createRule(a, { name: 'Comisiones', text: 'comision', direction: 'out', accountId: fees.id });
    await importStatement(a, bank.id, { text: 'date,description,amount\n2026-08-01,Comision banco,-15.50\n2026-08-02,Comision otra,-4.50\n2026-08-03,Deposito,100.00', filename: 'x.csv' });
    const sugg = await ruleSuggestions(a.ws, bank.id);
    expect(Object.keys(sugg)).toHaveLength(2);
    const before = await trialBalance(a.ws, '2026-12-31');
    expect(before.rows).toHaveLength(0);
    const res = await applyRules(a, bank.id);
    expect(res).toMatchObject({ applied: 2, failed: 0 });
    const fb = (await getDb().prepare('SELECT SUM(debit - credit) AS v FROM books_journal_lines WHERE account_id = ?').get(fees.id)) as { v: number };
    expect(Number(fb.v)).toBe(2000);
    const txns = await listTxns(a.ws, bank.id, {});
    expect(txns.filter((t) => t.status === 'matched')).toHaveLength(2);
    const matched = txns.find((t) => t.status === 'matched')!;
    await unreconcile(a, matched.id);
    const fb2 = (await getDb().prepare('SELECT SUM(debit - credit) AS v FROM books_journal_lines WHERE account_id = ?').get(fees.id)) as { v: number };
    expect(Number(fb2.v)).toBeLessThan(2000);
    const dep = txns.find((t) => t.amount === 10000)!;
    await expectCode(reconcile(a, dep.id, { kind: 'account', accountId: ar.id }), 'account_needs_document');
    await allBalanced(a.ws);
  });

  it('una transferencia se concilia en las dos cuentas sin duplicar y deshacer no la revierte', async () => {
    const a = await workspace('generic', 'USD');
    const b1 = await createBankAccount(a, { name: 'Uno' });
    const b2 = await createBankAccount(a, { name: 'Dos' });
    await expectCode(createTransfer(a, { fromId: b1.id, toId: b1.id, amount: 100 }), 'same_account');
    await expectCode(createTransfer(a, { fromId: b1.id, toId: b2.id, amount: -1 }), 'invalid_amount');
    const { journalId } = await createTransfer(a, { fromId: b1.id, toId: b2.id, amount: 25000, date: '2026-09-01', reference: 'Fondeo' });
    await importStatement(a, b1.id, { text: 'date,description,amount\n2026-09-01,Transferencia salida,-250.00', filename: 'a.csv' });
    await importStatement(a, b2.id, { text: 'date,description,amount\n2026-09-01,Transferencia entrada,250.00', filename: 'b.csv' });
    const out = (await listTxns(a.ws, b1.id, {}))[0];
    const inn = (await listTxns(a.ws, b2.id, {}))[0];
    const cand = await suggestions(a.ws, b1.id);
    expect(cand[out.id][0]).toMatchObject({ kind: 'journal', id: journalId });
    await reconcile(a, out.id, { kind: 'journal', journalId });
    await reconcile(a, inn.id, { kind: 'journal', journalId });
    const count = (await getDb().prepare('SELECT COUNT(*) AS n FROM books_journals WHERE workspace_id = ?').get(a.ws)) as { n: number };
    expect(Number(count.n)).toBe(1);
    await unreconcile(a, out.id);
    const after = (await getDb().prepare('SELECT COUNT(*) AS n FROM books_journals WHERE workspace_id = ?').get(a.ws)) as { n: number };
    expect(Number(after.n)).toBe(1);
    const bal = (await getDb().prepare('SELECT SUM(debit - credit) AS v FROM books_journal_lines WHERE account_id = ?').get(b2.accountId)) as { v: number };
    expect(Number(bal.v)).toBe(25000);
    // Importe distinto: no concilia.
    await importStatement(a, b1.id, { text: 'date,description,amount\n2026-09-02,Otra,-1.00', filename: 'c.csv' });
    const wrong = (await listTxns(a.ws, b1.id, { status: 'unmatched' })).find((t) => t.amount === -100)!;
    await expectCode(reconcile(a, wrong.id, { kind: 'journal', journalId }), 'amount_mismatch');
  });
});

describe('Books bienes de uso', () => {
  const base = { cost: 100000, residual: 0, method: 'straight_line' as const, lifeMonths: 3, rateBps: null, startDate: '2026-01-15' };

  it('lineal: el acumulado cierra exacto y no pasa del total', () => {
    expect(accumulatedAt(base, '2025-12')).toBe(0);
    expect(accumulatedAt(base, '2026-01')).toBe(33333);
    expect(accumulatedAt(base, '2026-02')).toBe(66667);
    expect(accumulatedAt(base, '2026-03')).toBe(100000);
    expect(accumulatedAt(base, '2030-01')).toBe(100000);
    expect(accumulatedAt({ ...base, residual: 10000 }, '2026-03')).toBe(90000);
    expect(accumulatedAt({ ...base, method: 'none' }, '2030-01')).toBe(0);
  });

  it('saldo decreciente con piso en el residual', () => {
    const d = { cost: 120000, residual: 20000, method: 'declining' as const, lifeMonths: null, rateBps: 12000, startDate: '2026-01-01' };
    expect(accumulatedAt(d, '2026-01')).toBe(12000); // 10 % del mes sobre 1200,00
    expect(accumulatedAt(d, '2026-02')).toBe(22800); // 12000 + 10 % de 1080,00
    expect(accumulatedAt(d, '2040-01')).toBe(100000);
  });

  it('corre mes a mes sin duplicar, respeta el cierre y deshacer vuelve atrás', async () => {
    const a = await workspace('generic', 'USD');
    await expectCode(createAsset(a, { name: 'x', cost: 0, lifeMonths: 3, method: 'straight_line' }), 'invalid_amount');
    await expectCode(createAsset(a, { name: 'x', cost: 100, residual: 200, lifeMonths: 3 }), 'invalid_amount');
    await expectCode(createAsset(a, { name: 'x', cost: 100, method: 'straight_line' }), 'invalid_life');
    const asset = await createAsset(a, { name: 'Camión', cost: 100000, purchaseDate: '2026-01-15', method: 'straight_line', lifeMonths: 3 });
    // Un borrador no amortiza.
    expect(await depreciationPreview(a.ws, '2026-03')).toHaveLength(0);
    await updateAsset(a, asset.id, { status: 'registered' });
    const first = await runDepreciation(a, '2026-02');
    expect(first).toEqual({ months: 2, total: 66667 });
    expect(await runDepreciation(a, '2026-02')).toEqual({ months: 0, total: 0 });
    let cur = (await getAsset(a.ws, asset.id))!;
    expect(cur).toMatchObject({ accumulated: 66667, depreciatedTo: '2026-02', bookValue: 33333 });
    await expectCode(updateAsset(a, asset.id, { cost: 5 }), 'asset_has_depreciation');
    await updateAsset(a, asset.id, { name: 'Camión 2' });
    const pnl = await profitAndLoss(a.ws, '2026-01-01', '2026-01-31');
    expect(pnl.totalExpenses).toBe(33333);
    const j = (await getDb().prepare("SELECT date FROM books_journals WHERE workspace_id = ? AND source_type = 'depreciation' ORDER BY date").all(a.ws)) as Array<{ date: string }>;
    expect(j.map((x) => x.date)).toEqual(['2026-01-31', '2026-02-28']);

    const undone = await rollbackDepreciation(a);
    expect(undone.month).toBe('2026-02');
    cur = (await getAsset(a.ws, asset.id))!;
    expect(cur).toMatchObject({ accumulated: 33333, depreciatedTo: '2026-01' });
    expect((await runDepreciation(a, '2026-12')).total).toBe(66667);
    expect((await getAsset(a.ws, asset.id))!.accumulated).toBe(100000);
    expect(await runDepreciation(a, '2030-01')).toEqual({ months: 0, total: 0 });
    await allBalanced(a.ws);
    expect((await balanceSheet(a.ws, '2026-12-31')).difference).toBe(0);

    const b = await workspace('generic', 'USD');
    const locked = await createAsset(b, { name: 'y', cost: 3000, purchaseDate: '2026-01-01', method: 'straight_line', lifeMonths: 3 });
    await updateAsset(b, locked.id, { status: 'registered' });
    await updateSettings(b, { lockDate: '2026-01-31' });
    await expectCode(runDepreciation(b, '2026-03'), 'period_locked');
    expect((await getAsset(b.ws, locked.id))!.accumulated).toBe(0);
  });

  it('la baja saca costo y acumulada y deja la ganancia o pérdida exacta', async () => {
    const a = await workspace('generic', 'USD');
    const asset = await createAsset(a, { name: 'PC', cost: 120000, purchaseDate: '2026-01-01', method: 'straight_line', lifeMonths: 12 });
    await updateAsset(a, asset.id, { status: 'registered' });
    await expectCode(disposeAsset(a, asset.id, { date: '2026-04-15', proceeds: 100 }), 'depreciate_first');
    await runDepreciation(a, '2026-03');
    const cur = (await getAsset(a.ws, asset.id))!;
    expect(cur.accumulated).toBe(30000);
    const before = (await profitAndLoss(a.ws, '2026-04-01', '2026-04-30')).netProfit;
    const done = await disposeAsset(a, asset.id, { date: '2026-04-15', proceeds: 100000 });
    expect(done.status).toBe('disposed');
    expect(done.bookValue).toBe(0);
    // Valor en libros 900,00, se cobró 1000,00: gana 100,00.
    expect((await profitAndLoss(a.ws, '2026-04-01', '2026-04-30')).netProfit - before).toBe(10000);
    const assetBal = (await getDb().prepare('SELECT SUM(debit - credit) AS v FROM books_journal_lines WHERE account_id = ?').get(cur.accumAccountId)) as { v: number };
    expect(Number(assetBal.v)).toBe(0);
    await expectCode(disposeAsset(a, asset.id, {}), 'invalid_status');
    await expectCode(runDepreciation(a, '2026-12').then((r) => (r.months === 0 ? Promise.reject(new BooksError('none')) : r)), 'none');
    await allBalanced(a.ws);
  });
});

describe('Books saldos iniciales', () => {
  it('balancea contra resultados no asignados y no acepta deudores', async () => {
    const a = await workspace('generic', 'USD');
    const bank = await accountByKey(a.ws, 'bank');
    const ar = await accountByKey(a.ws, 'ar');
    await expectCode(createOpeningBalances(a, { date: '2025-12-31', lines: [{ accountId: ar.id, debit: 100 }] }), 'account_needs_document');
    await createOpeningBalances(a, { date: '2025-12-31', lines: [{ accountId: bank.id, debit: 150000 }] });
    expect(await ledger(a.ws, 'retained')).toBe(-150000);
    const bs = await balanceSheet(a.ws, '2025-12-31');
    expect(bs.difference).toBe(0);
    expect(bs.totalAssets).toBe(150000);
    expect((await profitAndLoss(a.ws, '2025-01-01', '2025-12-31')).netProfit).toBe(0);
  });
});

describe('Books importar CSV', () => {
  it('lee separadores, comillas y BOM', () => {
    expect(parseCsvTable('﻿Name;Email\n"Acme; SA";a@b.co\n')).toEqual([{ name: 'Acme; SA', email: 'a@b.co' }]);
    expect(parseCsvTable('name,tax id\nX,1')).toEqual([{ name: 'X', tax_id: '1' }]);
    expect(parseCsvTable('solo encabezado')).toEqual([]);
  });

  it('crea, saltea repetidos, informa errores y el export no deja fórmulas', async () => {
    const a = await workspace('generic', 'USD');
    const r = await importContactsCsv(a, 'name,kind,email\nAcme,customer,a@acme.co\nacme,customer,b@acme.co\n,customer,x@y.co\n=HACK(),supplier,\nMal,customer,no-es-email');
    expect(r.created).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.errors.map((e) => e.row)).toEqual(expect.arrayContaining([4, 6]));
    expect(await contactsCsv(a.ws)).toContain("'=HACK()");
    const i = await importItemsCsv(a, 'name,price,kind\nServicio,"1,234.50",service\nCaja,10,product');
    expect(i.created).toBe(2);
    const { listItems } = await import('@/lib/books');
    expect((await listItems(a.ws)).find((x) => x.name === 'Servicio')!.price).toBe(123450);
    await expectCode(importContactsCsv(a, ''), 'csv_empty');
    await expectCode(importContactsCsv({ ...a, role: 'viewer', admin: false }, 'name\nX'), 'forbidden');
  });
});

describe('Books recurrentes de proveedor', () => {
  it('emite la factura de proveedor en su fecha, una vez', async () => {
    const a = await workspace('generic', 'USD');
    const s = await supplier(a);
    const today = new Date().toISOString().slice(0, 10);
    const r = await createRecurring(a, { docType: 'bill', name: 'Alquiler', contactId: s, frequency: 'monthly', nextDate: today, template: { lines: [{ description: 'Alquiler', unitPrice: 50000, quantity: 1 }] } });
    expect(r.docType).toBe('bill');
    await runRecurring({ today, limit: 500 });
    const docs = (await getDb().prepare('SELECT doc_type, status, total, number_label FROM books_documents WHERE workspace_id = ? AND recurring_id = ?').all(a.ws, r.id)) as Array<{ doc_type: string; status: string; total: number; number_label: string }>;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ doc_type: 'bill', status: 'sent', total: 50000 });
    expect(await ledger(a.ws, 'ap')).toBe(-50000);
    await expectCode(createRecurring({ ...a, role: 'sales', admin: false }, { docType: 'bill', name: 'x', contactId: s, template: { lines: [{ description: 'x', unitPrice: 1 }] } }), 'forbidden');
  });
});

describe('Books topes de email', () => {
  it('corta por destinatario y en cuentas nuevas no deja texto libre', async () => {
    const a = await workspace('generic', 'USD');
    const to = `${uid()}@example.com`;
    for (let i = 0; i < BOOKS_MAIL_LIMITS.recipientDay; i++) await assertBooksMailAllowed(a.ws, to);
    await expectCode(assertBooksMailAllowed(a.ws, to), 'email_limit');
    expect(await freeTextAllowed(a.ws, to)).toBe(false);
    // Vieja, con el email de un contacto suyo: sí. A otra dirección: no.
    await getDb().prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(a.ws);
    const known = `${uid()}@example.com`;
    await createContact(a, { name: 'K', kind: 'customer', email: known }, { syncCrm: false });
    expect(await freeTextAllowed(a.ws, known)).toBe(true);
    expect(await freeTextAllowed(a.ws, to)).toBe(false);
  });

  it('un envío frenado por el tope no deja la factura aprobada', async () => {
    const a = await workspace('generic', 'USD');
    const email = `${uid()}@example.com`;
    const c = (await createContact(a, { name: 'C', kind: 'customer', email }, { syncCrm: false })).id;
    for (let i = 0; i < BOOKS_MAIL_LIMITS.recipientDay; i++) await assertBooksMailAllowed(a.ws, email);
    const d = await createDraft(a, { docType: 'invoice', contactId: c, lines: [{ description: 'x', unitPrice: 100 }] });
    await expectCode(sendDocument(a, d.id, {}), 'email_limit');
    expect((await getDocument(a.ws, d.id))!.status).toBe('draft');
  });
});

describe('Books búsqueda con rol', () => {
  it('Cmd+K encuentra lo nuevo y respeta el rol', async () => {
    const a = await workspace('generic', 'USD');
    const c = await customer(a);
    const tag = `zz${uid()}`;
    await createQuote(a, { contactId: c, title: `Obra ${tag}`, lines: [{ description: 'x', unitPrice: 1 }] });
    await createAsset(a, { name: `Camion ${tag}`, cost: 1000, method: 'straight_line', lifeMonths: 12 });
    await saveBudget(a, { name: `Plan ${tag}`, startMonth: '2026-01' });
    const owner = await searchBooks({ id: a.ws, role: 'owner' }, tag);
    expect(owner.map((h) => h.group).sort()).toEqual(['booksAssets', 'booksBudgets', 'booksQuotes']);
    const m = await upsertUser({ email: `m-${uid()}@example.com`, name: 'M', image: null });
    await getDb().prepare("INSERT OR IGNORE INTO teams (id, name, owner_id) VALUES (?, 'T', ?)").run(`t-${a.ws}`, a.ws);
    await getDb().prepare('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)').run(`t-${a.ws}`, m.id, 'member', '["books"]');
    await setRole(a, m.id, 'sales');
    const sales = await searchBooks({ id: a.ws, role: 'member', actingUser: { id: m.id } }, tag);
    expect(sales.map((h) => h.group)).toEqual(['booksQuotes']);
    const accounts = await listAccounts(a.ws);
    expect(accounts.length).toBeGreaterThan(0);
    void listTaxRates;
  });
});
