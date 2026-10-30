/**
 * Books: informes desde el libro diario (moneda base). Server-only.
 *
 * - Estado de resultados (P&L): ingresos y gastos por cuenta en un período.
 * - Balance: activo, pasivo y patrimonio a una fecha, con el resultado del
 *   ejercicio (todo lo de resultados hasta la fecha) dentro del patrimonio.
 * - Flujo de caja (método directo): movimientos de las cuentas de banco y
 *   caja, agrupados por el origen del asiento.
 * - Antigüedad de saldos de clientes y proveedores (al día, 1-30, 31-60,
 *   61-90, más de 90 días vencido).
 * - Impuestos: débito y crédito fiscal por tasa, y el detalle por
 *   comprobante (libro IVA ventas y compras de AR), con export CSV.
 */
import { getDb } from './db';
import { ensureBooks } from './books';
import { normalSide, type AccountType } from './books-templates';
import { convert, daysBetween, todayIso, toDecimalString } from './books-money';

export interface ReportLine {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  amount: number;
}

async function balances(ws: string, opts: { from?: string; to?: string; types?: AccountType[] }): Promise<ReportLine[]> {
  const where = ['a.workspace_id = ?'];
  const args: Array<string | number> = [ws];
  const jWhere: string[] = [];
  if (opts.from) (jWhere.push('j.date >= ?'), args.push(opts.from));
  if (opts.to) (jWhere.push('j.date <= ?'), args.push(opts.to));
  if (opts.types?.length) where.push(`a.type IN (${opts.types.map((t) => `'${t}'`).join(',')})`);
  const rows = (await getDb()
    .prepare(
      `SELECT a.id, a.code, a.name, a.type, a.subtype, COALESCE(SUM(l.debit), 0) AS d, COALESCE(SUM(l.credit), 0) AS c
       FROM books_accounts a
       JOIN books_journal_lines l ON l.account_id = a.id
       JOIN books_journals j ON j.id = l.journal_id${jWhere.length ? ` AND ${jWhere.join(' AND ')}` : ''}
       WHERE ${where.join(' AND ')}
       GROUP BY a.id ORDER BY a.code`,
    )
    .all(...args.slice(1), args[0])) as Array<{ id: string; code: string; name: string; type: AccountType; subtype: string; d: number; c: number }>;
  return rows
    .map((r) => ({ accountId: r.id, code: r.code, name: r.name, type: r.type, subtype: r.subtype, amount: normalSide(r.type) === 'debit' ? Number(r.d) - Number(r.c) : Number(r.c) - Number(r.d) }))
    .filter((r) => r.amount !== 0);
}

export interface ProfitLoss {
  from: string;
  to: string;
  currency: string;
  income: ReportLine[];
  costOfSales: ReportLine[];
  expenses: ReportLine[];
  totalIncome: number;
  totalCostOfSales: number;
  grossProfit: number;
  totalExpenses: number;
  netProfit: number;
}

export async function profitAndLoss(ws: string, from: string, to: string): Promise<ProfitLoss> {
  const s = await ensureBooks(ws);
  const lines = await balances(ws, { from, to, types: ['income', 'expense'] });
  const income = lines.filter((l) => l.type === 'income');
  const costOfSales = lines.filter((l) => l.type === 'expense' && l.subtype === 'cogs');
  const expenses = lines.filter((l) => l.type === 'expense' && l.subtype !== 'cogs');
  const sum = (ls: ReportLine[]) => ls.reduce((a, l) => a + l.amount, 0);
  const totalIncome = sum(income);
  const totalCostOfSales = sum(costOfSales);
  const totalExpenses = sum(expenses);
  return {
    from,
    to,
    currency: s.base_currency,
    income,
    costOfSales,
    expenses,
    totalIncome,
    totalCostOfSales,
    grossProfit: totalIncome - totalCostOfSales,
    totalExpenses,
    netProfit: totalIncome - totalCostOfSales - totalExpenses,
  };
}

