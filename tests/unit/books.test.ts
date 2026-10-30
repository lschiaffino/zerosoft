import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import {
  addMonths,
  convert,
  currencyDecimals,
  docTotals,
  formatMoney,
  lineAmounts,
  normalizeRate,
  parseAmount,
  percentToBps,
  rescale,
  roundHalfAway,
  toDecimalString,
  parseAmountLocal,
  parseAmountDot,
  toInputString,
} from '@/lib/books-money';
import { arInvoiceLetter, formatCuit, isValidCnpj, isValidCpf, isValidCuit, isValidRfc, normalizeTaxId, validateTaxId } from '@/lib/books-taxid';
import { can, effectiveRole, visibleAreas } from '@/lib/books-roles';
import { accountTemplate, SYSTEM_KEYS, taxTemplate } from '@/lib/books-templates';
import { accountByKey, booksActor, createContact, createItem, ensureBooks, getItem, listTaxRates, setRole, updateSettings } from '@/lib/books';
import { approveDocument, createCreditNote, createDraft, getDocRow, getDocument, recordPayment, updateDraft, voidDocument } from '@/lib/books-docs';
import { createManualJournal, isBalanced, normalizeLines, postJournal, reverseManualJournal } from '@/lib/books-ledger';
import { balanceSheet, profitAndLoss, agingBucket, taxReport, taxBookCsv, aging } from '@/lib/books-reports';
import { createBankAccount, dedupeKeys, importStatement, listTxns, parseCsvStatement, parseOfx, rankCandidates, reconcile, scoreCandidate, suggestions } from '@/lib/books-bank';
import { createRecurring, markOverdue, nextRunDate, runRecurring, sendReminders } from '@/lib/books-recurring';
import { handleMercadoPagoWebhook, handleStripeWebhook, savePayments, startInvoicePayment } from '@/lib/books-payments';
import { signStripePayload } from '@/lib/calendar-payments';
import { signMercadoPago } from '@/lib/shop-payments';
import { includedTax, createExpense, postExpense, createPurchaseOrder, receivePurchaseOrder, billFromPurchaseOrder, sniffReceipt } from '@/lib/books-purchasing';
import { authorizeDocument, saveEInvoice } from '@/lib/books-einvoice';
import { searchBooks } from '@/lib/books-search';
import { invoiceFromQuote, postShopOrder, retryShopPosting, shopOrderLines } from '@/lib/books-integrations';
import { scopesForApps } from '@/lib/api-scopes';
import { toolsFor } from '@/lib/assistant/tools';
import { BooksError, type BooksActor } from '@/lib/books-schema';

process.env.BOOKS_PAYMENTS_FAKE = '1';

// Claves falsas armadas por partes (nunca un literal con forma de clave).
const FAKE_STRIPE_KEY = ['sk', 'test', 'abcdefgh12345678'].join('_');
const FAKE_WHSEC = ['whsec', 'booksabcdefgh1234'].join('_');
const FAKE_MP_TOKEN = ['TEST', '1234567890-abcdefghijklmnop'].join('-');
const FAKE_MP_SECRET = 'mpsecret1234567890abcdef';

const uid = () => Math.random().toString(36).slice(2, 10);

async function workspace(country: 'AR' | 'MX' | 'generic' = 'AR'): Promise<BooksActor> {
  const u = await upsertUser({ email: `books-${uid()}@example.com`, name: 'Books Owner', image: null });
  await ensureBooks(u.id, { country });
  return { ws: u.id, person: u.id, admin: true, role: 'accountant' };
}

/** Agrega a la persona como miembro del workspace (con Books). */
async function addMember(ws: string, email: string): Promise<string> {
  const m = await upsertUser({ email, name: 'Member', image: null });
  const teamId = `t-${ws}`;
  await getDb().prepare("INSERT OR IGNORE INTO teams (id, name, owner_id) VALUES (?, 'T', ?)").run(teamId, ws);
  await getDb().prepare('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)').run(teamId, m.id, 'member', '["books"]');
  return m.id;
}

async function taxId(ws: string, code: string): Promise<string> {
  return (await listTaxRates(ws)).find((t) => t.code === code)!.id;
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof BooksError && e.code === code);
}

// ---------- Dinero ----------

describe('books money: impuestos y redondeo', () => {
  it('redondea mitad lejos del cero, también en negativos', () => {
    expect(roundHalfAway(2.5)).toBe(3);
    expect(roundHalfAway(-2.5)).toBe(-3);
    expect(roundHalfAway(2.4999)).toBe(2);
  });

  it('IVA 21, 10,5 y 27 por línea, redondeado a centavos', () => {
    // 3 × $33,33 = $99,99; IVA 21 % = 20,9979 → 21,00
    expect(lineAmounts({ quantity: 3, unitPrice: 3333, taxBps: 2100 })).toEqual({ gross: 9999, discount: 0, net: 9999, tax: 2100, total: 12099 });
    // 10,5 % sobre $100,05 = 10,50525 → 10,51
    expect(lineAmounts({ quantity: 1, unitPrice: 10005, taxBps: 1050 }).tax).toBe(1051);
    expect(lineAmounts({ quantity: 1, unitPrice: 10000, taxBps: 2700 }).tax).toBe(2700);
    // IVA 16 (MX) con descuento del 10 %: 1000 − 100 = 900; 16 % = 144
    expect(lineAmounts({ quantity: 2, unitPrice: 500_00, discountBps: 1000, taxBps: 1600 })).toEqual({ gross: 1000_00, discount: 100_00, net: 900_00, tax: 144_00, total: 1044_00 });
  });

  it('cantidades con decimales sin error de float', () => {
    // 0,1 h × $3 = $0,30 (0.1*300 en float da 30.000000000000004)
    expect(lineAmounts({ quantity: 0.1, unitPrice: 300 }).gross).toBe(30);
    expect(lineAmounts({ quantity: 1.25, unitPrice: 1999 }).gross).toBe(2499);
  });

  it('totales del documento y desglose por tasa', () => {
    const t = docTotals([
      { quantity: 1, unitPrice: 10000, taxBps: 2100 },
      { quantity: 2, unitPrice: 5000, taxBps: 1050 },
      { quantity: 1, unitPrice: 2000, taxBps: 0 },
    ]);
    expect(t.subtotal).toBe(22000);
    expect(t.taxTotal).toBe(2100 + 1050);
    expect(t.total).toBe(22000 + 3150);
    expect(t.byRate).toEqual([
      { taxBps: 2100, net: 10000, tax: 2100 },
      { taxBps: 1050, net: 10000, tax: 1050 },
      { taxBps: 0, net: 2000, tax: 0 },
    ]);
  });

  it('decimales por moneda: CLP 0, KWD 3, ARS 2', () => {
    expect(currencyDecimals('CLP')).toBe(0);
    expect(currencyDecimals('KWD')).toBe(3);
    expect(currencyDecimals('ARS')).toBe(2);
    expect(parseAmount('1.234,56', 'ARS')).toBe(123456);
    expect(parseAmount('1,234.56', 'USD')).toBe(123456);
    expect(parseAmount('15.990', 'CLP')).toBe(15990);
    expect(parseAmount('1.2345', 'KWD')).toBe(1235);
    expect(parseAmount('-50', 'USD')).toBe(-5000);
    expect(parseAmount('abc', 'USD')).toBeNull();
    expect(toDecimalString(123456, 'ARS')).toBe('1234.56');
    expect(toDecimalString(15990, 'CLP')).toBe('15990');
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56');
  });

  it('tipo de cambio manual con aritmética entera', () => {
    expect(normalizeRate('1050,25')).toBe('1050.25');
    expect(normalizeRate('0')).toBeNull();
    expect(normalizeRate('-1')).toBeNull();
    // USD 100,00 a 1050,25 ARS = ARS 105.025,00
    expect(convert(10000, 'USD', '1050.25', 'ARS')).toBe(10502500);
    // CLP (0 decimales) a USD (2): 15.990 CLP a 0,00105 = USD 16,79
    expect(convert(15990, 'CLP', '0.00105', 'USD')).toBe(1679);
    expect(rescale(1500, 'CLP', 'USD')).toBe(150000);
    expect(percentToBps('10,5')).toBe(1050);
    expect(percentToBps('101')).toBeNull();
    expect(includedTax(12100, 2100)).toBe(2100);
  });

  it('carga a mano y extractos: la convención de la moneda (AR y BR, punto de miles)', () => {
    expect(parseAmountLocal('-1.500', 'ARS')).toBe(-150000);
    expect(parseAmountLocal('1.500,25', 'ARS')).toBe(150025);
    expect(parseAmountLocal('2.000', 'BRL')).toBe(200000);
    expect(parseAmountLocal('1,500.25', 'USD')).toBe(150025);
    expect(parseAmountLocal('1500.5', 'MXN')).toBe(150050);
    expect(parseAmountLocal('abc', 'ARS')).toBeNull();
    expect(toInputString(150025, 'ARS')).toBe('1500,25');
    expect(parseAmountLocal(toInputString(150025, 'ARS'), 'ARS')).toBe(150025);
    expect(toInputString(150025, 'USD')).toBe('1500.25');
    expect(parseAmountDot('-1.50', 'ARS')).toBe(-150);
  });

  it('fin de mes en las recurrentes', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(nextRunDate('monthly', 1, '2026-02-28', 31)).toBe('2026-03-31');
    expect(nextRunDate('quarterly', 1, '2026-01-15')).toBe('2026-04-15');
    expect(nextRunDate('weekly', 2, '2026-01-01')).toBe('2026-01-15');
    expect(nextRunDate('yearly', 1, '2028-02-29', 29)).toBe('2029-02-28');
  });
});

