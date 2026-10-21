/**
 * CRM — ajustes del workspace (moneda base, quotes) y tipos de cambio manuales.
 * Server-only. `rate` = unidades de la moneda base por 1 unidad de `currency`.
 * Reportes y dashboards convierten a la base con baseAmountSql().
 */
import { getDb, type CrmExchangeRateRow, type CrmSettingsRow, type Db } from './db';
import type { CurrencyContext } from './crm-money';
import { normalizeCallOutcomes, parseCallOutcomes } from './crm-calls';

export const CURRENCY_RE = /^[A-Z]{3}$/;

function nowDb(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export interface CrmSettings {
  baseCurrency: string;
  quoteAcceptMovesDeal: boolean;
  /** Resultados de llamada del workspace (o los de siempre: claves traducibles). */
  callOutcomes: string[];
  /** true si el workspace configuró los suyos. */
  callOutcomesCustom: boolean;
}

export async function getCrmSettings(userId: string, db: Db = getDb()): Promise<CrmSettings> {
  const row = (await db.prepare('SELECT * FROM crm_settings WHERE user_id = ?').get(userId)) as
    | CrmSettingsRow
    | undefined;
  return {
    baseCurrency: row?.base_currency || 'USD',
    quoteAcceptMovesDeal: !!row?.quote_accept_moves_deal,
    callOutcomes: parseCallOutcomes(row?.call_outcomes),
    callOutcomesCustom: normalizeCallOutcomes(safeJson(row?.call_outcomes)).length > 0,
  };
}

function safeJson(v: string | null | undefined): unknown {
  try {
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export async function updateCrmSettings(
  userId: string,
  patch: Partial<Pick<CrmSettings, 'baseCurrency' | 'quoteAcceptMovesDeal'>> & { callOutcomes?: string[] | null },
  db: Db = getDb(),
): Promise<CrmSettings> {
  const current = await getCrmSettings(userId, db);
  const baseCurrency = patch.baseCurrency ? patch.baseCurrency.toUpperCase() : current.baseCurrency;
  const quoteAcceptMovesDeal = patch.quoteAcceptMovesDeal ?? current.quoteAcceptMovesDeal;
  if (!CURRENCY_RE.test(baseCurrency)) throw new Error('invalid_currency');
  // callOutcomes: undefined = sin cambios; null o lista vacía = los de siempre.
  const outcomes =
    patch.callOutcomes === undefined
      ? current.callOutcomesCustom
        ? JSON.stringify(current.callOutcomes)
        : null
      : normalizeCallOutcomes(patch.callOutcomes ?? []).length
        ? JSON.stringify(normalizeCallOutcomes(patch.callOutcomes))
        : null;
  await db
    .prepare(
      `INSERT INTO crm_settings (user_id, base_currency, quote_accept_moves_deal, call_outcomes, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET base_currency = excluded.base_currency,
         quote_accept_moves_deal = excluded.quote_accept_moves_deal, call_outcomes = excluded.call_outcomes,
         updated_at = excluded.updated_at`,
    )
    .run(userId, baseCurrency, quoteAcceptMovesDeal ? 1 : 0, outcomes, nowDb());
  const next = await getCrmSettings(userId, db);
  // La base vale 1 por definición: un rate guardado para ella no aplica.
  await db.prepare('DELETE FROM crm_exchange_rates WHERE user_id = ? AND currency = ?').run(userId, next.baseCurrency);
  return next;
}

export async function listExchangeRates(userId: string, db: Db = getDb()): Promise<CrmExchangeRateRow[]> {
  return (await db
    .prepare('SELECT * FROM crm_exchange_rates WHERE user_id = ? ORDER BY currency ASC')
    .all(userId)) as CrmExchangeRateRow[];
}

export async function setExchangeRate(
  userId: string,
  currency: string,
  rate: number,
  db: Db = getDb(),
): Promise<CrmExchangeRateRow> {
  const cur = currency.toUpperCase();
  if (!CURRENCY_RE.test(cur)) throw new Error('invalid_currency');
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('invalid_rate');
  await db
    .prepare(
      `INSERT INTO crm_exchange_rates (user_id, currency, rate, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, currency) DO UPDATE SET rate = excluded.rate, updated_at = excluded.updated_at`,
    )
    .run(userId, cur, rate, nowDb());
  return (await db
    .prepare('SELECT * FROM crm_exchange_rates WHERE user_id = ? AND currency = ?')
    .get(userId, cur)) as CrmExchangeRateRow;
}

export async function deleteExchangeRate(userId: string, currency: string, db: Db = getDb()): Promise<boolean> {
  return (
    (await db
      .prepare('DELETE FROM crm_exchange_rates WHERE user_id = ? AND currency = ?')
      .run(userId, currency.toUpperCase())).changes > 0
  );
}

export async function getCurrencyContext(userId: string, db: Db = getDb()): Promise<CurrencyContext> {
  const { baseCurrency } = await getCrmSettings(userId, db);
  const rates: Record<string, number> = {};
  for (const r of await listExchangeRates(userId, db)) rates[r.currency] = r.rate;
  return { base: baseCurrency, rates };
}

/**
 * Expresión SQL: amount del deal (alias `a`) convertido a la moneda base del
 * workspace. Sin tipo de cambio cargado se toma 1:1 (los reportes muestran un
 * aviso con las monedas sin rate: ver missingRates()).
 */
export function baseAmountSql(alias = 'd', column = 'amount'): string {
  const base = `COALESCE((SELECT cs.base_currency FROM crm_settings cs WHERE cs.user_id = ${alias}.user_id), 'USD')`;
  return `(${alias}.${column} * CASE WHEN upper(${alias}.currency) = ${base} THEN 1 ELSE COALESCE(
    (SELECT xr.rate FROM crm_exchange_rates xr WHERE xr.user_id = ${alias}.user_id AND xr.currency = upper(${alias}.currency)), 1) END)`;
}

/** Monedas usadas por deals del workspace que no tienen tipo de cambio a la base. */
export async function missingRates(userId: string, db: Db = getDb()): Promise<string[]> {
  const ctx = await getCurrencyContext(userId, db);
  const rows = (await db
    .prepare("SELECT DISTINCT upper(currency) AS c FROM crm_deals WHERE user_id = ? AND currency != ''")
    .all(userId)) as Array<{ c: string }>;
  return rows.map((r) => r.c).filter((c) => c !== ctx.base && !(c in ctx.rates)).sort();
}