export interface BalanceSheet {
  asOf: string;
  currency: string;
  assets: ReportLine[];
  liabilities: ReportLine[];
  equity: ReportLine[];
  currentEarnings: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  /** Activo − (pasivo + patrimonio): siempre 0 si los asientos balancean. */
  difference: number;
}

export async function balanceSheet(ws: string, asOf: string): Promise<BalanceSheet> {
  const s = await ensureBooks(ws);
  const lines = await balances(ws, { to: asOf });
  const assets = lines.filter((l) => l.type === 'asset');
  const liabilities = lines.filter((l) => l.type === 'liability');
  const equity = lines.filter((l) => l.type === 'equity');
  const income = lines.filter((l) => l.type === 'income').reduce((a, l) => a + l.amount, 0);
  const expense = lines.filter((l) => l.type === 'expense').reduce((a, l) => a + l.amount, 0);
  const currentEarnings = income - expense;
  const totalAssets = assets.reduce((a, l) => a + l.amount, 0);
  const totalLiabilities = liabilities.reduce((a, l) => a + l.amount, 0);
  const totalEquity = equity.reduce((a, l) => a + l.amount, 0) + currentEarnings;
  return { asOf, currency: s.base_currency, assets, liabilities, equity, currentEarnings, totalAssets, totalLiabilities, totalEquity, difference: totalAssets - totalLiabilities - totalEquity };
}

export interface CashFlow {
  from: string;
  to: string;
  currency: string;
  opening: number;
  closing: number;
  inflows: Array<{ category: string; amount: number }>;
  outflows: Array<{ category: string; amount: number }>;
  net: number;
}

/** Categoría de un movimiento de caja según el asiento y la contrapartida. */
function cashCategory(sourceType: string, counterTypes: string[]): string {
  if (sourceType === 'payment' || sourceType === 'shop_order') return 'customers_suppliers';
  if (sourceType === 'expense') return 'expenses';
  if (counterTypes.includes('equity')) return 'financing';
  if (counterTypes.includes('liability')) return 'financing';
  if (counterTypes.includes('income')) return 'other_income';
  if (counterTypes.includes('expense')) return 'expenses';
  if (counterTypes.every((t) => t === 'asset')) return 'transfers';
  return 'other';
}