// ---------- Identificaciones fiscales ----------

describe('books tax IDs', () => {
  it('CUIT con dígito verificador', () => {
    expect(isValidCuit('20-12345678-6')).toBe(true);
    expect(isValidCuit('20123456786')).toBe(true);
    expect(isValidCuit('20-12345678-5')).toBe(false);
    expect(isValidCuit('99-12345678-6')).toBe(false);
    expect(isValidCuit('2012345678')).toBe(false);
    expect(formatCuit('20123456786')).toBe('20-12345678-6');
  });

  it('RFC de persona moral y física, con fecha y dígito', () => {
    expect(isValidRfc('GODE561231GR8')).toBe(true);
    expect(isValidRfc('MAS0810247C0')).toBe(true);
    expect(isValidRfc('XAXX010101000')).toBe(true);
    expect(isValidRfc('GODE561231GR9')).toBe(false);
    expect(isValidRfc('GODE561331GR8')).toBe(false);
    expect(isValidRfc('ABC')).toBe(false);
  });

  it('CNPJ y CPF', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
    // CNPJ alfanumérico (Receita Federal, desde julio de 2026).
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12.ABC.345/01DE-36')).toBe(false);
    expect(normalizeTaxId('cnpj', '12.abc.345/01de-35')).toBe('12ABC34501DE35');
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(validateTaxId('other', 'anything')).toBe(true);
  });

  it('letra AR según la condición frente al IVA', () => {
    expect(arInvoiceLetter('ri', 'ri')).toBe('A');
    expect(arInvoiceLetter('ri', 'cf')).toBe('B');
    expect(arInvoiceLetter('ri', 'monotributo')).toBe('B');
    expect(arInvoiceLetter('monotributo', 'ri')).toBe('C');
  });

  it('un contacto con CUIT inválido no se guarda', async () => {
    const a = await workspace('AR');
    await expectCode(createContact(a, { name: 'Mal', country: 'AR', taxId: '20-12345678-5' }, { syncCrm: false }), 'invalid_tax_id');
    const ok = await createContact(a, { name: 'Bien SA', country: 'AR', taxId: '20123456786', taxCondition: 'ri' }, { syncCrm: false });
    expect(ok.taxId).toBe('20-12345678-6');
    expect(ok.taxIdType).toBe('cuit');
  });
});

// ---------- Roles ----------

describe('books roles', () => {
  it('accountant todo, sales solo facturas, viewer solo lectura', () => {
    expect(can('accountant', 'accounting.write')).toBe(true);
    expect(can('sales', 'invoices.write')).toBe(true);
    expect(can('sales', 'contacts.write')).toBe(true);
    expect(can('sales', 'reports.read')).toBe(false);
    expect(can('sales', 'bills.read')).toBe(false);
    expect(can('sales', 'banking.read')).toBe(false);
    expect(can('sales', 'items.write')).toBe(false);
    expect(can('viewer', 'reports.read')).toBe(true);
    expect(can('viewer', 'invoices.write')).toBe(false);
    expect(visibleAreas('sales')).toEqual(['invoices', 'contacts', 'items']);
  });

  it('owner y admin son siempre accountant; un miembro sin rol es viewer', () => {
    expect(effectiveRole('owner', 'viewer')).toBe('accountant');
    expect(effectiveRole('admin', 'sales')).toBe('accountant');
    expect(effectiveRole('member', 'sales')).toBe('sales');
    expect(effectiveRole('member', null)).toBe('viewer');
  });

  it('el rol guardado limita lo que el miembro puede hacer', async () => {
    const owner = await workspace('generic');
    const member = { id: await addMember(owner.ws, `books-m-${uid()}@example.com`) };
    // Sin rol: viewer.
    expect((await booksActor({ ws: owner.ws, person: member.id, workspaceRole: 'member' })).role).toBe('viewer');
    const outsider = await upsertUser({ email: `books-x-${uid()}@example.com`, name: 'X', image: null });
    await expectCode(setRole(owner, outsider.id, 'sales'), 'not_a_member');
    await setRole(owner, member.id, 'sales');
    const sales = await booksActor({ ws: owner.ws, person: member.id, workspaceRole: 'member' });
    expect(sales.role).toBe('sales');
    const c = await createContact(sales, { name: 'Cliente de ventas' }, { syncCrm: false });
    expect(c.name).toBe('Cliente de ventas');
    await expectCode(createManualJournal(sales, { date: '2026-01-02', lines: [] }), 'forbidden');
    await expectCode(createItem(sales, { name: 'x' }), 'forbidden');
    await expectCode(updateSettings(sales, { footer: 'x' }), 'forbidden');
    await expectCode(setRole(sales, member.id, 'accountant'), 'forbidden');
    // sales no anula.
    const c2 = await createContact(owner, { name: 'Para anular' }, { syncCrm: false });
    const inv = await approveDocument(owner, (await createDraft(owner, { contactId: c2.id, lines: [{ description: 'x', unitPrice: 100 }] })).id);
    await expectCode(voidDocument(sales, inv.id), 'forbidden');
    await setRole(owner, member.id, 'viewer');
    const viewer = await booksActor({ ws: owner.ws, person: member.id, workspaceRole: 'member' });
    await expectCode(createContact(viewer, { name: 'x' }, { syncCrm: false }), 'forbidden');
    // Un admin del workspace nunca queda limitado.
    expect((await booksActor({ ws: owner.ws, person: member.id, workspaceRole: 'admin' })).role).toBe('accountant');
  });

  it('herramientas del asistente y scopes de la API solo con la app', () => {
    expect(scopesForApps(['books:read', 'books:write', 'crm:read'], ['crm'])).toEqual(['crm:read']);
    expect(scopesForApps(['books:read', 'books:write'], ['books'])).toContain('books:write');
    const withApp = toolsFor({ role: 'member', apps: ['books'] } as never).map((t) => t.name);
    expect(withApp).toContain('books_invoices');
    expect(withApp).toContain('propose_books_invoice');
    const without = toolsFor({ role: 'member', apps: ['crm'] } as never).map((t) => t.name);
    expect(without.some((n) => n.startsWith('books_') || n.startsWith('propose_books'))).toBe(false);
  });
});

// ---------- Plantillas ----------

