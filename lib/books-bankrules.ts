/**
 * Books: reglas bancarias (sugieren la cuenta de un movimiento y se aplican de
 * a una o en bloque) y transferencias entre cuentas propias. Server-only.
 */
import { getDb } from './db';
import { assertCan, audit, ensureBooks, getAccount } from './books';
import { getBankAccountRow, listTxns, reconcile, type BankTxnDto } from './books-bank';
import { postJournal } from './books-ledger';
import { BooksError, clean, newId, nowDb, type BooksActor } from './books-schema';
import { isValidDate, parseAmount, todayIso } from './books-money';

export type RuleOp = 'contains' | 'starts' | 'equals';
export type RuleDirection = 'any' | 'in' | 'out';

export interface BankRuleDto {
  id: string;
  name: string;
  direction: RuleDirection;
  op: RuleOp;
  text: string;
  minAmount: number | null;
  maxAmount: number | null;
  bankAccountId: string | null;
  accountId: string;
  accountName: string;
  memo: string;
  appliedCount: number;
}

function folded(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/** ¿La regla agarra este movimiento? Puro. Importes en valor absoluto, inclusive en los dos extremos. */
export function ruleMatches(rule: Pick<BankRuleDto, 'direction' | 'op' | 'text' | 'minAmount' | 'maxAmount' | 'bankAccountId'>, txn: { description: string; amount: number }, bankAccountId?: string): boolean {
  if (rule.bankAccountId && bankAccountId && rule.bankAccountId !== bankAccountId) return false;
  if (rule.direction === 'in' && txn.amount <= 0) return false;
  if (rule.direction === 'out' && txn.amount >= 0) return false;
  const abs = Math.abs(txn.amount);
  if (rule.minAmount != null && abs < rule.minAmount) return false;
  if (rule.maxAmount != null && abs > rule.maxAmount) return false;
  const d = folded(txn.description);
  const t = folded(rule.text);
  if (!t) return false;
  if (rule.op === 'equals') return d === t;
  if (rule.op === 'starts') return d.startsWith(t);
  return d.includes(t);
}

/** La primera regla de la lista que agarra el movimiento gana. */
export function firstRule<T extends Parameters<typeof ruleMatches>[0]>(rules: T[], txn: { description: string; amount: number }, bankAccountId?: string): T | null {
  return rules.find((r) => ruleMatches(r, txn, bankAccountId)) ?? null;
}

export async function listRules(ws: string): Promise<BankRuleDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT r.*, a.code, a.name AS account_name FROM books_bank_rules r LEFT JOIN books_accounts a ON a.id = r.account_id
       WHERE r.workspace_id = ? AND r.archived = 0 ORDER BY r.position, r.created_at`,
    )
    .all(ws)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    direction: r.direction as RuleDirection,
    op: r.match_op as RuleOp,
    text: String(r.match_text),
    minAmount: r.min_amount == null ? null : Number(r.min_amount),
    maxAmount: r.max_amount == null ? null : Number(r.max_amount),
    bankAccountId: (r.bank_account_id as string) ?? null,
    accountId: String(r.account_id),
    accountName: `${String(r.code ?? '')} ${String(r.account_name ?? '')}`.trim(),
    memo: String(r.memo ?? ''),
    appliedCount: Number(r.applied_count ?? 0),
  }));
}

export interface RuleInput {
  name?: string;
  direction?: RuleDirection;
  op?: RuleOp;
  text?: string;
  minAmount?: number | null;
  maxAmount?: number | null;
  bankAccountId?: string | null;
  accountId?: string;
  memo?: string;
}

async function checkTarget(ws: string, accountId: string | undefined): Promise<string> {
  const acc = accountId ? await getAccount(ws, accountId) : null;
  if (!acc || acc.archived) throw new BooksError('invalid_account');
  // Deudores y proveedores se mueven con documentos: si no, el saldo por cliente deja de coincidir con el libro.
  if (acc.subtype === 'receivable' || acc.subtype === 'payable') throw new BooksError('account_needs_document');
  return acc.id;
}

function amounts(input: RuleInput) {
  const check = (v: number | null | undefined) => {
    if (v == null) return null;
    const n = Math.trunc(Number(v));
    if (!Number.isSafeInteger(n) || n < 0) throw new BooksError('invalid_amount');
    return n;
  };
  const min = check(input.minAmount);
  const max = check(input.maxAmount);
  if (min != null && max != null && min > max) throw new BooksError('invalid_amount');
  return { min, max };
}

export async function createRule(actor: BooksActor, input: RuleInput): Promise<BankRuleDto> {
  assertCan(actor, 'banking.write');
  const text = clean(input.text ?? '', 120);
  if (!text) throw new BooksError('invalid_rule_text');
  const accountId = await checkTarget(actor.ws, input.accountId);
  if (input.bankAccountId && !(await getBankAccountRow(actor.ws, input.bankAccountId))) throw new BooksError('invalid_account');
  const { min, max } = amounts(input);
  const id = newId('rul');
  const ts = nowDb();
  const pos = (await getDb().prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM books_bank_rules WHERE workspace_id = ?').get(actor.ws)) as { n: number };
  await getDb()
    .prepare(
      `INSERT INTO books_bank_rules (id, workspace_id, name, direction, match_op, match_text, min_amount, max_amount, bank_account_id, account_id, memo, position, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, actor.ws, clean(input.name ?? '', 120) || text, ['in', 'out'].includes(input.direction ?? '') ? input.direction : 'any', ['starts', 'equals'].includes(input.op ?? '') ? input.op : 'contains', text, min, max, input.bankAccountId ?? null, accountId, clean(input.memo ?? '', 200), Number(pos.n), actor.person, ts, ts);
  await audit(actor, 'rule.create', 'bank_rule', id, text);
  return (await listRules(actor.ws)).find((r) => r.id === id)!;
}

