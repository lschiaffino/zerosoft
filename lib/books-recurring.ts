/**
 * Books: facturas recurrentes, vencimientos y recordatorios de pago (cron).
 * Server-only.
 *
 * Todo lo que corre en el cron reclama cada fila con compare-and-set, así
 * dos corridas a la vez no hacen lo mismo dos veces:
 * - recurrente: claimed_until (lease de 5 minutos) + next_date; la factura
 *   del período se busca por (recurring_id, issue_date) antes de crearla.
 * - vencida: status 'sent'|'partial' → 'overdue' con WHERE status = ?.
 * - recordatorio: reminder_count n → n+1 con WHERE reminder_count = n.
 */
import { getDb } from './db';
import { assertCan, audit, ensureBooks, getContactRow, reminderSettings, type SettingsRow } from './books';
import { approveDocument, createDraft, getDocRow, getDocument, type DocInput, type LineInputDto } from './books-docs';
import { emailDocument, onInvoiceOverdue, sendDocument } from './books-integrations';
import { BooksError, clean, FREQUENCIES, newId, nowDb, parseJson, type BooksActor, type Frequency } from './books-schema';
import { addDays, addMonths, daysBetween, isValidDate, todayIso } from './books-money';

export interface RecurringRow {
  id: string;
  workspace_id: string;
  name: string;
  contact_id: string;
  template: string;
  frequency: Frequency;
  interval_count: number;
  next_date: string;
  end_date: string | null;
  auto_send: number;
  status: 'active' | 'paused' | 'ended';
  last_doc_id: string | null;
  run_count: number;
  claimed_until: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecurringTemplate {
  currency?: string;
  fxRate?: string;
  termsDays?: number | null;
  seriesId?: string | null;
  reference?: string;
  notes?: string;
  lines: LineInputDto[];
  /** Día del mes de la primera emisión (31 sigue siendo fin de mes después de febrero). */
  anchorDay?: number;
}

/** Próxima fecha (pura). Mensual y más: mismo día del mes, ajustado a fin de mes desde el día de inicio. */
export function nextRunDate(frequency: Frequency, interval: number, from: string, anchorDay?: number): string {
  const n = Math.max(1, Math.trunc(interval));
  switch (frequency) {
    case 'weekly':
      return addDays(from, 7 * n);
    case 'monthly':
      return addMonths(from, n, anchorDay);
    case 'quarterly':
      return addMonths(from, 3 * n, anchorDay);
    case 'yearly':
      return addMonths(from, 12 * n, anchorDay);
  }
}

export interface RecurringDto {
  id: string;
  name: string;
  contactId: string;
  contactName: string;
  template: RecurringTemplate;
  frequency: Frequency;
  interval: number;
  nextDate: string;
  endDate: string | null;
  autoSend: boolean;
  status: RecurringRow['status'];
  lastDocId: string | null;
  runCount: number;
  updatedAt: string;
}

async function toDto(r: RecurringRow): Promise<RecurringDto> {
  const c = await getContactRow(r.workspace_id, r.contact_id);
  return {
    id: r.id,
    name: r.name,
    contactId: r.contact_id,
    contactName: c?.name ?? '',
    template: parseJson<RecurringTemplate>(r.template, { lines: [] }),
    frequency: r.frequency,
    interval: r.interval_count,
    nextDate: r.next_date,
    endDate: r.end_date,
    autoSend: r.auto_send === 1,
    status: r.status,
    lastDocId: r.last_doc_id,
    runCount: r.run_count,
    updatedAt: r.updated_at,
  };
}

export async function getRecurringRow(ws: string, id: string): Promise<RecurringRow | null> {
  return ((await getDb().prepare('SELECT * FROM books_recurring WHERE id = ? AND workspace_id = ?').get(id, ws)) as RecurringRow | undefined) ?? null;
}

export async function getRecurring(ws: string, id: string): Promise<RecurringDto | null> {
  const r = await getRecurringRow(ws, id);
  return r ? toDto(r) : null;
}

export async function listRecurring(ws: string, opts: { q?: string } = {}): Promise<RecurringDto[]> {
  await ensureBooks(ws);
  const rows = (await getDb()
    .prepare(`SELECT * FROM books_recurring WHERE workspace_id = ?${opts.q ? " AND name LIKE ? ESCAPE '\\'" : ''} ORDER BY status = 'active' DESC, next_date ASC LIMIT 500`)
    .all(...(opts.q ? [ws, `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`] : [ws]))) as RecurringRow[];
  return Promise.all(rows.map(toDto));
}

export interface RecurringInput {
  name?: string;
  contactId?: string;
  template?: RecurringTemplate;
  frequency?: Frequency;
  interval?: number;
  nextDate?: string;
  endDate?: string | null;
  autoSend?: boolean;
  status?: 'active' | 'paused';
}

function validTemplate(t: RecurringTemplate | undefined): RecurringTemplate {
  if (!t || !Array.isArray(t.lines) || !t.lines.length || t.lines.length > 200) throw new BooksError('lines_required');
  return {
    currency: t.currency,
    fxRate: t.fxRate,
    termsDays: t.termsDays ?? null,
    seriesId: t.seriesId ?? null,
    reference: clean(t.reference ?? '', 120),
    notes: clean(t.notes ?? '', 4000),
    lines: t.lines.map((l) => ({ itemId: l.itemId ?? null, description: clean(l.description ?? '', 1000), quantity: Number(l.quantity ?? 1), unitPrice: l.unitPrice, discountBps: l.discountBps ?? 0, taxRateId: l.taxRateId ?? null, accountId: l.accountId ?? null })),
  };
}

export async function createRecurring(actor: BooksActor, input: RecurringInput): Promise<RecurringDto> {
  assertCan(actor, 'invoices.write');
  await ensureBooks(actor.ws);
  const name = clean(input.name ?? '', 120);
  if (!name) throw new BooksError('invalid_name');
  const contact = await getContactRow(actor.ws, input.contactId);
  if (!contact) throw new BooksError('invalid_contact');
  const frequency = input.frequency ?? 'monthly';
  if (!(FREQUENCIES as readonly string[]).includes(frequency)) throw new BooksError('invalid_frequency');
  const nextDate = input.nextDate ?? todayIso();
  if (!isValidDate(nextDate)) throw new BooksError('invalid_date');
  if (input.endDate && (!isValidDate(input.endDate) || input.endDate < nextDate)) throw new BooksError('invalid_end_date');
  const template = validTemplate(input.template);
  // El template tiene que poder armar una factura: se prueba como borrador y se descarta.
  const probe = await createDraft(actor, { docType: 'invoice', contactId: contact.id, ...template });
  await getDb().prepare("DELETE FROM books_documents WHERE id = ? AND status = 'draft'").run(probe.id);
  const id = newId('rec');
  const ts = nowDb();
  await getDb()
    .prepare(
      `INSERT INTO books_recurring (id, workspace_id, name, contact_id, template, frequency, interval_count, next_date, end_date, auto_send, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .run(id, actor.ws, name, contact.id, JSON.stringify({ ...template, anchorDay: Number(nextDate.slice(8, 10)) }), frequency, Math.max(1, Math.min(12, Math.trunc(input.interval ?? 1))), nextDate, input.endDate ?? null, input.autoSend ? 1 : 0, actor.person, ts, ts);
  await audit(actor, 'recurring.create', 'recurring', id, name);
  return (await getRecurring(actor.ws, id))!;
}

export async function updateRecurring(actor: BooksActor, id: string, input: RecurringInput): Promise<RecurringDto> {
  assertCan(actor, 'invoices.write');
  const r = await getRecurringRow(actor.ws, id);
  if (!r) throw new BooksError('not_found', 404);
  const name = input.name !== undefined ? clean(input.name, 120) : r.name;
  if (!name) throw new BooksError('invalid_name');
  const contactId = input.contactId ?? r.contact_id;
  if (input.contactId && !(await getContactRow(actor.ws, input.contactId))) throw new BooksError('invalid_contact');
  const frequency = input.frequency ?? r.frequency;
  if (!(FREQUENCIES as readonly string[]).includes(frequency)) throw new BooksError('invalid_frequency');
  const nextDate = input.nextDate ?? r.next_date;
  if (!isValidDate(nextDate)) throw new BooksError('invalid_date');
  const endDate = input.endDate !== undefined ? input.endDate : r.end_date;
  if (endDate && (!isValidDate(endDate) || endDate < nextDate)) throw new BooksError('invalid_end_date');
  const template = input.template
    ? { ...validTemplate(input.template), anchorDay: Number(nextDate.slice(8, 10)) }
    : { ...parseJson<RecurringTemplate>(r.template, { lines: [] }), ...(input.nextDate ? { anchorDay: Number(nextDate.slice(8, 10)) } : {}) };
  const status = input.status ?? (r.status === 'ended' ? 'ended' : r.status);
  await getDb()
    .prepare(
      `UPDATE books_recurring SET name = ?, contact_id = ?, template = ?, frequency = ?, interval_count = ?, next_date = ?, end_date = ?, auto_send = ?, status = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    )
    .run(name, contactId, JSON.stringify(template), frequency, Math.max(1, Math.min(12, Math.trunc(input.interval ?? r.interval_count))), nextDate, endDate, input.autoSend === undefined ? r.auto_send : input.autoSend ? 1 : 0, status, nowDb(), id, actor.ws);
  await audit(actor, 'recurring.update', 'recurring', id, name);
  return (await getRecurring(actor.ws, id))!;
}

export async function deleteRecurring(actor: BooksActor, id: string): Promise<void> {
  assertCan(actor, 'invoices.write');
  const r = await getRecurringRow(actor.ws, id);
  if (!r) throw new BooksError('not_found', 404);
  // Las facturas ya generadas quedan (con su recurring_id como referencia).
  await getDb().prepare('DELETE FROM books_recurring WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
  await audit(actor, 'recurring.delete', 'recurring', id, r.name);
}

const LEASE_MS = 5 * 60_000;

/**
 * Genera la factura de un recurrente reclamado: busca primero la del mismo
 * período (si una corrida anterior la creó y cortó antes de avanzar), la
 * aprueba, la envía si corresponde y avanza next_date con compare-and-set.
 */
async function runOne(r: RecurringRow, today: string): Promise<'created' | 'skipped' | 'ended'> {
  const db = getDb();
  const actor: BooksActor = { ws: r.workspace_id, person: r.created_by ?? r.workspace_id, admin: true, role: 'accountant' };
  const tpl = parseJson<RecurringTemplate>(r.template, { lines: [] });
  const existing = (await db.prepare('SELECT id, status FROM books_documents WHERE workspace_id = ? AND recurring_id = ? AND issue_date = ?').get(r.workspace_id, r.id, r.next_date)) as
    | { id: string; status: string }
    | undefined;
  let docId = existing?.id ?? null;
  if (!docId) {
    const { anchorDay: _a, ...docTpl } = tpl;
    const input: DocInput = { docType: 'invoice', contactId: r.contact_id, issueDate: r.next_date, ...docTpl };
    docId = (await createDraft(actor, input, { recurring_id: r.id })).id;
  }
  const doc = (await getDocRow(r.workspace_id, docId))!;
  if (doc.status === 'draft') await approveDocument(actor, docId, { system: true });
  if (r.auto_send) {
    const fresh = (await getDocRow(r.workspace_id, docId))!;
    const contact = await getContactRow(r.workspace_id, r.contact_id);
    if (!fresh.sent_at && contact?.email) await sendDocument(actor, docId, {}).catch((err) => console.error('[books] recurring send', err instanceof Error ? err.message : err));
  }
  const anchor = tpl.anchorDay ?? Number(r.next_date.slice(8, 10));
  let next = nextRunDate(r.frequency, r.interval_count, r.next_date, anchor);
  // Si estuvo pausado mucho tiempo, no genera los períodos atrasados de golpe: salta al próximo futuro.
  for (let i = 0; i < 500 && next <= today && daysBetween(next, today) > 31; i++) next = nextRunDate(r.frequency, r.interval_count, next, anchor);
  const ended = Boolean(r.end_date && next > r.end_date);
  const res = await db
    .prepare('UPDATE books_recurring SET next_date = ?, last_doc_id = ?, run_count = run_count + 1, status = ?, claimed_until = NULL, updated_at = ? WHERE id = ? AND next_date = ?')
    .run(next, docId, ended ? 'ended' : r.status, nowDb(), r.id, r.next_date);
  if (!res.changes) return 'skipped';
  return ended ? 'ended' : 'created';
}

export async function runRecurring(opts: { today?: string; limit?: number; budgetMs?: number; now?: number } = {}): Promise<{ created: number; ended: number; failed: number }> {
  const today = opts.today ?? todayIso();
  const start = Date.now();
  const now = opts.now ?? Date.now();
  const db = getDb();
  const due = (await db
    .prepare("SELECT * FROM books_recurring WHERE status = 'active' AND next_date <= ? AND (claimed_until IS NULL OR claimed_until < ?) ORDER BY next_date LIMIT ?")
    .all(today, nowDb(new Date(now)), opts.limit ?? 50)) as RecurringRow[];
  let created = 0;
  let ended = 0;
  let failed = 0;
  for (const r of due) {
    if (opts.budgetMs && Date.now() - start > opts.budgetMs) break;
    const lease = nowDb(new Date(now + LEASE_MS));
    const claim = await db
      .prepare("UPDATE books_recurring SET claimed_until = ? WHERE id = ? AND next_date = ? AND status = 'active' AND (claimed_until IS NULL OR claimed_until < ?)")
      .run(lease, r.id, r.next_date, nowDb(new Date(now)));
    if (!claim.changes) continue;
    try {
      const out = await runOne(r, today);
      if (out === 'created') created++;
      if (out === 'ended') (created++, ended++);
    } catch (err) {
      failed++;
      console.error('[books] recurring failed', r.id, err instanceof Error ? err.message : err);
      // Libera el claim para reintentar en la próxima corrida.
      await db.prepare('UPDATE books_recurring SET claimed_until = NULL WHERE id = ? AND claimed_until = ?').run(r.id, lease);
    }
  }
  return { created, ended, failed };
}

/** Facturas emitidas que pasaron su vencimiento → 'overdue' (una vez, con evento de Flow). */
export async function markOverdue(opts: { today?: string; limit?: number } = {}): Promise<number> {
  const today = opts.today ?? todayIso();
  const db = getDb();
  const rows = (await db
    .prepare("SELECT id, workspace_id, status, due_date FROM books_documents WHERE doc_type = 'invoice' AND status IN ('sent','partial') AND due_date IS NOT NULL AND due_date < ? LIMIT ?")
    .all(today, opts.limit ?? 500)) as Array<{ id: string; workspace_id: string; status: string; due_date: string }>;
  let n = 0;
  for (const r of rows) {
    const res = await db.prepare("UPDATE books_documents SET status = 'overdue', overdue_at = COALESCE(overdue_at, ?) WHERE id = ? AND status = ?").run(nowDb(), r.id, r.status);
    if (!res.changes) continue;
    n++;
    const d = await getDocument(r.workspace_id, r.id);
    if (d) await onInvoiceOverdue(r.workspace_id, d, daysBetween(r.due_date, today)).catch(() => undefined);
  }
  return n;
}

/**
 * Recordatorios: para cada factura vencida con email y link vigente, el
 * recordatorio n sale cuando los días de atraso llegan a days[n]. Se
 * reclama subiendo reminder_count con compare-and-set antes de mandar; si
 * el envío falla, se devuelve.
 */
export async function sendReminders(opts: { today?: string; limit?: number } = {}): Promise<{ sent: number; failed: number }> {
  const today = opts.today ?? todayIso();
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT d.id, d.workspace_id, d.due_date, d.reminder_count, d.last_reminder_at, s.reminders, c.email
       FROM books_documents d JOIN books_settings s ON s.workspace_id = d.workspace_id JOIN books_contacts c ON c.id = d.contact_id
       WHERE d.doc_type = 'invoice' AND d.status = 'overdue' AND d.public_revoked = 0 AND d.public_token IS NOT NULL AND c.email != '' LIMIT ?`,
    )
    .all(opts.limit ?? 500)) as Array<{ id: string; workspace_id: string; due_date: string; reminder_count: number; last_reminder_at: string | null; reminders: string; email: string }>;
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    const cfg = reminderSettings({ reminders: r.reminders } as SettingsRow);
    if (!cfg.enabled) continue;
    const n = Number(r.reminder_count);
    if (n >= cfg.days.length) continue;
    const late = daysBetween(r.due_date, today);
    if (late < cfg.days[n]) continue;
    if (r.last_reminder_at && r.last_reminder_at.slice(0, 10) >= today) continue;
    // La fecha del recordatorio es la de la corrida (today), así el próximo se cuenta desde ahí.
    const claim = await db.prepare('UPDATE books_documents SET reminder_count = ?, last_reminder_at = ? WHERE id = ? AND reminder_count = ?').run(n + 1, `${today} ${nowDb().slice(11)}`, r.id, n);
    if (!claim.changes) continue;
    try {
      const d = (await getDocRow(r.workspace_id, r.id))!;
      const res = await emailDocument(r.workspace_id, d, { kind: 'reminder' });
      if (!res.ok) throw new Error('send_failed');
      sent++;
      await audit({ ws: r.workspace_id, person: null }, 'doc.reminder', 'invoice', r.id, `${n + 1}`);
    } catch {
      failed++;
      await db.prepare('UPDATE books_documents SET reminder_count = ?, last_reminder_at = ? WHERE id = ? AND reminder_count = ?').run(n, r.last_reminder_at, r.id, n + 1);
    }
  }
  return { sent, failed };
}

/** Cron horario de Books (/api/cron/tick). */
export async function runBooksCron(opts: { today?: string; budgetMs?: number } = {}) {
  const recurring = await runRecurring({ today: opts.today, budgetMs: opts.budgetMs }).catch((err) => (console.error('[books] cron recurring', err), null));
  const overdue = await markOverdue({ today: opts.today }).catch(() => null);
  const reminders = await sendReminders({ today: opts.today }).catch(() => null);
  return { recurring, overdue, reminders };
}