describe('books templates', () => {
  it('cada plantilla tiene todas las cuentas de sistema y códigos únicos', () => {
    for (const country of ['AR', 'MX', 'generic'] as const) {
      const t = accountTemplate(country);
      for (const k of SYSTEM_KEYS) expect(t.filter((a) => a.key === k), `${country} ${k}`).toHaveLength(1);
      expect(new Set(t.map((a) => a.code)).size).toBe(t.length);
    }
    expect(taxTemplate('AR').map((t) => t.rateBps)).toEqual(expect.arrayContaining([2100, 1050, 2700]));
    expect(taxTemplate('MX').map((t) => t.rateBps)).toContain(1600);
  });
});

// ---------- Partida doble ----------

describe('books journals: siempre balancean', () => {
  it('normaliza y detecta asientos desbalanceados', () => {
    expect(isBalanced(normalizeLines([{ accountId: 'a', debit: 100 }, { accountId: 'b', credit: 100 }]))).toBe(true);
    expect(isBalanced(normalizeLines([{ accountId: 'a', debit: 100 }, { accountId: 'b', credit: 99 }]))).toBe(false);
    // Un importe negativo pasa al otro lado.
    expect(normalizeLines([{ accountId: 'a', debit: -50 }])).toEqual([{ accountId: 'a', debit: 0, credit: 50 }]);
  });

  it('un asiento desbalanceado no se escribe (ni el número se consume)', async () => {
    const a = await workspace('generic');
    const cash = (await accountByKey(a.ws, 'cash')).id;
    const equity = (await accountByKey(a.ws, 'equity')).id;
    await expectCode(createManualJournal(a, { date: '2026-01-05', lines: [{ accountId: cash, debit: 1000 }, { accountId: equity, credit: 999 }] }), 'unbalanced');
    const before = (await getDb().prepare('SELECT COUNT(*) AS n FROM books_journals WHERE workspace_id = ?').get(a.ws)) as { n: number };
    expect(Number(before.n)).toBe(0);
    const j = await createManualJournal(a, { date: '2026-01-05', memo: 'Capital', lines: [{ accountId: cash, debit: 1000 }, { accountId: equity, credit: 1000 }] });
    expect(j.number).toBe(1);
    expect(j.total).toBe(1000);
  });

  it('la base no deja editar un asiento (trigger) y la corrección es una reversa', async () => {
    const a = await workspace('generic');
    const cash = (await accountByKey(a.ws, 'cash')).id;
    const equity = (await accountByKey(a.ws, 'equity')).id;
    const j = await createManualJournal(a, { date: '2026-01-05', lines: [{ accountId: cash, debit: 500 }, { accountId: equity, credit: 500 }] });
    await expect(getDb().prepare('UPDATE books_journal_lines SET debit = 1 WHERE journal_id = ?').run(j.id)).rejects.toThrow(/books_journal_immutable/);
    await expect(getDb().prepare('DELETE FROM books_journal_lines WHERE journal_id = ?').run(j.id)).rejects.toThrow(/books_journal_immutable/);
    await expect(getDb().prepare('DELETE FROM books_journals WHERE id = ?').run(j.id)).rejects.toThrow(/books_journal_immutable/);
    const rev = await reverseManualJournal(a, j.id);
    expect(rev.lines.find((l) => l.accountId === cash)!.credit).toBe(500);
    await expectCode(reverseManualJournal(a, j.id), 'already_reversed');
    const bs = await balanceSheet(a.ws, '2026-12-31');
    expect(bs.totalAssets).toBe(0);
  });

  it('cierre de período: nada con fecha cerrada', async () => {
    const a = await workspace('generic');
    await expectCode(updateSettings({ ...a, admin: false }, { lockDate: '2026-03-31' }), 'forbidden');
    await updateSettings(a, { lockDate: '2026-03-31' });
    const cash = (await accountByKey(a.ws, 'cash')).id;
    const equity = (await accountByKey(a.ws, 'equity')).id;
    await expectCode(createManualJournal(a, { date: '2026-03-31', lines: [{ accountId: cash, debit: 1 }, { accountId: equity, credit: 1 }] }), 'period_locked');
    await createManualJournal(a, { date: '2026-04-01', lines: [{ accountId: cash, debit: 1 }, { accountId: equity, credit: 1 }] });
    const c = await createContact(a, { name: 'Cerrado' }, { syncCrm: false });
    const d = await createDraft(a, { contactId: c.id, issueDate: '2026-02-01', lines: [{ description: 'x', unitPrice: 100 }] });
    await expectCode(approveDocument(a, d.id), 'period_locked');
    expect((await getDocRow(a.ws, d.id))!.status).toBe('draft');
  });

  it('factura en moneda extranjera: asiento balanceado en la base y diferencia de cambio al cobrar', async () => {
    const a = await workspace('AR');
    const c = await createContact(a, { name: 'Exterior LLC', country: 'US' }, { syncCrm: false });
    const iva = await taxId(a.ws, 'IVA21');
    await expectCode(createDraft(a, { contactId: c.id, currency: 'USD', lines: [{ description: 'Consultoría', unitPrice: '333.33', taxRateId: iva }] }), 'fx_rate_required');
    const d = await createDraft(a, { contactId: c.id, currency: 'USD', fxRate: '1000.5', issueDate: '2026-02-01', lines: [{ description: 'Consultoría', quantity: 3, unitPrice: '333.33', taxRateId: iva }] });
    expect(d.total).toBe(99999 + 21000);
    const ok = await approveDocument(a, d.id);
    const lines = (await getDb().prepare('SELECT SUM(debit) AS d, SUM(credit) AS c FROM books_journal_lines WHERE journal_id = ?').get(ok.journalId)) as { d: number; c: number };
    expect(Number(lines.d)).toBe(Number(lines.c));
    // Cobro total a un tipo más alto: ganancia de cambio.
    const paid = await recordPayment(a, d.id, { amount: ok.total, fxRate: '1100', date: '2026-02-20' });
    expect(paid.doc.status).toBe('paid');
    const pl = await profitAndLoss(a.ws, '2026-01-01', '2026-12-31');
    const fx = pl.income.find((l) => l.name === 'Diferencias de cambio');
    expect(fx?.amount).toBe(convert(ok.total, 'USD', '1100', 'ARS') - convert(ok.total, 'USD', '1000.5', 'ARS'));
    expect((await balanceSheet(a.ws, '2026-12-31')).difference).toBe(0);
  });
});

// ---------- Documentos ----------

