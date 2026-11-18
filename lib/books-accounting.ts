/**
 * Books: centros de costo, presupuestos financieros, bienes de uso con
 * amortización y saldos iniciales. Server-only.
 */
import { getDb } from './db';
import { assertCan, audit, accountByKey, ensureBooks, getAccount, listAccounts } from './books';
import { inTransaction, isLocked, postJournal, reverseJournal, type JournalLineInput } from './books-ledger';
import { BooksError, clean, newId, nowDb, type BooksActor } from './books-schema';
import { budgetMonths } from './books-budget-months';
import { endOfMonth, isValidDate, mulDiv, parseAmount, todayIso } from './books-money';

// ---------- Centros de costo ----------

export type TrackingSlot = 'a' | 'b';

export interface TrackingCategoryDto {
  id: string;
  slot: TrackingSlot;
  name: string;
  options: Array<{ id: string; name: string; archived: boolean }>;
}

export async function listTracking(ws: string): Promise<TrackingCategoryDto[]> {
  const cats = (await getDb().prepare('SELECT * FROM books_tracking_categories WHERE workspace_id = ? ORDER BY slot').all(ws)) as Array<{ id: string; slot: TrackingSlot; name: string }>;
  const opts = (await getDb().prepare('SELECT * FROM books_tracking_options WHERE workspace_id = ? ORDER BY name COLLATE NOCASE').all(ws)) as Array<{ id: string; category_id: string; name: string; archived: number }>;
  return cats.map((c) => ({ id: c.id, slot: c.slot, name: c.name, options: opts.filter((o) => o.category_id === c.id).map((o) => ({ id: o.id, name: o.name, archived: o.archived === 1 })) }));
}

/** Hasta dos categorías (como Xero). Guardar con nombre vacío y sin movimientos borra la categoría. */
export async function saveTrackingCategory(actor: BooksActor, input: { slot: TrackingSlot; name: string }): Promise<TrackingCategoryDto[]> {
  assertCan(actor, 'accounting.write');
  if (input.slot !== 'a' && input.slot !== 'b') throw new BooksError('invalid_input');
  const name = clean(input.name, 80);
  const db = getDb();
  const cur = (await db.prepare('SELECT id FROM books_tracking_categories WHERE workspace_id = ? AND slot = ?').get(actor.ws, input.slot)) as { id: string } | undefined;
  if (!name) {
    if (!cur) return listTracking(actor.ws);
    const col = input.slot === 'a' ? 'tracking_a' : 'tracking_b';
    const used = await db.prepare(`SELECT 1 AS x FROM books_journal_lines l JOIN books_tracking_options o ON o.id = l.${col} WHERE o.category_id = ? LIMIT 1`).get(cur.id);
    if (used) throw new BooksError('tracking_in_use', 409);
    await db.prepare('DELETE FROM books_tracking_categories WHERE id = ?').run(cur.id);
    await audit(actor, 'tracking.delete', 'tracking', cur.id, '');
    return listTracking(actor.ws);
  }
  if (cur) await db.prepare('UPDATE books_tracking_categories SET name = ? WHERE id = ?').run(name, cur.id);
  else await db.prepare('INSERT INTO books_tracking_categories (id, workspace_id, slot, name, created_at) VALUES (?, ?, ?, ?, ?)').run(newId('trk'), actor.ws, input.slot, name, nowDb());
  await audit(actor, 'tracking.save', 'tracking', cur?.id ?? null, name);
  return listTracking(actor.ws);
}