export async function cashFlow(ws: string, from: string, to: string): Promise<CashFlow> {
  const s = await ensureBooks(ws);
  const cashIds = ((await getDb()
    .prepare("SELECT id FROM books_accounts WHERE workspace_id = ? AND (subtype IN ('bank','cash') OR system_key = 'clearing')")
    .all(ws)) as Array<{ id: string }>).map((r) => r.id);
  if (!cashIds.length) return { from, to, currency: s.base_currency, opening: 0, closing: 0, inflows: [], outflows: [], net: 0 };
  const ph = cashIds.map(() => '?').join(',');
  const opening = (await getDb()
    .prepare(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM books_journal_lines l JOIN books_journals j ON j.id = l.journal_id WHERE l.account_id IN (${ph}) AND j.date < ?`)
    .get(...cashIds, from)) as { v: number };
  const rows = (await getDb()
    .prepare(
      `SELECT j.id, j.source_type, SUM(CASE WHEN l.account_id IN (${ph}) THEN l.debit - l.credit ELSE 0 END) AS cash,
        GROUP_CONCAT(CASE WHEN l.account_id NOT IN (${ph}) THEN a.type END) AS counter
       FROM books_journals j JOIN books_journal_lines l ON l.journal_id = j.id JOIN books_accounts a ON a.id = l.account_id
       WHERE j.workspace_id = ? AND j.date >= ? AND j.date <= ? GROUP BY j.id HAVING cash != 0`,
    )
    .all(...cashIds, ...cashIds, ws, from, to)) as Array<{ id: string; source_type: string; cash: number; counter: string | null }>;
  const inflows = new Map<string, number>();
  const outflows = new Map<string, number>();
  for (const r of rows) {
    const counter = (r.counter ?? '').split(',').filter(Boolean);
    // Transferencias entre cuentas de caja no cambian el total: no se listan.
    if (!counter.length) continue;
    const cat = cashCategory(r.source_type, counter);
    const v = Number(r.cash);
    if (v > 0) inflows.set(cat, (inflows.get(cat) ?? 0) + v);
    else outflows.set(cat, (outflows.get(cat) ?? 0) - v);
  }
  const net = rows.reduce((a, r) => a + Number(r.cash), 0);
  const toList = (m: Map<string, number>) => [...m.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  return { from, to, currency: s.base_currency, opening: Number(opening.v), closing: Number(opening.v) + net, inflows: toList(inflows), outflows: toList(outflows), net };
}

// ---------- Antigüedad ----------

export const AGING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function agingBucket(dueDate: string | null, asOf: string): AgingBucket {
  if (!dueDate) return 'current';
  const days = daysBetween(dueDate, asOf);
  if (days <= 0) return 'current';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90_plus';
}

export interface AgingRow {
  contactId: string | null;
  contactName: string;
  buckets: Record<AgingBucket, number>;
  total: number;
  docs: Array<{ id: string; label: string; dueDate: string | null; due: number; currency: string; bucket: AgingBucket }>;
}

export interface AgingReport {
  kind: 'receivables' | 'payables';
  asOf: string;
  currency: string;
  rows: AgingRow[];
  totals: Record<AgingBucket, number> & { total: number };
}

/** Saldos abiertos por contacto y antigüedad, convertidos a la moneda base con el tipo de cada comprobante. */
export async function aging(ws: string, kind: 'receivables' | 'payables', asOf = todayIso()): Promise<AgingReport> {
  const s = await ensureBooks(ws);
  const docs = (await getDb()
    .prepare(
      `SELECT d.id, d.number_label, d.due_date, d.total, d.paid_total, d.credited_total, d.currency, d.fx_rate, d.contact_id, c.name AS contact_name
       FROM books_documents d LEFT JOIN books_contacts c ON c.id = d.contact_id
       WHERE d.workspace_id = ? AND d.doc_type = ? AND d.status IN ('sent','partial','overdue') AND d.issue_date <= ?
       ORDER BY c.name COLLATE NOCASE, d.due_date`,
    )
    .all(ws, kind === 'receivables' ? 'invoice' : 'bill', asOf)) as Array<Record<string, unknown>>;
  const byContact = new Map<string, AgingRow>();
  const empty = (): Record<AgingBucket, number> => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 });
  const totals = { ...empty(), total: 0 };
  for (const d of docs) {
    const due = Number(d.total) - Number(d.paid_total) - Number(d.credited_total);
    if (due <= 0) continue;
    const base = convert(due, String(d.currency), String(d.fx_rate), s.base_currency);
    const bucket = agingBucket((d.due_date as string) ?? null, asOf);
    const key = String(d.contact_id ?? '');
    const row = byContact.get(key) ?? { contactId: (d.contact_id as string) ?? null, contactName: String(d.contact_name ?? ''), buckets: empty(), total: 0, docs: [] };
    row.buckets[bucket] += base;
    row.total += base;
    row.docs.push({ id: String(d.id), label: String(d.number_label), dueDate: (d.due_date as string) ?? null, due, currency: String(d.currency), bucket });
    byContact.set(key, row);
    totals[bucket] += base;
    totals.total += base;
  }
  return { kind, asOf, currency: s.base_currency, rows: [...byContact.values()].sort((a, b) => b.total - a.total), totals };
}

// ---------- Impuestos ----------

export interface TaxReportRow {
  taxRateId: string | null;
  name: string;
  rateBps: number;
  salesNet: number;
  salesTax: number;
  purchasesNet: number;
  purchasesTax: number;
}

export interface TaxBookEntry {
  date: string;
  docType: string;
  label: string;
  contactName: string;
  taxId: string;
  taxCondition: string;
  /** Neto y IVA por tasa (bps) en moneda base; las notas de crédito van en negativo. */
  byRate: Record<string, { net: number; tax: number }>;
  exempt: number;
  total: number;
}

export interface TaxReport {
  from: string;
  to: string;
  currency: string;
  rows: TaxReportRow[];
  totals: { salesNet: number; salesTax: number; purchasesNet: number; purchasesTax: number; payable: number };
  sales: TaxBookEntry[];
  purchases: TaxBookEntry[];
}

/**
 * Débito fiscal (ventas: facturas menos notas de crédito) y crédito fiscal
 * (compras: facturas de proveedor y gastos con impuesto), por tasa, desde los
 * comprobantes emitidos del período (no anulados). Montos en moneda base.
 */
export async function taxReport(ws: string, from: string, to: string): Promise<TaxReport> {
  const s = await ensureBooks(ws);
  const lines = (await getDb()
    .prepare(
      `SELECT d.id, d.doc_type, d.issue_date, d.number_label, d.reference, d.currency, d.fx_rate, d.total, c.name AS contact_name, c.tax_id, c.tax_condition,
        l.tax_rate_id, l.tax_bps, l.net, l.tax, t.name AS tax_name
       FROM books_documents d JOIN books_lines l ON l.doc_id = d.id
       LEFT JOIN books_contacts c ON c.id = d.contact_id LEFT JOIN books_tax_rates t ON t.id = l.tax_rate_id
       WHERE d.workspace_id = ? AND d.status NOT IN ('draft','void') AND d.issue_date >= ? AND d.issue_date <= ?
       ORDER BY d.issue_date, d.number_label`,
    )
    .all(ws, from, to)) as Array<Record<string, unknown>>;
  const expenses = (await getDb()
    .prepare(
      `SELECT e.id, e.date, e.vendor, e.currency, e.fx_rate, e.total, e.tax, e.tax_rate_id, t.name AS tax_name, t.rate_bps, c.name AS contact_name, c.tax_id, c.tax_condition
       FROM books_expenses e LEFT JOIN books_tax_rates t ON t.id = e.tax_rate_id LEFT JOIN books_contacts c ON c.id = e.contact_id
       WHERE e.workspace_id = ? AND e.status = 'posted' AND e.date >= ? AND e.date <= ?`,
    )
    .all(ws, from, to)) as Array<Record<string, unknown>>;
  const rows = new Map<string, TaxReportRow>();
  const rowFor = (id: string | null, name: string, bps: number) => {
    const key = id ?? `none:${bps}`;
    const r = rows.get(key) ?? { taxRateId: id, name: name || `${bps / 100}%`, rateBps: bps, salesNet: 0, salesTax: 0, purchasesNet: 0, purchasesTax: 0 };
    rows.set(key, r);
    return r;
  };
  const books = new Map<string, TaxBookEntry & { purchase: boolean }>();
  for (const l of lines) {
    const sign = l.doc_type === 'credit_note' ? -1 : 1;
    const base = (v: number) => sign * convert(v, String(l.currency), String(l.fx_rate), s.base_currency);
    const net = base(Number(l.net));
    const tax = base(Number(l.tax));
    const bps = Number(l.tax_bps);
    const r = rowFor((l.tax_rate_id as string) ?? null, String(l.tax_name ?? ''), bps);
    const purchase = l.doc_type === 'bill';
    if (purchase) (r.purchasesNet += net), (r.purchasesTax += tax);
    else (r.salesNet += net), (r.salesTax += tax);
    const entry = books.get(String(l.id)) ?? {
      date: String(l.issue_date),
      docType: String(l.doc_type),
      label: String(l.number_label || l.reference),
      contactName: String(l.contact_name ?? ''),
      taxId: String(l.tax_id ?? ''),
      taxCondition: String(l.tax_condition ?? ''),
      byRate: {},
      exempt: 0,
      total: base(Number(l.total)),
      purchase,
    };
    if (bps === 0) entry.exempt += net;
    else {
      const k = String(bps);
      entry.byRate[k] = { net: (entry.byRate[k]?.net ?? 0) + net, tax: (entry.byRate[k]?.tax ?? 0) + tax };
    }
    books.set(String(l.id), entry);
  }
  for (const e of expenses) {
    const base = (v: number) => convert(v, String(e.currency), String(e.fx_rate), s.base_currency);
    const tax = base(Number(e.tax));
    const total = base(Number(e.total));
    const bps = Number(e.rate_bps ?? 0);
    const r = rowFor((e.tax_rate_id as string) ?? null, String(e.tax_name ?? ''), bps);
    r.purchasesNet += total - tax;
    r.purchasesTax += tax;
    books.set(String(e.id), {
      date: String(e.date),
      docType: 'expense',
      label: String(e.vendor ?? ''),
      contactName: String(e.contact_name ?? e.vendor ?? ''),
      taxId: String(e.tax_id ?? ''),
      taxCondition: String(e.tax_condition ?? ''),
      byRate: bps ? { [String(bps)]: { net: total - tax, tax } } : {},
      exempt: bps ? 0 : total - tax,
      total,
      purchase: true,
    });
  }
  const list = [...rows.values()].sort((a, b) => b.rateBps - a.rateBps);
  const totals = list.reduce(
    (a, r) => ({ salesNet: a.salesNet + r.salesNet, salesTax: a.salesTax + r.salesTax, purchasesNet: a.purchasesNet + r.purchasesNet, purchasesTax: a.purchasesTax + r.purchasesTax }),
    { salesNet: 0, salesTax: 0, purchasesNet: 0, purchasesTax: 0 },
  );
  const entries = [...books.values()].sort((a, b) => a.date.localeCompare(b.date));
  const strip = ({ purchase: _p, ...e }: TaxBookEntry & { purchase: boolean }): TaxBookEntry => e;
  return {
    from,
    to,
    currency: s.base_currency,
    rows: list,
    totals: { ...totals, payable: totals.salesTax - totals.purchasesTax },
    sales: entries.filter((e) => !e.purchase).map(strip),
    purchases: entries.filter((e) => e.purchase).map(strip),
  };
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Libro IVA (ventas o compras) en CSV: una fila por comprobante, una columna de neto e IVA por tasa. */
export function taxBookCsv(entries: TaxBookEntry[], currency: string): string {
  const rates = [...new Set(entries.flatMap((e) => Object.keys(e.byRate)))].map(Number).sort((a, b) => b - a);
  const head = ['date', 'type', 'number', 'contact', 'tax_id', 'tax_condition', ...rates.flatMap((r) => [`net_${r / 100}`, `tax_${r / 100}`]), 'exempt', 'total'];
  const rows = entries.map((e) => [
    e.date,
    e.docType,
    e.label,
    e.contactName,
    e.taxId,
    e.taxCondition,
    ...rates.flatMap((r) => [toDecimalString(e.byRate[String(r)]?.net ?? 0, currency), toDecimalString(e.byRate[String(r)]?.tax ?? 0, currency)]),
    toDecimalString(e.exempt, currency),
    toDecimalString(e.total, currency),
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

/** Resumen del inicio: a cobrar, vencido, a pagar, saldos de banco y resultado del mes. */
export async function overview(ws: string, today = todayIso()) {
  const s = await ensureBooks(ws);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [ar, ap, pl] = await Promise.all([aging(ws, 'receivables', today), aging(ws, 'payables', today), profitAndLoss(ws, monthStart, today)]);
  const overdue = ar.totals.total - ar.totals.current;
  return {
    currency: s.base_currency,
    receivable: ar.totals.total,
    overdue,
    payable: ap.totals.total,
    payableOverdue: ap.totals.total - ap.totals.current,
    monthIncome: pl.totalIncome,
    monthExpenses: pl.totalExpenses + pl.totalCostOfSales,
    monthProfit: pl.netProfit,
  };
}