describe('books documents: emisión, inmutabilidad, cobros y notas de crédito', () => {
  let a: BooksActor;
  let customerId: string;
  let iva21: string;

  beforeAll(async () => {
    a = await workspace('AR');
    await updateSettings(a, { taxId: '30712345671', taxCondition: 'ri', legalName: 'Mi Empresa SA' });
    customerId = (await createContact(a, { name: 'Cliente Final', country: 'AR', taxCondition: 'cf', email: 'cliente@example.com' }, { syncCrm: false })).id;
    iva21 = await taxId(a.ws, 'IVA21');
  });

  it('borrador → emitida: número de la serie B (RI a consumidor final), asiento y link', async () => {
    const d = await createDraft(a, { contactId: customerId, issueDate: '2026-03-01', termsDays: 15, lines: [{ description: 'Servicio', quantity: 1, unitPrice: '1000', taxRateId: iva21 }] });
    expect(d.status).toBe('draft');
    expect(d.dueDate).toBe('2026-03-16');
    expect(d.total).toBe(121000);
    const ok = await approveDocument(a, d.id);
    expect(ok.status).toBe('sent');
    expect(ok.numberLabel).toBe('B 00001-00000001');
    expect(ok.publicToken).toBeTruthy();
    const j = (await getDb().prepare('SELECT SUM(debit) AS d, SUM(credit) AS c FROM books_journal_lines WHERE journal_id = ?').get(ok.journalId)) as { d: number; c: number };
    expect(Number(j.d)).toBe(121000);
    expect(Number(j.c)).toBe(121000);
    const second = await approveDocument(a, (await createDraft(a, { contactId: customerId, lines: [{ description: 'Otro', unitPrice: 100 }] })).id);
    expect(second.numberLabel).toBe('B 00001-00000002');
  });

  it('un documento emitido no cambia importes: ni por la app ni por SQL directo', async () => {
    const d = await approveDocument(a, (await createDraft(a, { contactId: customerId, lines: [{ description: 'Fijo', unitPrice: 5000, taxRateId: iva21 }] })).id);
    await expectCode(updateDraft(a, d.id, { lines: [{ description: 'Cambio', unitPrice: 1 }] }), 'document_posted');
    await expect(getDb().prepare('UPDATE books_documents SET total = 1 WHERE id = ?').run(d.id)).rejects.toThrow(/books_document_immutable/);
    await expect(getDb().prepare('UPDATE books_lines SET unit_price = 1 WHERE doc_id = ?').run(d.id)).rejects.toThrow(/books_document_immutable/);
    await expect(getDb().prepare("UPDATE books_documents SET status = 'draft' WHERE id = ?").run(d.id)).rejects.toThrow(/books_document_immutable/);
    await expect(getDb().prepare('DELETE FROM books_documents WHERE id = ?').run(d.id)).rejects.toThrow(/books_document_immutable/);
    // Referencia y notas sí.
    const meta = await updateDraft(a, d.id, { reference: 'OC 123' });
    expect(meta.reference).toBe('OC 123');
    expect(meta.total).toBe(6050);
  });

  it('cobros parciales y totales; no se cobra de más', async () => {
    const d = await approveDocument(a, (await createDraft(a, { contactId: customerId, lines: [{ description: 'Abono', unitPrice: 10000 }] })).id);
    await expectCode(recordPayment(a, d.id, { amount: 10001 }), 'amount_exceeds_due');
    const p1 = await recordPayment(a, d.id, { amount: 4000, date: '2026-03-02' });
    expect(p1.doc.status).toBe('partial');
    expect(p1.doc.amountDue).toBe(6000);
    const p2 = await recordPayment(a, d.id, { amount: '60', date: '2026-03-03' });
    expect(p2.doc.status).toBe('paid');
    await expectCode(voidDocument(a, d.id), 'has_payments');
  });

  it('nota de crédito: se aplica a la factura y revierte ventas e IVA', async () => {
    const a = await workspace('AR');
    const customerId = (await createContact(a, { name: 'Devuelve', country: 'AR', taxCondition: 'cf' }, { syncCrm: false })).id;
    const iva21 = await taxId(a.ws, 'IVA21');
    const inv = await approveDocument(a, (await createDraft(a, { contactId: customerId, issueDate: '2026-04-01', lines: [{ description: 'Producto', quantity: 2, unitPrice: 5000, taxRateId: iva21 }] })).id);
    const cn = await createCreditNote(a, inv.id, { lines: [{ description: 'Devolución', quantity: 1, unitPrice: 5000, taxRateId: iva21 }] });
    expect(cn.docType).toBe('credit_note');
    expect(cn.creditForId).toBe(inv.id);
    const ok = await approveDocument(a, cn.id);
    expect(ok.numberLabel.startsWith('B ')).toBe(true);
    expect(ok.status).toBe('paid');
    const after = await getDocument(a.ws, inv.id);
    expect(after!.creditedTotal).toBe(6050);
    expect(after!.amountDue).toBe(6050);
    expect(after!.status).toBe('partial');
    const tax = await taxReport(a.ws, '2026-01-01', '2026-12-31');
    const row = tax.rows.find((r) => r.rateBps === 2100)!;
    expect(row.salesNet).toBe(10000 - 5000);
    expect(row.salesTax).toBe(2100 - 1050);
    expect(taxBookCsv(tax.sales, tax.currency).split('\n')[0]).toContain('tax_21');
  });

  it('anular: revierte el asiento y el P&L vuelve a cero', async () => {
    const b = await workspace('generic');
    const c = await createContact(b, { name: 'Anulado' }, { syncCrm: false });
    const d = await approveDocument(b, (await createDraft(b, { contactId: c.id, issueDate: '2026-05-01', lines: [{ description: 'x', unitPrice: 7000 }] })).id);
    expect((await profitAndLoss(b.ws, '2026-05-01', '2026-05-31')).totalIncome).toBe(7000);
    const v = await voidDocument(b, d.id, 'error');
    expect(v.status).toBe('void');
    expect((await profitAndLoss(b.ws, '2026-01-01', '2026-12-31')).totalIncome).toBe(0);
    await expectCode(voidDocument(b, d.id), 'already_void');
  });

  it('factura de proveedor: pide número del proveedor, va a proveedores e IVA crédito', async () => {
    const b = await workspace('AR');
    const s = await createContact(b, { kind: 'supplier', name: 'Proveedor SRL' }, { syncCrm: false });
    const iva = await taxId(b.ws, 'IVA21');
    const bill = await createDraft(b, { docType: 'bill', contactId: s.id, issueDate: '2026-06-01', lines: [{ description: 'Insumos', unitPrice: 10000, taxRateId: iva }] });
    await expectCode(approveDocument(b, bill.id), 'supplier_number_required');
    await updateDraft(b, bill.id, { reference: 'A 0003-00001234' });
    const ok = await approveDocument(b, bill.id);
    expect(ok.numberLabel).toBe('A 0003-00001234');
    const ap = await aging(b.ws, 'payables', '2026-06-02');
    expect(ap.totals.total).toBe(12100);
    const tax = await taxReport(b.ws, '2026-06-01', '2026-06-30');
    expect(tax.totals.purchasesTax).toBe(2100);
    expect(tax.totals.payable).toBe(-2100);
  });

  it('antigüedad de saldos', () => {
    expect(agingBucket('2026-01-10', '2026-01-10')).toBe('current');
    expect(agingBucket('2026-01-10', '2026-01-11')).toBe('d1_30');
    expect(agingBucket('2026-01-10', '2026-03-15')).toBe('d61_90');
    expect(agingBucket('2026-01-10', '2026-06-15')).toBe('d90_plus');
  });
});

// ---------- Conciliación ----------

