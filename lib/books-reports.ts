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
import { ensureBooks, listAccounts } from './books';
import { normalSide, type AccountType } from './books-templates';
import { addDays, addMonths, convert, daysBetween, fiscalYearStart, todayIso, toDecimalString } from './books-money';

export interface ReportLine {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  amount: number;
}

async function balances(ws: string, opts: { from?: string; to?: string; types?: AccountType[]; tracking?: string }): Promise<ReportLine[]> {
  const where = ['a.workspace_id = ?'];
  const args: Array<string | number> = [ws];
  const jWhere: string[] = [];
  if (opts.from) (jWhere.push('j.date >= ?'), args.push(opts.from));
  if (opts.to) (jWhere.push('j.date <= ?'), args.push(opts.to));
  // Centro de costo: la línea lleva esa opción en alguna de las dos categorías.
  if (opts.tracking) (jWhere.push('(l.tracking_a = ? OR l.tracking_b = ?)'), args.push(opts.tracking, opts.tracking));
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

export async function profitAndLoss(ws: string, from: string, to: string, opts: { tracking?: string } = {}): Promise<ProfitLoss> {
  const s = await ensureBooks(ws);
  const lines = await balances(ws, { from, to, types: ['income', 'expense'], tracking: opts.tracking });
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
  /** Resultado del ejercicio en curso (desde el arranque del ejercicio hasta la fecha). */
  currentEarnings: number;
  /** Resultado de ejercicios anteriores todavía no pasado a una cuenta de patrimonio. */
  priorEarnings: number;
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
  // El cierre de ejercicio es automático: lo anterior al arranque del ejercicio pasa a "ejercicios anteriores".
  const yearStart = fiscalYearStart(asOf, Number(s.fiscal_start_month ?? 1));
  const thisYear = await balances(ws, { from: yearStart, to: asOf, types: ['income', 'expense'] });
  const currentEarnings = thisYear.reduce((a, l) => a + (l.type === 'income' ? l.amount : -l.amount), 0);
  const priorEarnings = income - expense - currentEarnings;
  const totalAssets = assets.reduce((a, l) => a + l.amount, 0);
  const totalLiabilities = liabilities.reduce((a, l) => a + l.amount, 0);
  const totalEquity = equity.reduce((a, l) => a + l.amount, 0) + currentEarnings + priorEarnings;
  return { asOf, currency: s.base_currency, assets, liabilities, equity, currentEarnings, priorEarnings, totalAssets, totalLiabilities, totalEquity, difference: totalAssets - totalLiabilities - totalEquity };
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
  const docType = kind === 'receivables' ? 'invoice' : 'bill';
  // Saldos a la fecha: lo emitido hasta asOf (y no anulado antes de esa fecha), menos los cobros con fecha hasta asOf
  // y las notas de crédito emitidas hasta asOf. Así cuadra con la cuenta de deudores (o proveedores) del libro.
  const docs = (await getDb()
    .prepare(
      `SELECT d.id, d.number_label, d.due_date, d.total, d.currency, d.fx_rate, d.contact_id, c.name AS contact_name,
        (SELECT COALESCE(SUM(p.amount), 0) FROM books_payments p WHERE p.doc_id = d.id AND p.date <= ?) AS paid,
        (SELECT COALESCE(SUM(cn.paid_total), 0) FROM books_documents cn WHERE cn.credit_for_id = d.id AND cn.status NOT IN ('draft','void') AND cn.issue_date <= ?) AS credited
       FROM books_documents d LEFT JOIN books_contacts c ON c.id = d.contact_id
       WHERE d.workspace_id = ? AND d.doc_type = ? AND d.status != 'draft' AND d.issue_date <= ?
         AND (d.status != 'void' OR substr(d.voided_at, 1, 10) > ?)
       ORDER BY c.name COLLATE NOCASE, d.due_date`,
    )
    .all(asOf, asOf, ws, docType, asOf, asOf)) as Array<Record<string, unknown>>;
  // Notas de crédito con saldo sin aplicar: crédito a favor del cliente (negativo), al día.
  const credits =
    kind === 'receivables'
      ? ((await getDb()
          .prepare(
            `SELECT d.id, d.number_label, d.total, d.paid_total, d.currency, d.fx_rate, d.contact_id, c.name AS contact_name
             FROM books_documents d LEFT JOIN books_contacts c ON c.id = d.contact_id
             WHERE d.workspace_id = ? AND d.doc_type = 'credit_note' AND d.status NOT IN ('draft','void') AND d.issue_date <= ? AND d.total > d.paid_total`,
          )
          .all(ws, asOf)) as Array<Record<string, unknown>>)
      : [];
  const byContact = new Map<string, AgingRow>();
  const empty = (): Record<AgingBucket, number> => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 });
  const totals = { ...empty(), total: 0 };
  const add = (d: Record<string, unknown>, due: number, bucket: AgingBucket, settled?: number) => {
    // Igual que el libro: la conversión del total menos la de lo ya saldado, no la conversión del saldo.
    const conv = (v: number) => convert(v, String(d.currency), String(d.fx_rate), s.base_currency);
    const base = settled === undefined ? conv(due) : conv(due + settled) - conv(settled);
    const key = String(d.contact_id ?? '');
    const row = byContact.get(key) ?? { contactId: (d.contact_id as string) ?? null, contactName: String(d.contact_name ?? ''), buckets: empty(), total: 0, docs: [] };
    row.buckets[bucket] += base;
    row.total += base;
    row.docs.push({ id: String(d.id), label: String(d.number_label), dueDate: (d.due_date as string) ?? null, due, currency: String(d.currency), bucket });
    byContact.set(key, row);
    totals[bucket] += base;
    totals.total += base;
  };
  for (const d of docs) {
    const due = Number(d.total) - Number(d.paid) - Number(d.credited);
    if (due !== 0) add(d, due, agingBucket((d.due_date as string) ?? null, asOf), Number(d.paid) + Number(d.credited));
  }
  for (const c of credits) add(c, -(Number(c.total) - Number(c.paid_total)), 'current');
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
      // Fechas del libro: un comprobante cuenta en el período de su emisión (aunque después se anule) y su
      // anulación cuenta, en negativo, en el período en que se anuló. Anular no cambia un período ya presentado.
      `SELECT x.* FROM (
         SELECT 'issue' AS ev, d.issue_date AS ev_date, d.id, d.doc_type, d.number_label, d.reference, d.currency, d.fx_rate, d.total, c.name AS contact_name, c.tax_id, c.tax_condition,
           l.tax_rate_id, l.tax_bps, l.net, l.tax, t.name AS tax_name
         FROM books_documents d JOIN books_lines l ON l.doc_id = d.id
         LEFT JOIN books_contacts c ON c.id = d.contact_id LEFT JOIN books_tax_rates t ON t.id = l.tax_rate_id
         WHERE d.workspace_id = ? AND d.status != 'draft' AND d.issue_date >= ? AND d.issue_date <= ?
         UNION ALL
         SELECT 'void' AS ev, substr(d.voided_at, 1, 10) AS ev_date, d.id, d.doc_type, d.number_label, d.reference, d.currency, d.fx_rate, d.total, c.name AS contact_name, c.tax_id, c.tax_condition,
           l.tax_rate_id, l.tax_bps, l.net, l.tax, t.name AS tax_name
         FROM books_documents d JOIN books_lines l ON l.doc_id = d.id
         LEFT JOIN books_contacts c ON c.id = d.contact_id LEFT JOIN books_tax_rates t ON t.id = l.tax_rate_id
         WHERE d.workspace_id = ? AND d.status = 'void' AND substr(d.voided_at, 1, 10) >= ? AND substr(d.voided_at, 1, 10) <= ?
       ) x ORDER BY x.ev_date, x.number_label`,
    )
    .all(ws, from, to, ws, from, to)) as Array<Record<string, unknown>>;
  const expenses = (await getDb()
    .prepare(
      `SELECT e.id, e.date, e.vendor, e.currency, e.fx_rate, e.total, e.tax, e.tax_rate_id, t.name AS tax_name, t.rate_bps, c.name AS contact_name, c.tax_id, c.tax_condition
       FROM books_expenses e LEFT JOIN books_tax_rates t ON t.id = e.tax_rate_id LEFT JOIN books_contacts c ON c.id = e.contact_id
       WHERE e.workspace_id = ? AND e.status IN ('posted','void') AND e.journal_id IS NOT NULL AND e.date >= ? AND e.date <= ?`,
    )
    .all(ws, from, to)) as Array<Record<string, unknown>>;
  const voidedExpenses = (await getDb()
    .prepare(
      `SELECT e.id, substr(e.updated_at, 1, 10) AS date, e.vendor, e.currency, e.fx_rate, e.total, e.tax, e.tax_rate_id, t.name AS tax_name, t.rate_bps, c.name AS contact_name, c.tax_id, c.tax_condition
       FROM books_expenses e LEFT JOIN books_tax_rates t ON t.id = e.tax_rate_id LEFT JOIN books_contacts c ON c.id = e.contact_id
       WHERE e.workspace_id = ? AND e.status = 'void' AND substr(e.updated_at, 1, 10) >= ? AND substr(e.updated_at, 1, 10) <= ?`,
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
    const voided = l.ev === 'void';
    const sign = (l.doc_type === 'credit_note' ? -1 : 1) * (voided ? -1 : 1);
    const key = `${String(l.id)}:${String(l.ev)}`;
    const base = (v: number) => sign * convert(v, String(l.currency), String(l.fx_rate), s.base_currency);
    const net = base(Number(l.net));
    const tax = base(Number(l.tax));
    const bps = Number(l.tax_bps);
    const r = rowFor((l.tax_rate_id as string) ?? null, String(l.tax_name ?? ''), bps);
    const purchase = l.doc_type === 'bill';
    if (purchase) (r.purchasesNet += net), (r.purchasesTax += tax);
    else (r.salesNet += net), (r.salesTax += tax);
    const entry = books.get(key) ?? {
      date: String(l.ev_date),
      docType: voided ? `${String(l.doc_type)}_void` : String(l.doc_type),
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
    books.set(key, entry);
  }
  for (const [e, sign] of [...expenses.map((x) => [x, 1] as const), ...voidedExpenses.map((x) => [x, -1] as const)]) {
    const base = (v: number) => sign * convert(v, String(e.currency), String(e.fx_rate), s.base_currency);
    const tax = base(Number(e.tax));
    const total = base(Number(e.total));
    const bps = Number(e.rate_bps ?? 0);
    const r = rowFor((e.tax_rate_id as string) ?? null, String(e.tax_name ?? ''), bps);
    r.purchasesNet += total - tax;
    r.purchasesTax += tax;
    books.set(`${String(e.id)}:${sign}`, {
      date: String(e.date),
      docType: sign < 0 ? 'expense_void' : 'expense',
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

/** Celda CSV sin fórmulas: un texto que empieza con = + - @ (o tab/CR) va con apóstrofo; los números negativos quedan como números. */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

// ---------- Balance de sumas y saldos ----------

export interface TrialBalanceRow {
  accountId: string | null;
  code: string;
  name: string;
  type: AccountType | 'equity';
  debit: number;
  credit: number;
}

export interface TrialBalance {
  asOf: string;
  yearStart: string;
  currency: string;
  rows: TrialBalanceRow[];
  priorEarnings: number;
  totalDebit: number;
  totalCredit: number;
}

/**
 * A una fecha: cuentas de balance con su saldo acumulado y cuentas de resultado
 * desde el arranque del ejercicio; lo de ejercicios anteriores en una línea
 * aparte. Debe = haber siempre, si los asientos balancean.
 */
export async function trialBalance(ws: string, asOf: string): Promise<TrialBalance> {
  const s = await ensureBooks(ws);
  const yearStart = fiscalYearStart(asOf, Number(s.fiscal_start_month ?? 1));
  const sheet = await balances(ws, { to: asOf, types: ['asset', 'liability', 'equity'] });
  const results = await balances(ws, { from: yearStart, to: asOf, types: ['income', 'expense'] });
  const prior = await balances(ws, { to: addDays(yearStart, -1), types: ['income', 'expense'] });
  const priorEarnings = prior.reduce((a, l) => a + (l.type === 'income' ? l.amount : -l.amount), 0);
  const rows: TrialBalanceRow[] = [...sheet, ...results].map((l) => {
    const signed = normalSide(l.type) === 'debit' ? l.amount : -l.amount;
    return { accountId: l.accountId, code: l.code, name: l.name, type: l.type, debit: signed > 0 ? signed : 0, credit: signed < 0 ? -signed : 0 };
  });
  rows.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  if (priorEarnings !== 0) rows.push({ accountId: null, code: '', name: '', type: 'equity', debit: priorEarnings < 0 ? -priorEarnings : 0, credit: priorEarnings > 0 ? priorEarnings : 0 });
  return { asOf, yearStart, currency: s.base_currency, rows, priorEarnings, totalDebit: rows.reduce((a, r) => a + r.debit, 0), totalCredit: rows.reduce((a, r) => a + r.credit, 0) };
}

// ---------- Mayor ----------

export interface LedgerEntry {
  journalId: string;
  number: number;
  date: string;
  memo: string;
  sourceType: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface LedgerAccount {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  opening: number;
  entries: LedgerEntry[];
  closing: number;
  totalDebit: number;
  totalCredit: number;
}

export interface GeneralLedger {
  from: string;
  to: string;
  currency: string;
  accounts: LedgerAccount[];
  truncated: boolean;
}

export const LEDGER_MAX_LINES = 5000;

/** Saldo inicial, cada movimiento con saldo acumulado y saldo final, por cuenta. Saldos en el lado normal de la cuenta. */
export async function generalLedger(ws: string, from: string, to: string, opts: { accountId?: string } = {}): Promise<GeneralLedger> {
  const s = await ensureBooks(ws);
  const accounts = (await listAccounts(ws, { includeArchived: true })).filter((a) => !opts.accountId || a.id === opts.accountId);
  const rows = (await getDb()
    .prepare(
      `SELECT l.account_id, l.debit, l.credit, l.description, j.id AS journal_id, j.number, j.date, j.memo, j.source_type
       FROM books_journal_lines l JOIN books_journals j ON j.id = l.journal_id
       WHERE j.workspace_id = ? AND j.date >= ? AND j.date <= ?${opts.accountId ? ' AND l.account_id = ?' : ''}
       ORDER BY j.date, j.number, l.rowid LIMIT ?`,
    )
    .all(...[ws, from, to, ...(opts.accountId ? [opts.accountId] : []), LEDGER_MAX_LINES + 1])) as Array<Record<string, unknown>>;
  const truncated = rows.length > LEDGER_MAX_LINES;
  const before = (await getDb()
    .prepare(`SELECT l.account_id, COALESCE(SUM(l.debit - l.credit), 0) AS v FROM books_journal_lines l JOIN books_journals j ON j.id = l.journal_id WHERE j.workspace_id = ? AND j.date < ? GROUP BY l.account_id`)
    .all(ws, from)) as Array<{ account_id: string; v: number }>;
  const openingOf = new Map(before.map((b) => [b.account_id, Number(b.v)]));
  const out: LedgerAccount[] = [];
  for (const a of accounts) {
    const sign = normalSide(a.type) === 'debit' ? 1 : -1;
    const opening = sign * (openingOf.get(a.id) ?? 0);
    let balance = opening;
    let totalDebit = 0;
    let totalCredit = 0;
    const entries: LedgerEntry[] = [];
    for (const r of rows.slice(0, LEDGER_MAX_LINES)) {
      if (r.account_id !== a.id) continue;
      const debit = Number(r.debit);
      const credit = Number(r.credit);
      balance += sign * (debit - credit);
      totalDebit += debit;
      totalCredit += credit;
      entries.push({ journalId: String(r.journal_id), number: Number(r.number), date: String(r.date), memo: String(r.memo ?? ''), sourceType: String(r.source_type), description: String(r.description ?? ''), debit, credit, balance });
    }
    if (entries.length || opening !== 0) out.push({ accountId: a.id, code: a.code, name: a.name, type: a.type, opening, entries, closing: balance, totalDebit, totalCredit });
  }
  return { from, to, currency: s.base_currency, accounts: out, truncated };
}

// ---------- Ventas por ítem ----------

export interface SalesByItemRow {
  itemId: string | null;
  name: string;
  quantity: number;
  net: number;
  count: number;
}

/** Neto vendido en moneda base (facturas menos notas de crédito emitidas, por fecha de emisión; lo anulado no cuenta). */
export async function salesByItem(ws: string, from: string, to: string): Promise<{ from: string; to: string; currency: string; rows: SalesByItemRow[]; total: number }> {
  const s = await ensureBooks(ws);
  const lines = (await getDb()
    .prepare(
      `SELECT l.item_id, l.description, l.quantity, l.net, d.doc_type, d.currency, d.fx_rate, i.name AS item_name
       FROM books_lines l JOIN books_documents d ON d.id = l.doc_id LEFT JOIN books_items i ON i.id = l.item_id
       WHERE d.workspace_id = ? AND d.doc_type IN ('invoice','credit_note') AND d.status NOT IN ('draft','void') AND d.issue_date >= ? AND d.issue_date <= ?`,
    )
    .all(ws, from, to)) as Array<Record<string, unknown>>;
  const byItem = new Map<string, SalesByItemRow>();
  for (const l of lines) {
    const sign = l.doc_type === 'credit_note' ? -1 : 1;
    const name = String(l.item_name ?? l.description ?? '');
    const key = (l.item_id as string) ?? `text:${name.toLowerCase()}`;
    const row = byItem.get(key) ?? { itemId: (l.item_id as string) ?? null, name, quantity: 0, net: 0, count: 0 };
    row.quantity = Math.round((row.quantity + sign * Number(l.quantity)) * 10_000) / 10_000;
    row.net += sign * convert(Number(l.net), String(l.currency), String(l.fx_rate), s.base_currency);
    row.count += 1;
    byItem.set(key, row);
  }
  const rows = [...byItem.values()].sort((a, b) => b.net - a.net);
  return { from, to, currency: s.base_currency, rows, total: rows.reduce((a, r) => a + r.net, 0) };
}

// ---------- Presupuesto contra real ----------

export interface BudgetVarianceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  budget: number;
  actual: number;
  /** A favor es positivo: ingreso de más o gasto de menos. */
  variance: number;
}

export async function budgetVariance(ws: string, budgetId: string, from: string, to: string) {
  const s = await ensureBooks(ws);
  const budget = (await getDb().prepare('SELECT id, name FROM books_budgets WHERE id = ? AND workspace_id = ?').get(budgetId, ws)) as { id: string; name: string } | undefined;
  if (!budget) return null;
  const planned = (await getDb()
    .prepare('SELECT account_id, COALESCE(SUM(amount), 0) AS v FROM books_budget_lines WHERE budget_id = ? AND month >= ? AND month <= ? GROUP BY account_id')
    .all(budgetId, from.slice(0, 7), to.slice(0, 7))) as Array<{ account_id: string; v: number }>;
  const actual = await balances(ws, { from, to, types: ['income', 'expense'] });
  const accounts = await listAccounts(ws, { includeArchived: true });
  const plan = new Map(planned.map((p) => [p.account_id, Number(p.v)]));
  const act = new Map(actual.map((a) => [a.accountId, a.amount]));
  const rows: BudgetVarianceRow[] = accounts
    .filter((a) => (a.type === 'income' || a.type === 'expense') && (plan.has(a.id) || act.has(a.id)))
    .map((a) => {
      const b = plan.get(a.id) ?? 0;
      const x = act.get(a.id) ?? 0;
      return { accountId: a.id, code: a.code, name: a.name, type: a.type, budget: b, actual: x, variance: a.type === 'income' ? x - b : b - x };
    });
  const sum = (t: AccountType, k: 'budget' | 'actual') => rows.filter((r) => r.type === t).reduce((a, r) => a + r[k], 0);
  return {
    budgetId,
    budgetName: budget.name,
    from,
    to,
    currency: s.base_currency,
    rows,
    netBudget: sum('income', 'budget') - sum('expense', 'budget'),
    netActual: sum('income', 'actual') - sum('expense', 'actual'),
  };
}
export type BudgetVariance = NonNullable<Awaited<ReturnType<typeof budgetVariance>>>;

// ---------- Conciliación ----------

export interface ReconciliationRow {
  id: string;
  name: string;
  bookBalance: number;
  statementTotal: number;
  unmatched: number;
  unmatchedAmount: number;
}

/** Por cuenta bancaria: saldo del libro, total del extracto importado y lo que falta conciliar. */
export async function reconciliationSummary(ws: string): Promise<{ currency: string; rows: ReconciliationRow[] }> {
  const s = await ensureBooks(ws);
  const rows = (await getDb()
    .prepare(
      `SELECT b.id, b.name,
         (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM books_journal_lines l WHERE l.account_id = b.account_id) AS book,
         (SELECT COALESCE(SUM(t.amount), 0) FROM books_bank_txns t WHERE t.bank_account_id = b.id AND t.status != 'ignored') AS stmt,
         (SELECT COUNT(*) FROM books_bank_txns t WHERE t.bank_account_id = b.id AND t.status = 'unmatched') AS n,
         (SELECT COALESCE(SUM(t.amount), 0) FROM books_bank_txns t WHERE t.bank_account_id = b.id AND t.status = 'unmatched') AS pending
       FROM books_bank_accounts b WHERE b.workspace_id = ? AND b.archived = 0 ORDER BY b.created_at`,
    )
    .all(ws)) as Array<Record<string, unknown>>;
  return { currency: s.base_currency, rows: rows.map((r) => ({ id: String(r.id), name: String(r.name), bookBalance: Number(r.book), statementTotal: Number(r.stmt), unmatched: Number(r.n), unmatchedAmount: Number(r.pending) })) };
}

// ---------- Comparación y CSV ----------

/** Período con el que se compara: el inmediato anterior de igual largo, o el mismo del año pasado. */
export function comparePeriod(from: string, to: string, mode: 'prev' | 'year'): { from: string; to: string } {
  if (mode === 'year') return { from: addMonths(from, -12), to: addMonths(to, -12) };
  const days = daysBetween(from, to);
  const end = addDays(from, -1);
  return { from: addDays(end, -days), to: end };
}

export function rowsToCsv(rows: Array<Array<string | number>>): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

export function pnlCsv(r: ProfitLoss): string {
  const m = (v: number) => toDecimalString(v, r.currency);
  const sec = (name: string, ls: ReportLine[], total: number) => [...ls.map((l) => [name, l.code, l.name, m(l.amount)]), [name, '', 'total', m(total)]];
  return rowsToCsv([['section', 'code', 'account', 'amount'], ...sec('income', r.income, r.totalIncome), ...sec('cost_of_sales', r.costOfSales, r.totalCostOfSales), ...sec('expenses', r.expenses, r.totalExpenses), ['net_profit', '', '', m(r.netProfit)]]);
}

export function balanceCsv(r: BalanceSheet): string {
  const m = (v: number) => toDecimalString(v, r.currency);
  const sec = (name: string, ls: ReportLine[], total: number) => [...ls.map((l) => [name, l.code, l.name, m(l.amount)]), [name, '', 'total', m(total)]];
  return rowsToCsv([
    ['section', 'code', 'account', 'amount'],
    ...sec('assets', r.assets, r.totalAssets),
    ...sec('liabilities', r.liabilities, r.totalLiabilities),
    ...r.equity.map((l) => ['equity', l.code, l.name, m(l.amount)]),
    ['equity', '', 'prior_years_earnings', m(r.priorEarnings)],
    ['equity', '', 'current_year_earnings', m(r.currentEarnings)],
    ['equity', '', 'total', m(r.totalEquity)],
  ]);
}

export function cashFlowCsv(r: CashFlow): string {
  const m = (v: number) => toDecimalString(v, r.currency);
  return rowsToCsv([['line', 'amount'], ['opening', m(r.opening)], ...r.inflows.map((x) => [`in:${x.category}`, m(x.amount)]), ...r.outflows.map((x) => [`out:${x.category}`, m(-x.amount)]), ['net', m(r.net)], ['closing', m(r.closing)]]);
}

export function agingCsv(r: AgingReport): string {
  const m = (v: number) => toDecimalString(v, r.currency);
  return rowsToCsv([['contact', ...AGING_BUCKETS, 'total'], ...r.rows.map((x) => [x.contactName, ...AGING_BUCKETS.map((b) => m(x.buckets[b])), m(x.total)]), ['total', ...AGING_BUCKETS.map((b) => m(r.totals[b])), m(r.totals.total)]]);
}

export function trialBalanceCsv(r: TrialBalance): string {
  const m = (v: number) => toDecimalString(v, r.currency);
  return rowsToCsv([['code', 'account', 'debit', 'credit'], ...r.rows.map((x) => [x.code, x.name || 'prior_years_earnings', m(x.debit), m(x.credit)]), ['', 'total', m(r.totalDebit), m(r.totalCredit)]]);
}

export function ledgerCsv(r: GeneralLedger): string {
  const m = (v: number) => toDecimalString(v, r.currency);
  const rows: Array<Array<string | number>> = [['code', 'account', 'date', 'journal', 'memo', 'source', 'debit', 'credit', 'balance']];
  for (const a of r.accounts) {
    rows.push([a.code, a.name, r.from, '', 'opening', '', '', '', m(a.opening)]);
    for (const e of a.entries) rows.push([a.code, a.name, e.date, e.number, e.memo, e.sourceType, m(e.debit), m(e.credit), m(e.balance)]);
    rows.push([a.code, a.name, r.to, '', 'closing', '', m(a.totalDebit), m(a.totalCredit), m(a.closing)]);
  }
  return rowsToCsv(rows);
}

export function salesByItemCsv(r: Awaited<ReturnType<typeof salesByItem>>): string {
  return rowsToCsv([['item', 'quantity', 'net'], ...r.rows.map((x) => [x.name, x.quantity, toDecimalString(x.net, r.currency)]), ['total', '', toDecimalString(r.total, r.currency)]]);
}

export function varianceCsv(r: BudgetVariance): string {
  const m = (v: number) => toDecimalString(v, r.currency);
  return rowsToCsv([['code', 'account', 'budget', 'actual', 'variance'], ...r.rows.map((x) => [x.code, x.name, m(x.budget), m(x.actual), m(x.variance)]), ['', 'net', m(r.netBudget), m(r.netActual), m(r.netActual - r.netBudget)]]);
}