export async function updateRule(actor: BooksActor, id: string, input: RuleInput): Promise<BankRuleDto> {
  assertCan(actor, 'banking.write');
  const cur = (await listRules(actor.ws)).find((r) => r.id === id);
  if (!cur) throw new BooksError('not_found', 404);
  const text = input.text !== undefined ? clean(input.text, 120) : cur.text;
  if (!text) throw new BooksError('invalid_rule_text');
  const accountId = input.accountId !== undefined ? await checkTarget(actor.ws, input.accountId) : cur.accountId;
  const bankAccountId = input.bankAccountId !== undefined ? input.bankAccountId : cur.bankAccountId;
  if (bankAccountId && !(await getBankAccountRow(actor.ws, bankAccountId))) throw new BooksError('invalid_account');
  const { min, max } = amounts({ minAmount: input.minAmount !== undefined ? input.minAmount : cur.minAmount, maxAmount: input.maxAmount !== undefined ? input.maxAmount : cur.maxAmount });
  await getDb()
    .prepare('UPDATE books_bank_rules SET name = ?, direction = ?, match_op = ?, match_text = ?, min_amount = ?, max_amount = ?, bank_account_id = ?, account_id = ?, memo = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
    .run(
      input.name !== undefined ? clean(input.name, 120) || text : cur.name,
      input.direction && ['any', 'in', 'out'].includes(input.direction) ? input.direction : cur.direction,
      input.op && ['contains', 'starts', 'equals'].includes(input.op) ? input.op : cur.op,
      text,
      min,
      max,
      bankAccountId,
      accountId,
      input.memo !== undefined ? clean(input.memo, 200) : cur.memo,
      nowDb(),
      id,
      actor.ws,
    );
  await audit(actor, 'rule.update', 'bank_rule', id, text);
  return (await listRules(actor.ws)).find((r) => r.id === id)!;
}

export async function deleteRule(actor: BooksActor, id: string): Promise<void> {
  assertCan(actor, 'banking.write');
  const res = await getDb().prepare('DELETE FROM books_bank_rules WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
  if (!res.changes) throw new BooksError('not_found', 404);
  await audit(actor, 'rule.delete', 'bank_rule', id, '');
}

export interface RuleSuggestion {
  ruleId: string;
  ruleName: string;
  accountId: string;
  accountName: string;
  memo: string;
}

/** Sugerencia de regla por cada movimiento sin conciliar de la cuenta. Solo lee. */
export async function ruleSuggestions(ws: string, bankAccountId: string, txns?: BankTxnDto[]): Promise<Record<string, RuleSuggestion>> {
  const rules = await listRules(ws);
  if (!rules.length) return {};
  const list = txns ?? (await listTxns(ws, bankAccountId, { status: 'unmatched', limit: 300 }));
  const out: Record<string, RuleSuggestion> = {};
  for (const t of list) {
    if (t.status !== 'unmatched') continue;
    const r = firstRule(rules, t, bankAccountId);
    if (r) out[t.id] = { ruleId: r.id, ruleName: r.name, accountId: r.accountId, accountName: r.accountName, memo: r.memo };
  }
  return out;
}

/** Concilia en bloque lo que tiene regla (hasta 200 por vez). Lo que falla queda pendiente y se informa. */
export async function applyRules(actor: BooksActor, bankAccountId: string): Promise<{ applied: number; failed: number; remaining: number }> {
  assertCan(actor, 'banking.write');
  if (!(await getBankAccountRow(actor.ws, bankAccountId))) throw new BooksError('not_found', 404);
  const suggestions = await ruleSuggestions(actor.ws, bankAccountId);
  const ids = Object.keys(suggestions);
  let applied = 0;
  let failed = 0;
  const txns = await listTxns(actor.ws, bankAccountId, { status: 'unmatched', limit: 300 });
  for (const id of ids.slice(0, 200)) {
    const sug = suggestions[id];
    const t = txns.find((x) => x.id === id);
    try {
      await reconcile(actor, id, { kind: 'account', accountId: sug.accountId, description: sug.memo || t?.description });
      await getDb().prepare('UPDATE books_bank_rules SET applied_count = applied_count + 1 WHERE id = ? AND workspace_id = ?').run(sug.ruleId, actor.ws);
      applied++;
    } catch {
      failed++;
    }
  }
  return { applied, failed, remaining: Math.max(0, ids.length - 200) };
}

// ---------- Transferencias ----------

export async function createTransfer(actor: BooksActor, input: { fromId: string; toId: string; amount: number | string; date?: string; reference?: string }): Promise<{ journalId: string }> {
  assertCan(actor, 'banking.write');
  const s = await ensureBooks(actor.ws);
  if (input.fromId === input.toId) throw new BooksError('same_account');
  const from = await getBankAccountRow(actor.ws, input.fromId);
  const to = await getBankAccountRow(actor.ws, input.toId);
  if (!from || !to || from.archived || to.archived) throw new BooksError('invalid_account');
  const amount = typeof input.amount === 'number' ? Math.trunc(input.amount) : parseAmount(input.amount, s.base_currency);
  if (amount == null || amount <= 0) throw new BooksError('invalid_amount');
  const date = input.date ?? todayIso();
  if (!isValidDate(date)) throw new BooksError('invalid_date');
  const memo = clean(input.reference ?? '', 200) || `${from.name} → ${to.name}`;
  const journalId = await postJournal(actor.ws, actor.person, {
    date,
    memo,
    sourceType: 'transfer',
    lines: [
      { accountId: to.account_id, debit: amount, description: memo },
      { accountId: from.account_id, credit: amount, description: memo },
    ],
  });
  await audit(actor, 'bank.transfer', 'journal', journalId, `${amount}`);
  return { journalId };
}