describe('books bank: importación y conciliación', () => {
  it('CSV con débito/crédito, fechas dd/mm y separador ;', () => {
    const csv = 'Fecha;Concepto;Débito;Crédito\n05/03/2026;Transferencia CLIENTE FINAL B 00001-00000007;;1.210,00\n06/03/2026;Comisión;15,50;\n07/03/2026;malo;;x';
    const { txns, errors } = parseCsvStatement(csv, 'ARS');
    expect(txns).toEqual([
      { date: '2026-03-05', description: 'Transferencia CLIENTE FINAL B 00001-00000007', amount: 121000 },
      { date: '2026-03-06', description: 'Comisión', amount: -1550 },
    ]);
    expect(errors).toEqual([{ row: 4, error: 'invalid_amount' }]);
  });

  it('OFX con FITID', () => {
    const ofx = '<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260310120000<TRNAMT>250.00<FITID>abc1<NAME>ACME<MEMO>INV 12</STMTTRN><STMTTRN><DTPOSTED>20260311<TRNAMT>-9.99<FITID>abc2<NAME>Fee</STMTTRN></BANKTRANLIST></OFX>';
    const { txns } = parseOfx(ofx, 'USD');
    expect(txns).toEqual([
      { date: '2026-03-10', description: 'ACME · INV 12', amount: 25000, fitId: 'abc1' },
      { date: '2026-03-11', description: 'Fee', amount: -999, fitId: 'abc2' },
    ]);
    expect(dedupeKeys(txns)).toEqual(['fit:abc1', 'fit:abc2']);
    // Dos líneas idénticas en el mismo archivo son dos movimientos distintos.
    const same = dedupeKeys([
      { date: '2026-01-01', description: 'x', amount: 1 },
      { date: '2026-01-01', description: 'x', amount: 1 },
    ]);
    expect(same[0]).not.toBe(same[1]);
  });

  it('puntaje: importe exacto, número y nombre suman; el mejor primero', () => {
    const txn = { date: '2026-03-05', description: 'Transf CLIENTE FINAL fact 7', amount: 121000 };
    const exact = scoreCandidate(txn, { label: 'B 00001-00000007', contactName: 'Cliente Final', amount: 121000, date: '2026-03-04' });
    const other = scoreCandidate(txn, { label: 'B 00001-00000008', contactName: 'Otro', amount: 121000, date: '2026-01-04' });
    expect(exact).toBeGreaterThan(other);
    const ranked = rankCandidates(
      txn,
      [
        { id: 'd8', docType: 'invoice', label: 'B 00001-00000008', contactName: 'Otro', due: 121000, date: '2026-01-04', dueDate: null },
        { id: 'd7', docType: 'invoice', label: 'B 00001-00000007', contactName: 'Cliente Final', due: 121000, date: '2026-03-04', dueDate: null },
        { id: 'bill', docType: 'bill', label: 'X', contactName: 'Cliente Final', due: 121000, date: '2026-03-04', dueDate: null },
        { id: 'far', docType: 'invoice', label: 'B 1', contactName: 'Nadie', due: 5, date: '2025-01-01', dueDate: null },
      ],
      [],
    );
    expect(ranked.map((r) => r.id)).toEqual(['d7', 'd8']);
  });

  it('importar sin duplicar, sugerir y conciliar con la factura (cobra y concilia)', async () => {
    const a = await workspace('AR');
    const c = await createContact(a, { name: 'Banco Cliente' }, { syncCrm: false });
    const inv = await approveDocument(a, (await createDraft(a, { contactId: c.id, issueDate: '2026-03-01', lines: [{ description: 'x', unitPrice: 50000 }] })).id);
    const bank = await createBankAccount(a, { name: 'Galicia CC', bankName: 'Galicia' });
    const csv = `fecha;descripcion;importe\n05/03/2026;Transf Banco Cliente ${inv.numberLabel};500,00\n06/03/2026;Comision mantenimiento;-12,10\n`;
    const r1 = await importStatement(a, bank.id, { filename: 'mov.csv', text: csv });
    expect(r1).toMatchObject({ imported: 2, duplicates: 0 });
    const r2 = await importStatement(a, bank.id, { filename: 'mov.csv', text: csv });
    expect(r2).toMatchObject({ imported: 0, duplicates: 2 });
    const txns = await listTxns(a.ws, bank.id);
    const incoming = txns.find((t) => t.amount === 50000)!;
    const sug = await suggestions(a.ws, bank.id);
    expect(sug[incoming.id][0]).toMatchObject({ kind: 'invoice', docId: inv.id });
    await reconcile(a, incoming.id, { kind: 'invoice', docId: inv.id });
    expect((await getDocument(a.ws, inv.id))!.status).toBe('paid');
    await expectCode(reconcile(a, incoming.id, { kind: 'ignore' }), 'already_matched');
    const fee = txns.find((t) => t.amount === -1210)!;
    const fees = (await accountByKey(a.ws, 'bank_fees')).id;
    await reconcile(a, fee.id, { kind: 'account', accountId: fees });
    const pl = await profitAndLoss(a.ws, '2026-03-01', '2026-03-31');
    expect(pl.expenses.find((l) => l.accountId === fees)?.amount).toBe(1210);
    expect((await balanceSheet(a.ws, '2026-03-31')).difference).toBe(0);
  });
});

// ---------- Recurrentes, vencidas y recordatorios ----------

describe('books cron: recurrentes, vencidas y recordatorios con claims', () => {
  it('dos corridas a la vez generan una sola factura por período', async () => {
    const a = await workspace('generic');
    const c = await createContact(a, { name: 'Suscriptor', email: 'sub@example.com' }, { syncCrm: false });
    await expectCode(createRecurring(a, { name: 'Pasado', contactId: c.id, nextDate: '2020-01-01', template: { lines: [{ description: 'Plan', unitPrice: 2500 }] } }), 'next_date_in_past');
    const r = await createRecurring(a, { name: `Plan mensual ${uid()}`, contactId: c.id, frequency: 'monthly', nextDate: '2099-01-31', template: { termsDays: 10, lines: [{ description: 'Plan', unitPrice: 2500 }] } });
    // Simula un recurrente que arrancó el 31 de enero (lo que haría el cron con el tiempo).
    await getDb().prepare("UPDATE books_recurring SET next_date = '2026-01-31' WHERE id = ?").run(r.id);
    const [x, y] = await Promise.all([runRecurring({ today: '2026-01-31' }), runRecurring({ today: '2026-01-31' })]);
    expect(x.created + y.created).toBe(1);
    const docs = (await getDb().prepare('SELECT * FROM books_documents WHERE recurring_id = ?').all(r.id)) as Array<{ status: string; issue_date: string }>;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ status: 'sent', issue_date: '2026-01-31' });
    const row = (await getDb().prepare('SELECT next_date, run_count FROM books_recurring WHERE id = ?').get(r.id)) as { next_date: string; run_count: number };
    expect(row).toEqual({ next_date: '2026-02-28', run_count: 1 });
    // Mismo día otra vez: nada nuevo.
    expect((await runRecurring({ today: '2026-01-31' })).created).toBe(0);
    // Febrero: fin de mes, y en marzo vuelve al 31.
    await runRecurring({ today: '2026-02-28' });
    expect(((await getDb().prepare('SELECT next_date FROM books_recurring WHERE id = ?').get(r.id)) as { next_date: string }).next_date).toBe('2026-03-31');
  });

  it('vencida una sola vez y recordatorios según los días, sin duplicar', async () => {
    const a = await workspace('generic');
    await updateSettings(a, { reminders: { enabled: true, days: [1, 7] } });
    const c = await createContact(a, { name: 'Moroso', email: 'moroso@example.com' }, { syncCrm: false });
    const d = await approveDocument(a, (await createDraft(a, { contactId: c.id, issueDate: '2026-01-01', termsDays: 10, lines: [{ description: 'x', unitPrice: 1000 }] })).id);
    expect(d.dueDate).toBe('2026-01-11');
    const [m1, m2] = await Promise.all([markOverdue({ today: '2026-01-12' }), markOverdue({ today: '2026-01-12' })]);
    expect((await getDocRow(a.ws, d.id))!.status).toBe('overdue');
    expect(m1 + m2).toBeGreaterThanOrEqual(1);
    const rowsBefore = (await getDb().prepare("SELECT COUNT(*) AS n FROM books_documents WHERE id = ? AND status = 'overdue'").get(d.id)) as { n: number };
    expect(Number(rowsBefore.n)).toBe(1);
    // Día 1 de atraso: primer recordatorio; dos corridas a la vez mandan uno.
    await Promise.all([sendReminders({ today: '2026-01-12' }), sendReminders({ today: '2026-01-12' })]);
    expect((await getDocRow(a.ws, d.id))!.reminder_count).toBe(1);
    await sendReminders({ today: '2026-01-13' });
    expect((await getDocRow(a.ws, d.id))!.reminder_count).toBe(1);
    await sendReminders({ today: '2026-01-18' });
    expect((await getDocRow(a.ws, d.id))!.reminder_count).toBe(2);
    await sendReminders({ today: '2026-03-01' });
    expect((await getDocRow(a.ws, d.id))!.reminder_count).toBe(2);
    // Cobrada, deja de estar vencida.
    const paid = await recordPayment(a, d.id, { amount: 1000 });
    expect(paid.doc.status).toBe('paid');
  });
});

// ---------- Cobros online ----------