export async function saveTrackingOption(actor: BooksActor, input: { categoryId: string; id?: string; name?: string; archived?: boolean }): Promise<TrackingCategoryDto[]> {
  assertCan(actor, 'accounting.write');
  const db = getDb();
  const cat = await db.prepare('SELECT id FROM books_tracking_categories WHERE id = ? AND workspace_id = ?').get(input.categoryId, actor.ws);
  if (!cat) throw new BooksError('not_found', 404);
  const name = input.name !== undefined ? clean(input.name, 80) : undefined;
  if (input.id) {
    const res = await db
      .prepare('UPDATE books_tracking_options SET name = COALESCE(?, name), archived = COALESCE(?, archived) WHERE id = ? AND category_id = ? AND workspace_id = ?')
      .run(name || null, input.archived === undefined ? null : input.archived ? 1 : 0, input.id, input.categoryId, actor.ws);
    if (!res.changes) throw new BooksError('not_found', 404);
  } else {
    if (!name) throw new BooksError('invalid_name');
    try {
      await db.prepare('INSERT INTO books_tracking_options (id, workspace_id, category_id, name, created_at) VALUES (?, ?, ?, ?, ?)').run(newId('tro'), actor.ws, input.categoryId, name, nowDb());
    } catch (err) {
      if (err instanceof Error && /UNIQUE/i.test(err.message)) throw new BooksError('duplicate_name', 409);
      throw err;
    }
  }
  return listTracking(actor.ws);
}

// ---------- Presupuestos financieros ----------