describe('books payments: webhooks verificados e idempotentes', () => {
  it('Stripe: firma, sesión y monto; el mismo evento dos veces registra un cobro', async () => {
    const a = await workspace('generic');
    await savePayments(a, { stripe: { secretKey: FAKE_STRIPE_KEY, webhookSecret: FAKE_WHSEC } });
    const c = await createContact(a, { name: 'Paga online', email: 'p@example.com' }, { syncCrm: false });
    const d = await approveDocument(a, (await createDraft(a, { contactId: c.id, lines: [{ description: 'x', unitPrice: 4200 }] })).id);
    const url = await startInvoicePayment(d.publicToken!, 'stripe', 'en');
    expect(url).toContain(`/invoice/${d.publicToken}`);
    const row = (await getDocRow(a.ws, d.id))!;
    const s = await ensureBooks(a.ws);
    const event = (id: string, amount: number, session = row.payment_session) =>
      JSON.stringify({
        id,
        type: 'checkout.session.completed',
        data: { object: { id: session, payment_status: 'paid', currency: 'usd', amount_total: amount, payment_intent: `pi_${id}`, metadata: { source: 'zerosoft_books', invoice_id: d.id, amount: String(amount) } } },
      });
    await expectCode(handleStripeWebhook(s.webhook_token, event('evt_bad', 4200), 't=1,v1=00'), 'invalid_signature');
    const body = event('evt_1', 4200);
    const first = await handleStripeWebhook(s.webhook_token, body, signStripePayload(body, FAKE_WHSEC));
    expect(first).toEqual({ kind: 'paid', invoiceId: d.id });
    const again = await handleStripeWebhook(s.webhook_token, body, signStripePayload(body, FAKE_WHSEC));
    expect(again.kind).toBe('duplicate');
    // Otro evento con el mismo payment_intent tampoco duplica el cobro.
    const body2 = event('evt_1_retry', 4200).replace('pi_evt_1_retry', 'pi_evt_1');
    const third = await handleStripeWebhook(s.webhook_token, body2, signStripePayload(body2, FAKE_WHSEC));
    expect(third.kind).not.toBe('paid');
    const pays = (await getDb().prepare('SELECT COUNT(*) AS n FROM books_payments WHERE doc_id = ?').get(d.id)) as { n: number };
    expect(Number(pays.n)).toBe(1);
    const doc = (await getDocument(a.ws, d.id))!;
    expect(doc.status).toBe('paid');
    expect(doc.payments[0].method).toBe('stripe');
    // El cobro entra a "cobros a acreditar" con su asiento.
    const clearing = (await accountByKey(a.ws, 'clearing')).id;
    const bal = (await getDb().prepare('SELECT SUM(debit - credit) AS v FROM books_journal_lines WHERE account_id = ?').get(clearing)) as { v: number };
    expect(Number(bal.v)).toBe(4200);
  });

  it('Mercado Pago: firma x-signature y una sola vez por pago', async () => {
    const a = await workspace('AR');
    await savePayments(a, { mercadopago: { accessToken: FAKE_MP_TOKEN, webhookSecret: FAKE_MP_SECRET } });
    const c = await createContact(a, { name: 'Paga MP' }, { syncCrm: false });
    const d = await approveDocument(a, (await createDraft(a, { contactId: c.id, lines: [{ description: 'x', unitPrice: 9900 }] })).id);
    const s = await ensureBooks(a.ws);
    const dataId = `fake${d.id}`;
    await expectCode(handleMercadoPagoWebhook(s.webhook_token, { dataId, type: 'payment', signature: 'ts=1,v1=00', requestId: 'r1' }), 'invalid_signature');
    const sig = signMercadoPago(dataId, 'req-1', FAKE_MP_SECRET);
    expect((await handleMercadoPagoWebhook(s.webhook_token, { dataId, type: 'payment', signature: sig, requestId: 'req-1' })).kind).toBe('paid');
    expect((await handleMercadoPagoWebhook(s.webhook_token, { dataId, type: 'payment', signature: sig, requestId: 'req-1' })).kind).toBe('duplicate');
    expect((await getDocument(a.ws, d.id))!.status).toBe('paid');
  });

  it('credenciales: claves con forma inválida no se guardan; solo admins', async () => {
    const a = await workspace('generic');
    await expectCode(savePayments(a, { stripe: { secretKey: 'nope' } }), 'stripe_invalid_key');
    await expectCode(savePayments({ ...a, admin: false }, { stripe: { secretKey: FAKE_STRIPE_KEY } }), 'forbidden');
    const s = await ensureBooks(a.ws);
    expect(s.payments).not.toContain(FAKE_STRIPE_KEY);
  });
});

// ---------- Compras, gastos y stock ----------