export interface BudgetDto {
  id: string;
  name: string;
  startMonth: string;
  months: number;
  /** cuenta → mes → importe (positivo, del lado normal de la cuenta). */
  lines: Record<string, Record<string, number>>;
  updatedAt: string;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function getBudget(ws: string, id: string): Promise<BudgetDto | null> {
  const b = (await getDb().prepare('SELECT * FROM books_budgets WHERE id = ? AND workspace_id = ?').get(id, ws)) as { id: string; name: string; start_month: string; months: number; updated_at: string } | undefined;
  if (!b) return null;
  const rows = (await getDb().prepare('SELECT account_id, month, amount FROM books_budget_lines WHERE budget_id = ?').all(id)) as Array<{ account_id: string; month: string; amount: number }>;
  const lines: BudgetDto['lines'] = {};
  for (const r of rows) (lines[r.account_id] ??= {})[r.month] = Number(r.amount);
  return { id: b.id, name: b.name, startMonth: b.start_month, months: Number(b.months), lines, updatedAt: b.updated_at };
}

export async function listBudgets(ws: string): Promise<Array<{ id: string; name: string; startMonth: string; months: number; total: number }>> {
  const rows = (await getDb()
    .prepare(
      `SELECT b.id, b.name, b.start_month, b.months,
         (SELECT COUNT(*) FROM books_budget_lines l WHERE l.budget_id = b.id AND l.amount != 0) AS total
       FROM books_budgets b WHERE b.workspace_id = ? ORDER BY b.start_month DESC, b.name`,
    )
    .all(ws)) as Array<{ id: string; name: string; start_month: string; months: number; total: number }>;
  return rows.map((r) => ({ id: r.id, name: r.name, startMonth: r.start_month, months: Number(r.months), total: Number(r.total) }));
}

export async function saveBudget(actor: BooksActor, input: { id?: string; name?: string; startMonth?: string; months?: number; lines?: Array<{ accountId: string; month: string; amount: number }> }): Promise<BudgetDto> {
  assertCan(actor, 'accounting.write');
  await ensureBooks(actor.ws);
  const cur = input.id ? await getBudget(actor.ws, input.id) : null;
  if (input.id && !cur) throw new BooksError('not_found', 404);
  const name = input.name !== undefined ? clean(input.name, 120) : (cur?.name ?? '');
  if (!name) throw new BooksError('invalid_name');
  const startMonth = input.startMonth ?? cur?.startMonth ?? todayIso().slice(0, 7);
  if (!MONTH_RE.test(startMonth)) throw new BooksError('invalid_date');
  const months = Math.max(1, Math.min(36, Math.trunc(input.months ?? cur?.months ?? 12)));
  const allowed = new Set(budgetMonths(startMonth, months));
  const accounts = new Map((await listAccounts(actor.ws, { includeArchived: true })).map((a) => [a.id, a]));
  if ((input.lines?.length ?? 0) > 5000) throw new BooksError('too_many_lines');
  for (const l of input.lines ?? []) {
    const acc = accounts.get(l.accountId);
    if (!acc || (acc.type !== 'income' && acc.type !== 'expense')) throw new BooksError('invalid_account');
    if (!allowed.has(l.month)) throw new BooksError('invalid_date');
    if (!Number.isSafeInteger(Math.trunc(Number(l.amount)))) throw new BooksError('invalid_amount');
  }
  const id = cur?.id ?? newId('bud');
  const ts = nowDb();
  await inTransaction(async (db) => {
    if (cur) await db.prepare('UPDATE books_budgets SET name = ?, start_month = ?, months = ?, updated_at = ? WHERE id = ?').run(name, startMonth, months, ts, id);
    else await db.prepare('INSERT INTO books_budgets (id, workspace_id, name, start_month, months, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, actor.ws, name, startMonth, months, actor.person, ts, ts);
    for (const l of input.lines ?? []) {
      const amount = Math.trunc(Number(l.amount));
      if (amount === 0) await db.prepare('DELETE FROM books_budget_lines WHERE budget_id = ? AND account_id = ? AND month = ?').run(id, l.accountId, l.month);
      else await db.prepare('INSERT INTO books_budget_lines (budget_id, workspace_id, account_id, month, amount) VALUES (?, ?, ?, ?, ?) ON CONFLICT (budget_id, account_id, month) DO UPDATE SET amount = excluded.amount').run(id, actor.ws, l.accountId, l.month, amount);
    }
    // Meses que quedaron afuera al acortar el presupuesto.
    const keep = [...allowed];
    await db.prepare(`DELETE FROM books_budget_lines WHERE budget_id = ? AND month NOT IN (${keep.map(() => '?').join(',')})`).run(id, ...keep);
  });
  await audit(actor, cur ? 'budget.update' : 'budget.create', 'budget', id, name);
  return (await getBudget(actor.ws, id))!;
}

export async function deleteBudget(actor: BooksActor, id: string): Promise<void> {
  assertCan(actor, 'accounting.write');
  const res = await getDb().prepare('DELETE FROM books_budgets WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
  if (!res.changes) throw new BooksError('not_found', 404);
  await audit(actor, 'budget.delete', 'budget', id, '');
}

// ---------- Bienes de uso ----------

export type DepMethod = 'straight_line' | 'declining' | 'none';

export interface AssetCalc {
  cost: number;
  residual: number;
  method: DepMethod;
  lifeMonths: number | null;
  rateBps: number | null;
  startDate: string;
}

function monthIndex(ym: string): number {
  return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
}

/**
 * Amortización acumulada al cierre de `month` (puro), mes completo desde el mes
 * de inicio. Lineal: se calcula el acumulado de cada mes y no la cuota, así el
 * redondeo no se arrastra y el último mes cierra exacto en costo − residual.
 * Decreciente: tasa anual ÷ 12 sobre el valor libro, con piso en el residual.
 */
export function accumulatedAt(a: AssetCalc, month: string): number {
  const base = Math.max(0, a.cost - a.residual);
  const k = monthIndex(month) - monthIndex(a.startDate.slice(0, 7)) + 1;
  if (k <= 0 || a.method === 'none' || base === 0) return 0;
  if (a.method === 'straight_line') {
    const life = Math.max(1, a.lifeMonths ?? 1);
    return mulDiv(base, Math.min(k, life), life);
  }
  const rate = Math.max(0, a.rateBps ?? 0);
  let acc = 0;
  for (let i = 0; i < Math.min(k, 1200) && acc < base; i++) {
    const dep = mulDiv(a.cost - acc, rate, 120_000);
    if (dep <= 0) break;
    acc = Math.min(base, acc + dep);
  }
  return acc;
}

export interface AssetDto {
  id: string;
  name: string;
  reference: string;
  status: 'draft' | 'registered' | 'disposed';
  assetAccountId: string;
  accumAccountId: string;
  expenseAccountId: string;
  purchaseDate: string;
  startDate: string;
  cost: number;
  residual: number;
  method: DepMethod;
  lifeMonths: number | null;
  rateBps: number | null;
  accumulated: number;
  bookValue: number;
  depreciatedTo: string | null;
  disposedDate: string | null;
  disposalProceeds: number | null;
  hasRuns: boolean;
}

function assetDto(r: Record<string, unknown>): AssetDto {
  return {
    id: String(r.id),
    name: String(r.name),
    reference: String(r.reference ?? ''),
    status: r.status as AssetDto['status'],
    assetAccountId: String(r.asset_account_id),
    accumAccountId: String(r.accum_account_id),
    expenseAccountId: String(r.expense_account_id),
    purchaseDate: String(r.purchase_date),
    startDate: String(r.start_date),
    cost: Number(r.cost),
    residual: Number(r.residual),
    method: r.method as DepMethod,
    lifeMonths: r.life_months == null ? null : Number(r.life_months),
    rateBps: r.rate_bps == null ? null : Number(r.rate_bps),
    accumulated: Number(r.accumulated),
    bookValue: r.status === 'disposed' ? 0 : Number(r.cost) - Number(r.accumulated),
    depreciatedTo: (r.depreciated_to as string) ?? null,
    disposedDate: (r.disposed_date as string) ?? null,
    disposalProceeds: r.disposal_proceeds == null ? null : Number(r.disposal_proceeds),
    hasRuns: Number(r.runs ?? 0) > 0,
  };
}

const ASSET_SELECT = 'SELECT a.*, (SELECT COUNT(*) FROM books_depreciation_runs d WHERE d.asset_id = a.id AND d.reversed = 0) AS runs FROM books_fixed_assets a';

export async function listAssets(ws: string, opts: { q?: string } = {}): Promise<AssetDto[]> {
  await ensureBooks(ws);
  const like = opts.q?.trim() ? `%${opts.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const rows = (await getDb()
    .prepare(`${ASSET_SELECT} WHERE a.workspace_id = ?${like ? " AND (a.name LIKE ? ESCAPE '\\' OR a.reference LIKE ? ESCAPE '\\')" : ''} ORDER BY a.status = 'disposed', a.purchase_date DESC, a.created_at DESC LIMIT 500`)
    .all(...(like ? [ws, like, like] : [ws]))) as Array<Record<string, unknown>>;
  return rows.map(assetDto);
}

export async function getAsset(ws: string, id: string): Promise<AssetDto | null> {
  const r = (await getDb().prepare(`${ASSET_SELECT} WHERE a.id = ? AND a.workspace_id = ?`).get(id, ws)) as Record<string, unknown> | undefined;
  return r ? assetDto(r) : null;
}

async function ensureAccount(ws: string, code: string, name: string, type: 'asset' | 'expense', subtype: string): Promise<string> {
  const db = getDb();
  const found = (await db.prepare('SELECT id FROM books_accounts WHERE workspace_id = ? AND name = ? AND archived = 0').get(ws, name)) as { id: string } | undefined;
  if (found) return found.id;
  const taken = await db.prepare('SELECT 1 AS x FROM books_accounts WHERE workspace_id = ? AND code = ?').get(ws, code);
  const id = newId('acc');
  const ts = nowDb();
  await db.prepare('INSERT INTO books_accounts (id, workspace_id, code, name, type, subtype, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, ws, taken ? `${code}-${id.slice(-4)}` : code, name, type, subtype, ts, ts);
  return id;
}

export interface AssetInput {
  name?: string;
  reference?: string;
  assetAccountId?: string | null;
  accumAccountId?: string | null;
  expenseAccountId?: string | null;
  purchaseDate?: string;
  startDate?: string;
  cost?: number | string;
  residual?: number | string;
  method?: DepMethod;
  lifeMonths?: number | null;
  rateBps?: number | null;
}

async function assetFields(actor: BooksActor, input: AssetInput, cur: AssetDto | null) {
  const s = await ensureBooks(actor.ws);
  const name = input.name !== undefined ? clean(input.name, 160) : (cur?.name ?? '');
  if (!name) throw new BooksError('invalid_name');
  const purchaseDate = input.purchaseDate ?? cur?.purchaseDate ?? todayIso();
  const startDate = input.startDate ?? cur?.startDate ?? purchaseDate;
  if (!isValidDate(purchaseDate) || !isValidDate(startDate) || startDate < purchaseDate) throw new BooksError('invalid_date');
  const money = (v: number | string | undefined, fallback: number) => {
    if (v === undefined) return fallback;
    const n = typeof v === 'number' ? Math.trunc(v) : parseAmount(v, s.base_currency);
    if (n == null || n < 0 || !Number.isSafeInteger(n)) throw new BooksError('invalid_amount');
    return n;
  };
  const cost = money(input.cost, cur?.cost ?? 0);
  const residual = money(input.residual, cur?.residual ?? 0);
  if (cost <= 0 || residual > cost) throw new BooksError('invalid_amount');
  const method: DepMethod = input.method ?? cur?.method ?? 'straight_line';
  if (!['straight_line', 'declining', 'none'].includes(method)) throw new BooksError('invalid_input');
  const lifeMonths = input.lifeMonths !== undefined ? input.lifeMonths : (cur?.lifeMonths ?? null);
  const rateBps = input.rateBps !== undefined ? input.rateBps : (cur?.rateBps ?? null);
  if (method === 'straight_line' && !(Number(lifeMonths) >= 1 && Number(lifeMonths) <= 1200)) throw new BooksError('invalid_life');
  if (method === 'declining' && !(Number(rateBps) >= 1 && Number(rateBps) <= 10_000)) throw new BooksError('invalid_rate');
  const lang = s.country === 'generic' ? 'en' : 'es';
  const pick = async (id: string | null | undefined, fallback: string | undefined, make: () => Promise<string>, allowed: string[]) => {
    const v = id ?? fallback ?? (await make());
    const acc = await getAccount(actor.ws, v);
    if (!acc || acc.archived || !allowed.includes(acc.type)) throw new BooksError('invalid_account');
    return v;
  };
  const assetAccountId = await pick(input.assetAccountId, cur?.assetAccountId, () => ensureAccount(actor.ws, '1500', lang === 'es' ? 'Bienes de uso' : 'Fixed assets', 'asset', 'fixed'), ['asset']);
  const accumAccountId = await pick(input.accumAccountId, cur?.accumAccountId, () => ensureAccount(actor.ws, '1590', lang === 'es' ? 'Amortización acumulada' : 'Accumulated depreciation', 'asset', 'fixed'), ['asset']);
  const expenseAccountId = await pick(input.expenseAccountId, cur?.expenseAccountId, () => ensureAccount(actor.ws, '6800', lang === 'es' ? 'Amortizaciones' : 'Depreciation', 'expense', 'expense'), ['expense']);
  if (assetAccountId === accumAccountId) throw new BooksError('invalid_account');
  return {
    name,
    reference: input.reference !== undefined ? clean(input.reference, 80) : (cur?.reference ?? ''),
    assetAccountId,
    accumAccountId,
    expenseAccountId,
    purchaseDate,
    startDate,
    cost,
    residual,
    method,
    lifeMonths: method === 'straight_line' ? Math.trunc(Number(lifeMonths)) : null,
    rateBps: method === 'declining' ? Math.trunc(Number(rateBps)) : null,
  };
}

export async function createAsset(actor: BooksActor, input: AssetInput): Promise<AssetDto> {
  assertCan(actor, 'accounting.write');
  const f = await assetFields(actor, input, null);
  const id = newId('ast');
  const ts = nowDb();
  await getDb()
    .prepare(
      `INSERT INTO books_fixed_assets (id, workspace_id, name, reference, status, asset_account_id, accum_account_id, expense_account_id, purchase_date, start_date, cost, residual, method, life_months, rate_bps, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, actor.ws, f.name, f.reference, f.assetAccountId, f.accumAccountId, f.expenseAccountId, f.purchaseDate, f.startDate, f.cost, f.residual, f.method, f.lifeMonths, f.rateBps, actor.person, ts, ts);
  await audit(actor, 'asset.create', 'asset', id, f.name);
  return (await getAsset(actor.ws, id))!;
}

/** Con amortización corrida solo cambian el nombre y la referencia: lo demás ya está en el libro. */
export async function updateAsset(actor: BooksActor, id: string, input: AssetInput & { status?: 'registered' | 'draft' }): Promise<AssetDto> {
  assertCan(actor, 'accounting.write');
  const cur = await getAsset(actor.ws, id);
  if (!cur) throw new BooksError('not_found', 404);
  const onlyMeta = Object.keys(input).every((k) => k === 'name' || k === 'reference');
  if (cur.status === 'disposed' && !onlyMeta) throw new BooksError('asset_disposed', 409);
  if (cur.hasRuns && !onlyMeta) throw new BooksError('asset_has_depreciation', 409);
  const f = await assetFields(actor, input, cur);
  const status = input.status ?? cur.status;
  await getDb()
    .prepare(
      `UPDATE books_fixed_assets SET name = ?, reference = ?, status = ?, asset_account_id = ?, accum_account_id = ?, expense_account_id = ?, purchase_date = ?, start_date = ?, cost = ?, residual = ?, method = ?, life_months = ?, rate_bps = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    )
    .run(f.name, f.reference, status, f.assetAccountId, f.accumAccountId, f.expenseAccountId, f.purchaseDate, f.startDate, f.cost, f.residual, f.method, f.lifeMonths, f.rateBps, nowDb(), id, actor.ws);
  await audit(actor, 'asset.update', 'asset', id, f.name);
  return (await getAsset(actor.ws, id))!;
}

export async function deleteAsset(actor: BooksActor, id: string): Promise<void> {
  assertCan(actor, 'accounting.write');
  const cur = await getAsset(actor.ws, id);
  if (!cur) throw new BooksError('not_found', 404);
  if (cur.hasRuns || cur.status === 'disposed') throw new BooksError('asset_has_depreciation', 409);
  await getDb().prepare('DELETE FROM books_fixed_assets WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
  await audit(actor, 'asset.delete', 'asset', id, cur.name);
}

/** Lo que falta amortizar hasta `through` (YYYY-MM), mes por mes, sin escribir nada. */
export async function depreciationPreview(ws: string, through: string): Promise<Array<{ month: string; assetId: string; name: string; amount: number; expenseAccountId: string; accumAccountId: string }>> {
  if (!MONTH_RE.test(through)) throw new BooksError('invalid_date');
  const rows = (await listAssets(ws)).filter((a) => a.status === 'registered' && a.method !== 'none');
  const out: Array<{ month: string; assetId: string; name: string; amount: number; expenseAccountId: string; accumAccountId: string }> = [];
  for (const a of rows) {
    let prev = a.accumulated;
    const firstIdx = a.depreciatedTo ? monthIndex(a.depreciatedTo) + 1 : monthIndex(a.startDate.slice(0, 7));
    for (let idx = firstIdx; idx <= monthIndex(through) && out.length < 20_000; idx++) {
      const month = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
      const acc = accumulatedAt(a, month);
      const amount = acc - prev;
      if (amount > 0) out.push({ month, assetId: a.id, name: a.name, amount, expenseAccountId: a.expenseAccountId, accumAccountId: a.accumAccountId });
      prev = acc;
    }
  }
  return out.sort((x, y) => x.month.localeCompare(y.month));
}

/**
 * Corre la amortización hasta un mes: un asiento por mes, con fecha de fin de
 * mes, en una transacción. Un mes que cae en un período cerrado frena todo: no
 * queda nada a medias. El índice único (bien, mes) impide contar un mes dos veces.
 */
export async function runDepreciation(actor: BooksActor, through: string): Promise<{ months: number; total: number }> {
  assertCan(actor, 'accounting.write');
  const s = await ensureBooks(actor.ws);
  const plan = await depreciationPreview(actor.ws, through);
  if (!plan.length) return { months: 0, total: 0 };
  for (const p of plan) if (isLocked(endOfMonth(p.month), s.lock_date)) throw new BooksError('period_locked', 409, { lockDate: s.lock_date });
  const months = [...new Set(plan.map((p) => p.month))];
  const ts = nowDb();
  await inTransaction(async (db) => {
    for (const month of months) {
      const items = plan.filter((p) => p.month === month);
      const lines: JournalLineInput[] = [];
      for (const it of items) {
        lines.push({ accountId: it.expenseAccountId, debit: it.amount, description: it.name.slice(0, 200) });
        lines.push({ accountId: it.accumAccountId, credit: it.amount, description: it.name.slice(0, 200) });
      }
      const journalId = await postJournal(actor.ws, actor.person, { date: endOfMonth(month), memo: `Depreciation ${month}`, sourceType: 'depreciation', sourceId: month, lines }, { db });
      for (const it of items) {
        await db.prepare('INSERT INTO books_depreciation_runs (id, workspace_id, asset_id, month, amount, journal_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId('dep'), actor.ws, it.assetId, month, it.amount, journalId, ts);
        await db.prepare('UPDATE books_fixed_assets SET accumulated = accumulated + ?, depreciated_to = ?, updated_at = ? WHERE id = ? AND workspace_id = ?').run(it.amount, month, ts, it.assetId, actor.ws);
      }
    }
  });
  const total = plan.reduce((a, p) => a + p.amount, 0);
  await audit(actor, 'asset.depreciate', 'asset', null, `${through} ${total}`);
  return { months: months.length, total };
}

/** Deshace la última corrida (el último mes con asiento): revierte con la misma fecha. */
export async function rollbackDepreciation(actor: BooksActor): Promise<{ month: string | null }> {
  assertCan(actor, 'accounting.write');
  const s = await ensureBooks(actor.ws);
  const last = (await getDb().prepare('SELECT month, journal_id FROM books_depreciation_runs WHERE workspace_id = ? AND reversed = 0 ORDER BY month DESC LIMIT 1').get(actor.ws)) as { month: string; journal_id: string } | undefined;
  if (!last) return { month: null };
  const date = endOfMonth(last.month);
  if (isLocked(date, s.lock_date)) throw new BooksError('period_locked', 409, { lockDate: s.lock_date });
  const ts = nowDb();
  await inTransaction(async (db) => {
    await reverseJournal(actor.ws, actor.person, last.journal_id, { date, memo: `Depreciation ${last.month} rolled back`, db });
    const runs = (await db.prepare('SELECT id, asset_id, amount FROM books_depreciation_runs WHERE journal_id = ? AND reversed = 0').all(last.journal_id)) as Array<{ id: string; asset_id: string; amount: number }>;
    for (const r of runs) {
      await db.prepare('UPDATE books_depreciation_runs SET reversed = 1 WHERE id = ?').run(r.id);
      const prev = (await db.prepare('SELECT MAX(month) AS m FROM books_depreciation_runs WHERE asset_id = ? AND reversed = 0').get(r.asset_id)) as { m: string | null };
      await db.prepare('UPDATE books_fixed_assets SET accumulated = accumulated - ?, depreciated_to = ?, updated_at = ? WHERE id = ?').run(r.amount, prev.m ?? null, ts, r.asset_id);
    }
  });
  await audit(actor, 'asset.rollback', 'asset', null, last.month);
  return { month: last.month };
}

/**
 * Baja de un bien: saca costo y amortización acumulada, entra lo cobrado, y la
 * diferencia es resultado. Primero hay que tener amortizado hasta el mes
 * anterior a la baja, para que el resultado sea el correcto.
 */
export async function disposeAsset(actor: BooksActor, id: string, input: { date?: string; proceeds?: number | string; proceedsAccountId?: string | null; gainLossAccountId?: string | null }): Promise<AssetDto> {
  assertCan(actor, 'accounting.write');
  const s = await ensureBooks(actor.ws);
  const a = await getAsset(actor.ws, id);
  if (!a) throw new BooksError('not_found', 404);
  if (a.status !== 'registered') throw new BooksError('invalid_status', 409);
  const date = input.date ?? todayIso();
  if (!isValidDate(date) || date < a.purchaseDate) throw new BooksError('invalid_date');
  const prevMonthIdx = monthIndex(date.slice(0, 7)) - 1;
  const needs = a.method !== 'none' && a.startDate.slice(0, 7) <= date.slice(0, 7) && (a.depreciatedTo ? monthIndex(a.depreciatedTo) : monthIndex(a.startDate.slice(0, 7)) - 1) < prevMonthIdx && a.accumulated < a.cost - a.residual;
  if (needs) throw new BooksError('depreciate_first', 409);
  const proceeds = input.proceeds === undefined || input.proceeds === '' ? 0 : typeof input.proceeds === 'number' ? Math.trunc(input.proceeds) : parseAmount(input.proceeds, s.base_currency);
  if (proceeds == null || proceeds < 0) throw new BooksError('invalid_amount');
  const proceedsAccount = input.proceedsAccountId ? await getAccount(actor.ws, input.proceedsAccountId) : await accountByKey(actor.ws, 'bank');
  if (!proceedsAccount || proceedsAccount.type !== 'asset') throw new BooksError('invalid_account');
  const gainLoss = input.gainLossAccountId ? await getAccount(actor.ws, input.gainLossAccountId) : await getAccount(actor.ws, a.expenseAccountId);
  if (!gainLoss || (gainLoss.type !== 'income' && gainLoss.type !== 'expense')) throw new BooksError('invalid_account');
  const book = a.cost - a.accumulated;
  const diff = proceeds - book;
  const lines: JournalLineInput[] = [
    { accountId: a.assetAccountId, credit: a.cost, description: a.name },
    { accountId: a.accumAccountId, debit: a.accumulated, description: a.name },
    { accountId: proceedsAccount.id, debit: proceeds, description: a.name },
    diff > 0 ? { accountId: gainLoss.id, credit: diff, description: a.name } : { accountId: gainLoss.id, debit: -diff, description: a.name },
  ];
  const ts = nowDb();
  await inTransaction(async (db) => {
    const journalId = await postJournal(actor.ws, actor.person, { date, memo: `Disposal ${a.name}`.slice(0, 200), sourceType: 'disposal', sourceId: a.id, lines }, { db });
    const res = await db.prepare("UPDATE books_fixed_assets SET status = 'disposed', disposed_date = ?, disposal_proceeds = ?, disposal_journal_id = ?, updated_at = ? WHERE id = ? AND status = 'registered'").run(date, proceeds, journalId, ts, id);
    if (!res.changes) throw new BooksError('invalid_status', 409);
  });
  await audit(actor, 'asset.dispose', 'asset', id, `${proceeds}`);
  return (await getAsset(actor.ws, id))!;
}

// ---------- Saldos iniciales ----------

/**
 * Saldos al arrancar en Books (Xero: conversion balances). Un asiento con
 * contrapartida en resultados no asignados. Deudores y proveedores no van acá:
 * esos saldos se cargan como facturas abiertas, para que la antigüedad cierre.
 */
export async function createOpeningBalances(actor: BooksActor, input: { date: string; lines: Array<{ accountId: string; debit?: number; credit?: number }> }): Promise<{ journalId: string }> {
  assertCan(actor, 'accounting.write');
  await ensureBooks(actor.ws);
  if (!isValidDate(input.date)) throw new BooksError('invalid_date');
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 500) throw new BooksError('invalid_input');
  const retained = await accountByKey(actor.ws, 'retained');
  let d = 0;
  let c = 0;
  const lines: JournalLineInput[] = [];
  for (const l of input.lines) {
    const acc = await getAccount(actor.ws, l.accountId);
    if (!acc) throw new BooksError('invalid_account');
    if (acc.subtype === 'receivable' || acc.subtype === 'payable') throw new BooksError('account_needs_document');
    const debit = Math.trunc(Number(l.debit ?? 0));
    const credit = Math.trunc(Number(l.credit ?? 0));
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit < 0 || credit < 0) throw new BooksError('invalid_amount');
    d += debit;
    c += credit;
    lines.push({ accountId: acc.id, debit, credit });
  }
  if (d !== c) lines.push(d > c ? { accountId: retained.id, credit: d - c, description: 'Opening balance' } : { accountId: retained.id, debit: c - d, description: 'Opening balance' });
  const journalId = await postJournal(actor.ws, actor.person, { date: input.date, memo: 'Opening balances', sourceType: 'opening', lines });
  await audit(actor, 'journal.opening', 'journal', journalId, input.date);
  return { journalId };
}