describe('books purchasing', () => {
  it('orden de compra: recepción parcial suma stock y pasa a factura de proveedor', async () => {
    const a = await workspace('generic');
    const sup = await createContact(a, { kind: 'supplier', name: 'Mayorista' }, { syncCrm: false });
    const item = await createItem(a, { kind: 'product', name: 'Caja', price: 1500, cost: 800, trackStock: true });
    const po = await createPurchaseOrder(a, { contactId: sup.id, lines: [{ itemId: item.id, quantity: 10 }] });
    expect(po.label).toBe('PO-00001');
    expect(po.total).toBe(8000);
    const part = await receivePurchaseOrder(a, po.id, { lines: [{ lineId: po.lines[0].id, quantity: 4 }] });
    expect(part.status).toBe('partial');
    expect((await getItem(a.ws, item.id))!.stock).toBe(4);
    await expectCode(receivePurchaseOrder(a, po.id, { lines: [{ lineId: po.lines[0].id, quantity: 7 }] }), 'over_receipt');
    const full = await receivePurchaseOrder(a, po.id, { lines: [{ lineId: po.lines[0].id, quantity: 6 }] });
    expect(full.status).toBe('received');
    expect((await getItem(a.ws, item.id))!.stock).toBe(10);
    const bill = await billFromPurchaseOrder(a, po.id, { supplierNumber: 'FC-9' });
    expect(bill.docType).toBe('bill');
    await approveDocument(a, bill.id);
    // La factura de proveedor de una orden no vuelve a sumar stock.
    expect((await getItem(a.ws, item.id))!.stock).toBe(10);
    // Vender descuenta.
    const cust = await createContact(a, { name: 'Compra cajas' }, { syncCrm: false });
    await approveDocument(a, (await createDraft(a, { contactId: cust.id, lines: [{ itemId: item.id, quantity: 3 }] })).id);
    expect((await getItem(a.ws, item.id))!.stock).toBe(7);
  });

  it('gasto con IVA incluido: asiento gasto + crédito fiscal contra el banco', async () => {
    const a = await workspace('AR');
    const iva = await taxId(a.ws, 'IVA21');
    const e = await createExpense(a, { vendor: 'Librería', total: '1210', taxRateId: iva, date: '2026-07-01' });
    expect(e.tax).toBe(21000);
    const posted = await postExpense(a, e.id);
    expect(posted.status).toBe('posted');
    const pl = await profitAndLoss(a.ws, '2026-07-01', '2026-07-31');
    expect(pl.totalExpenses).toBe(100000);
    expect((await taxReport(a.ws, '2026-07-01', '2026-07-31')).totals.purchasesTax).toBe(21000);
    await expectCode(postExpense(a, e.id), 'document_posted');
  });

  it('comprobantes: solo bytes de imagen o PDF reales', () => {
    expect(sniffReceipt(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(sniffReceipt(new TextEncoder().encode('%PDF-1.4 hello world'))).toBe('application/pdf');
    expect(sniffReceipt(new TextEncoder().encode('<html><script>alert(1)</script>'))).toBeNull();
  });
});

// ---------- Factura electrónica ----------

describe('books e-invoicing hook', () => {
  it('proveedor de prueba: CAE ficticio; A sin CUIT del receptor se rechaza; los reales no están implementados', async () => {
    const a = await workspace('AR');
    await updateSettings(a, { taxId: '30712345671', taxCondition: 'ri' });
    const ri = await createContact(a, { name: 'RI sin CUIT', country: 'AR', taxCondition: 'ri' }, { syncCrm: false });
    const d = await approveDocument(a, (await createDraft(a, { contactId: ri.id, lines: [{ description: 'x', unitPrice: 1000 }] })).id);
    expect(d.numberLabel.startsWith('A ')).toBe(true);
    await expectCode(authorizeDocument(a, d.id), 'einvoice_not_configured');
    await saveEInvoice(a, { provider: 'test' });
    const rejected = await authorizeDocument(a, d.id);
    expect(rejected.einvoice.status).toBe('rejected');
    const cf = await createContact(a, { name: 'CF', country: 'AR', taxCondition: 'cf' }, { syncCrm: false });
    const b = await approveDocument(a, (await createDraft(a, { contactId: cf.id, lines: [{ description: 'x', unitPrice: 1000 }] })).id);
    const ok = await authorizeDocument(a, b.id);
    expect(ok.einvoice.status).toBe('authorized');
    expect(String(ok.einvoice.data.code)).toMatch(/^\d{14}$/);
    await expectCode(authorizeDocument(a, b.id), 'already_authorized');
    await expectCode(voidDocument(a, b.id), 'einvoice_authorized_use_credit_note');
    await saveEInvoice(a, { provider: 'afip', credentials: { cuit: '30712345671', privateKey: 'secret-pem' } });
    const s = await ensureBooks(a.ws);
    expect(s.einvoice).not.toContain('secret-pem');
    const c = await approveDocument(a, (await createDraft(a, { contactId: cf.id, lines: [{ description: 'x', unitPrice: 1000 }] })).id);
    await expectCode(authorizeDocument(a, c.id), 'provider_not_implemented');
  });
});

// ---------- Búsqueda ----------

describe('books search', () => {
  it('sales no ve facturas de proveedor ni bancos en ⌘K', async () => {
    const owner = await workspace('generic');
    const tag = uid();
    const sup = await createContact(owner, { kind: 'supplier', name: `Prov ${tag}` }, { syncCrm: false });
    await createDraft(owner, { docType: 'bill', contactId: sup.id, reference: `BILL-${tag}`, lines: [{ description: 'x', unitPrice: 1 }] });
    await createBankAccount(owner, { name: `Banco ${tag}` });
    const all = await searchBooks({ id: owner.ws, role: 'owner' }, tag);
    expect(all.map((h) => h.group)).toEqual(expect.arrayContaining(['booksBills', 'booksBankAccounts', 'booksContacts']));
    const member = { id: await addMember(owner.ws, `books-s-${uid()}@example.com`) };
    await setRole(owner, member.id, 'sales');
    const sales = await searchBooks({ id: owner.ws, role: 'member', actingUser: { id: member.id } }, tag);
    expect(sales.some((h) => h.group === 'booksBills' || h.group === 'booksBankAccounts')).toBe(false);
  });
});

// ---------- Integraciones ----------

describe('books integrations: Shop y CRM', () => {
  it('pedido de Shop pagado → factura emitida y cobrada, una sola vez', async () => {
    const a = await workspace('generic');
    const ts = '2099-08-01 10:00:00';
    const orderId = `ord_${uid()}`;
    await getDb()
      .prepare(
        `INSERT INTO shop_orders (id, workspace_id, number, status, email, name, currency, subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents, payment_method, paid_at, status_token, created_at, updated_at)
         VALUES (?, ?, 1001, 'paid', 'buyer@example.com', 'Buyer', 'USD', 4000, 0, 500, 0, 4500, 'stripe', ?, ?, ?, ?)`,
      )
      .run(orderId, a.ws, ts, uid(), ts, ts);
    await getDb()
      .prepare("INSERT INTO shop_order_items (id, order_id, workspace_id, title, quantity, unit_cents, total_cents) VALUES (?, ?, ?, 'Mug', 2, 2000, 4000)")
      .run(`it_${uid()}`, orderId, a.ws);
    // Apagado: no registra nada.
    expect(await postShopOrder(a.ws, orderId)).toBeNull();
    await updateSettings(a, { shopAutoPost: true });
    const id = await postShopOrder(a.ws, orderId);
    expect(id).toBeTruthy();
    expect(await postShopOrder(a.ws, orderId)).toBe(id);
    const doc = (await getDocument(a.ws, id!))!;
    expect(doc).toMatchObject({ status: 'paid', total: 4500, reference: 'Shop #1001' });
    expect((await profitAndLoss(a.ws, '2099-08-01', '2099-08-31')).totalIncome).toBe(4500);
  });

  it('presupuesto del CRM → factura borrador con sus líneas, una vez', async () => {
    const a = await workspace('generic');
    const dealId = `deal_${uid()}`;
    await getDb().prepare("INSERT INTO crm_deals (id, user_id, pipeline_id, stage_id, name) VALUES (?, ?, 'p', 's', 'Deal')").run(dealId, a.ws);
    const quoteId = `q_${uid()}`;
    const items = JSON.stringify([{ name: 'Implementación', description: '', quantity: 2, unit_price: 150.5, discount_pct: 10, tax_pct: 20 }]);
    await getDb()
      .prepare("INSERT INTO crm_quotes (id, user_id, deal_id, number, title, status, token, currency, items, total, recipient_company) VALUES (?, ?, ?, 'Q-0001', 'Setup', 'accepted', ?, 'USD', ?, 325.08, 'Acme Corp')")
      .run(quoteId, a.ws, dealId, uid(), items);
    const doc = await invoiceFromQuote(a, quoteId);
    expect(doc.status).toBe('draft');
    expect(doc.quoteId).toBe(quoteId);
    expect(doc.contactName).toBe('Acme Corp');
    expect(doc.lines[0]).toMatchObject({ quantity: 2, unitPrice: 15050, discountBps: 1000, taxBps: 2000 });
    expect(doc.total).toBe(27090 + 5418);
    await expectCode(invoiceFromQuote(a, quoteId), 'quote_already_invoiced');
  });
});

// ---------- Correcciones de la QA ----------

describe('books QA: cobros online que no se pierden', () => {
  async function setup() {
    const a = await workspace('generic');
    await savePayments(a, { stripe: { secretKey: FAKE_STRIPE_KEY, webhookSecret: FAKE_WHSEC } });
    const c = await createContact(a, { name: `Online ${uid()}`, email: 'o@example.com' }, { syncCrm: false });
    const d = await approveDocument(a, (await createDraft(a, { contactId: c.id, lines: [{ description: 'x', unitPrice: 250000 }] })).id);
    const s = await ensureBooks(a.ws);
    const send = async (session: string, amount: number) => {
      const body = JSON.stringify({
        id: `evt_${uid()}`,
        type: 'checkout.session.completed',
        data: { object: { id: session, payment_status: 'paid', currency: 'usd', amount_total: amount, payment_intent: `pi_${uid()}`, metadata: { source: 'zerosoft_books', invoice_id: d.id, amount: String(amount) } } },
      });
      return handleStripeWebhook(s.webhook_token, body, signStripePayload(body, FAKE_WHSEC));
    };
    return { a, d, send };
  }

  it('una sesión vieja pagada después de abrir otra se registra igual (la factura sale de la metadata firmada)', async () => {
    const { a, d, send } = await setup();
    await startInvoicePayment(d.publicToken!, 'stripe', 'en');
    await startInvoicePayment(d.publicToken!, 'stripe', 'en');
    expect((await send('cs_old_session', 250000)).kind).toBe('paid');
    expect((await getDocument(a.ws, d.id))!.status).toBe('paid');
  });

  it('cobro por encima del saldo: se aplica el saldo y el resto queda como saldo a favor, con aviso', async () => {
    const { a, d, send } = await setup();
    await recordPayment(a, d.id, { amount: 1000 });
    const out = await send('cs_any', 250000);
    expect(out).toMatchObject({ kind: 'paid', excess: 1000 });
    const doc = (await getDocument(a.ws, d.id))!;
    expect(doc.status).toBe('paid');
    const credit = (await accountByKey(a.ws, 'customer_credit')).id;
    const bal = (await getDb().prepare('SELECT SUM(credit - debit) AS v FROM books_journal_lines WHERE account_id = ?').get(credit)) as { v: number };
    expect(Number(bal.v)).toBe(1000);
    const notes = (await getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'books_invoice'").get(a.ws)) as { n: number };
    expect(Number(notes.n)).toBeGreaterThan(0);
    // Una factura ya pagada: todo el cobro queda como crédito, una sola vez por referencia.
    const again = await send('cs_late', 5000);
    expect(again).toMatchObject({ kind: 'credited', excess: 5000 });
    expect((await balanceSheet(a.ws, '2099-12-31')).difference).toBe(0);
  });
});

describe('books QA: informes que cuadran con el libro', () => {
  it('antigüedad de saldos = cuenta de deudores, con nota de crédito que excede y a una fecha pasada', async () => {
    const a = await workspace('generic');
    const c = await createContact(a, { name: 'Cuadra' }, { syncCrm: false });
    const inv = await approveDocument(a, (await createDraft(a, { contactId: c.id, issueDate: '2026-02-01', lines: [{ description: 'x', unitPrice: 10000 }] })).id);
    await recordPayment(a, inv.id, { amount: 3000, date: '2026-02-10' });
    await recordPayment(a, inv.id, { amount: 2000, date: '2026-03-10' });
    // Nota por más que el saldo: el resto queda a favor del cliente.
    const cn = await createCreditNote(a, inv.id, { lines: [{ description: 'Crédito', unitPrice: 5000 }] });
    await approveDocument(a, cn.id);
    // Otra nota por el total de la factura se pasa de lo que queda por acreditar.
    await expectCode(approveDocument(a, (await createCreditNote(a, inv.id)).id), 'credit_exceeds_invoice');
    await approveDocument(a, (await createCreditNote(a, inv.id, { lines: [{ description: 'Resto', unitPrice: 5000 }] })).id);
    await expectCode(createCreditNote(a, inv.id), 'already_credited');
    const arId = (await accountByKey(a.ws, 'ar')).id;
    const ledger = async (asOf: string) =>
      Number(
        ((await getDb()
          .prepare('SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM books_journal_lines l JOIN books_journals j ON j.id = l.journal_id WHERE l.account_id = ? AND j.date <= ?')
          .get(arId, asOf)) as { v: number }).v,
      );
    const today = new Date().toISOString().slice(0, 10);
    expect((await aging(a.ws, 'receivables', today)).totals.total).toBe(await ledger(today));
    // A fin de febrero: el pago de marzo y la nota de hoy todavía no existían.
    expect((await aging(a.ws, 'receivables', '2026-02-28')).totals.total).toBe(7000);
    expect(await ledger('2026-02-28')).toBe(7000);
  });

  it('libro IVA: anular no cambia el período de emisión y el CSV no deja fórmulas', async () => {
    const a = await workspace('AR');
    const iva = await taxId(a.ws, 'IVA21');
    const c = await createContact(a, { name: '=HYPERLINK("http://evil.example","x")', country: 'AR' }, { syncCrm: false });
    const d = await approveDocument(a, (await createDraft(a, { contactId: c.id, issueDate: '2026-01-15', lines: [{ description: 'x', unitPrice: 10000, taxRateId: iva }] })).id);
    await voidDocument(a, d.id);
    const jan = await taxReport(a.ws, '2026-01-01', '2026-01-31');
    expect(jan.totals.salesTax).toBe(2100);
    const today = new Date().toISOString().slice(0, 10);
    const now = await taxReport(a.ws, today, today);
    expect(now.totals.salesTax).toBe(-2100);
    const csv = taxBookCsv(jan.sales, jan.currency);
    expect(csv).toContain(`"'=HYPERLINK`);
    expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m);
  });
});

describe('books QA: pedidos de Shop exactos y reintentos', () => {
  it('líneas con los totales del pedido: tasa encontrada, tasa desconocida y redondeo', () => {
    const acc = { sales: 's', shipping: 'h' };
    const ok = shopOrderLines({ subtotal: 3333, discount: 0, shipping: 0, tax: 700, total: 4033, taxIncluded: false, shippingName: '' }, [{ title: 'A', quantity: 3, unit: 1111 }], { id: 't21', rateBps: 2100 }, acc);
    expect(ok.warning).toBeNull();
    const tot = (ls: typeof ok.lines, bps: number) => docTotals(ls.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountBps: l.discountBps, taxBps: l.taxRateId ? bps : 0 }))).total;
    expect(tot(ok.lines, 2100)).toBe(4033);
    const unknown = shopOrderLines({ subtotal: 1000, discount: 0, shipping: 500, tax: 130, total: 1630, taxIncluded: false, shippingName: 'Std' }, [{ title: 'B', quantity: 1, unit: 1000 }], null, acc);
    expect(unknown.warning).toBe('tax_rate_not_found');
    expect(unknown.lines.some((l) => /Tax/.test(l.description))).toBe(true);
    expect(tot(unknown.lines, 0)).toBe(1630);
    const disc = shopOrderLines({ subtotal: 999, discount: 333, shipping: 0, tax: 0, total: 666, taxIncluded: false, shippingName: '' }, [{ title: 'C', quantity: 3, unit: 333 }], null, acc);
    expect(tot(disc.lines, 0)).toBe(666);
  });

  it('un borrador que quedó colgado se termina en el reintento, una sola vez', async () => {
    const a = await workspace('generic');
    await updateSettings(a, { shopAutoPost: true });
    const ts = '2099-01-01 10:00:00';
    const orderId = `ord_${uid()}`;
    await getDb()
      .prepare(
        `INSERT INTO shop_orders (id, workspace_id, number, status, email, name, currency, subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents, payment_method, paid_at, status_token, created_at, updated_at)
         VALUES (?, ?, 2001, 'paid', 'b@example.com', 'B', 'USD', 1000, 0, 0, 0, 1000, 'mercadopago', ?, ?, ?, ?)`,
      )
      .run(orderId, a.ws, ts, uid(), ts, ts);
    await getDb().prepare("INSERT INTO shop_order_items (id, order_id, workspace_id, title, quantity, unit_cents, total_cents) VALUES (?, ?, ?, 'Pin', 1, 1000, 1000)").run(`it_${uid()}`, orderId, a.ws);
    // Simula una corrida que creó el borrador y cortó.
    const buyer = await createContact(a, { name: 'B', email: 'b@example.com' }, { syncCrm: false });
    const draft = await createDraft(a, { contactId: buyer.id, reference: 'Shop #2001', lines: [{ description: 'Pin', unitPrice: 1000 }] }, { shop_order_id: orderId });
    // El reintento del cron lo aprueba y lo cobra; correrlo otra vez (o el hook) no duplica nada.
    // (Corridas simultáneas las cubren el índice único por pedido, el compare-and-set de aprobar y la referencia única del cobro.)
    expect((await retryShopPosting()).failed).toBe(0);
    expect(await postShopOrder(a.ws, orderId)).toBe(draft.id);
    await retryShopPosting();
    const doc = (await getDocument(a.ws, draft.id))!;
    expect(doc.status).toBe('paid');
    const pays = (await getDb().prepare('SELECT COUNT(*) AS n FROM books_payments WHERE doc_id = ?').get(draft.id)) as { n: number };
    expect(Number(pays.n)).toBe(1);
    expect((await getDb().prepare('SELECT COUNT(*) AS n FROM books_documents WHERE shop_order_id = ?').get(orderId) as { n: number }).n).toBe(1);
  });
});

describe('books QA: tipos y CSV bancario en ARS', () => {
  it('CSV en ARS: el punto es de miles', () => {
    const { txns } = parseCsvStatement('fecha;concepto;importe\n01/03/2026;Comisión;-1.500\n02/03/2026;Cobro;12.345,67\n', 'ARS');
    expect(txns.map((t) => t.amount)).toEqual([-150000, 1234567]);
  });
});
