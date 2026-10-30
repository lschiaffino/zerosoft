import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { userCanUseApp } from '@/lib/workspace';
import { getDb } from '@/lib/db';
import {
  booksActor,
  ensureBooks,
  getContact,
  getItem,
  listAccounts,
  listAudit,
  listContacts,
  listItems,
  listRoles,
  listSeries,
  listTaxRates,
  settingsDto,
  stockMoves,
} from '@/lib/books';
import { can, type BooksArea } from '@/lib/books-roles';
import { getDocument, listDocuments, docArea } from '@/lib/books-docs';
import { listBankAccounts, listTxns, suggestions } from '@/lib/books-bank';
import { getExpense, getPurchaseOrder, listExpenses, listPurchaseOrders } from '@/lib/books-purchasing';
import { getRecurring, listRecurring } from '@/lib/books-recurring';
import { getJournal, listJournals } from '@/lib/books-ledger';
import { aging, balanceSheet, cashFlow, overview, profitAndLoss, taxReport } from '@/lib/books-reports';
import { paymentsView } from '@/lib/books-payments';
import { einvoiceView } from '@/lib/books-einvoice';
import { quotesToInvoice } from '@/lib/books-integrations';
import { isValidDate, todayIso } from '@/lib/books-money';
import { aiEnabled } from '@/lib/ai';
import { listOwnerSpacePeople } from '@/lib/workspace';
import { NoAccess } from '@/components/books/ui';
import BooksOverview from '@/components/books/Overview';
import { BankAccountsList, ContactsList, DocumentsList, ExpensesList, ItemsList, PurchaseOrdersList, QuotesList, RecurringList } from '@/components/books/Lists';
import DocumentEditor, { type DocKind, type EditorRefs } from '@/components/books/DocumentEditor';
import { ContactEditor, ExpenseEditor, ItemEditor, PurchaseOrderEditor, RecurringEditor } from '@/components/books/Records';
import { AccountsView, BankAccountNew, BankAccountView, JournalList, JournalNew, JournalView } from '@/components/books/Ledger';
import { AgingView, BalanceSheetView, CashFlowView, ProfitLossView, ReportsIndex, TaxView } from '@/components/books/Reports';
import BooksSettings from '@/components/books/Settings';
import { booksSettingsTab } from '@/lib/books-tabs';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; zs?: string[] }>; searchParams: Promise<Record<string, string | undefined>> };

const SECTION_NAV: Record<string, string> = {
  invoices: 'invoices',
  'credit-notes': 'creditNotes',
  bills: 'bills',
  recurring: 'recurring',
  quotes: 'quotes',
  contacts: 'contacts',
  items: 'items',
  expenses: 'expenses',
  'purchase-orders': 'purchaseOrders',
  banking: 'banking',
  accounts: 'accounts',
  journal: 'journal',
  reports: 'reports',
  settings: 'settings',
};

const DOC_SECTIONS: Record<string, DocKind> = { invoices: 'invoice', 'credit-notes': 'credit_note', bills: 'bill' };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, zs = [] } = await props.params;
  const t = await getTranslations({ locale, namespace: 'books' });
  const nav = SECTION_NAV[zs[0] ?? ''];
  return { title: nav ? `${t(`nav.${nav}`)} · Books` : t('meta.title') };
}

function appUrl(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

/**
 * Books en una sola ruta (presupuesto de rutas): inicio, facturas, notas de
 * crédito, facturas de proveedor, recurrentes, presupuestos del CRM,
 * contactos, ítems, gastos, órdenes de compra, bancos, plan de cuentas,
 * libro diario, informes y ajustes. Cada sección pide la lectura de su área
 * según el rol de Books; sin permiso, un aviso claro (no un error).
 */
export default async function BooksPage(props: Props) {
  const { locale, zs = [] } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const person = user.actingUser ?? user;
  const actor = await booksActor({ ws: user.id, person: person.id, workspaceRole: user.role });
  const ws = actor.ws;
  const settings = await ensureBooks(ws, { locale });
  const s = settingsDto(settings);
  const base = s.baseCurrency;
  const read = (a: BooksArea) => can(actor.role, `${a}.read`);
  const write = (a: BooksArea) => can(actor.role, `${a}.write`);
  const [section, id, sub] = zs;
  if (zs.length > 3) notFound();
  const q = sp.q ?? '';

  const editorRefs = async (kind: DocKind): Promise<EditorRefs> => {
    const [contacts, items, taxes, series, banks] = await Promise.all([
      listContacts(ws, { kind: kind === 'bill' ? 'supplier' : 'customer' }),
      read('items') ? listItems(ws) : Promise.resolve([]),
      listTaxRates(ws),
      listSeries(ws),
      read('banking') ? listBankAccounts(ws) : Promise.resolve([]),
    ]);
    const einvoice = actor.admin ? einvoiceView(settings).provider : (JSON.parse(settings.einvoice || '{}') as { provider?: string }).provider ?? null;
    return {
      baseCurrency: base,
      country: s.country,
      contacts: contacts.map((c) => ({ id: c.id, name: c.name, email: c.email, currency: c.currency, termsDays: c.termsDays })),
      items: items.map((i) => ({ id: i.id, name: i.name, price: i.price, cost: i.cost, taxRateId: i.taxRateId, description: i.description })),
      taxes: taxes.map((x) => ({ id: x.id, name: x.name, rate_bps: x.rate_bps, is_default: x.is_default })),
      series: series.map((x) => ({ id: x.id, name: x.name, doc_type: x.doc_type, is_default: x.is_default })),
      bankAccounts: banks.map((b) => ({ id: b.id, name: b.name })),
      termsDays: s.termsDays,
      einvoiceProvider: einvoice ?? null,
    };
  };

  if (!section) {
    const showReports = read('reports');
    const [recent, ov, invoiceCount] = await Promise.all([
      read('invoices') ? listDocuments(ws, { docType: 'invoice', limit: 8 }) : Promise.resolve({ items: [], total: 0 }),
      showReports ? overview(ws, todayIso()) : null,
      getDb().prepare("SELECT COUNT(*) AS n FROM books_documents WHERE workspace_id = ? AND doc_type = 'invoice'").get(ws) as Promise<{ n: number }>,
    ]);
    let receivable = ov?.receivable ?? 0;
    let overdue = ov?.overdue ?? 0;
    if (!ov && read('invoices')) {
      const open = await listDocuments(ws, { docType: 'invoice', status: 'open', limit: 1000 });
      receivable = open.items.filter((d) => d.currency === base).reduce((a, d) => a + d.amountDue, 0);
      overdue = open.items.filter((d) => d.currency === base && d.status === 'overdue').reduce((a, d) => a + d.amountDue, 0);
    }
    const payments = paymentsView(settings);
    return (
      <BooksOverview
        data={{
          currency: base,
          receivable,
          overdue,
          payable: ov ? ov.payable : null,
          payableOverdue: ov ? ov.payableOverdue : null,
          monthIncome: ov ? ov.monthIncome : null,
          monthExpenses: ov ? ov.monthExpenses : null,
          monthProfit: ov ? ov.monthProfit : null,
        }}
        recent={recent.items}
        canWrite={write('invoices')}
        showReports={showReports}
        setup={[
          { key: 'company', done: Boolean(s.legalName && s.address), href: '/app/books/settings?tab=company' },
          { key: 'taxId', done: Boolean(s.taxId), href: '/app/books/settings?tab=company' },
          { key: 'payments', done: payments.stripe.connected || payments.mercadopago.connected, href: '/app/books/settings?tab=payments' },
          { key: 'invoice', done: Number(invoiceCount.n) > 0, href: '/app/books/invoices/new' },
        ]}
      />
    );
  }

  // ---------- Documentos ----------
  const docKind = DOC_SECTIONS[section];
  if (docKind) {
    const area = docArea(docKind);
    if (!read(area)) return <NoAccess />;
    if (!id) {
      const data = await listDocuments(ws, { docType: docKind, q, status: sp.status, limit: 300 });
      return <DocumentsList kind={docKind} items={data.items} total={data.total} q={q} status={sp.status ?? ''} canWrite={write(area)} baseCurrency={base} />;
    }
    if (sub) notFound();
    if (id === 'new') {
      if (!write(area) || docKind === 'credit_note') return <NoAccess />;
      return <DocumentEditor kind={docKind} doc={null} refs={await editorRefs(docKind)} canWrite isAccountant={actor.role === 'accountant'} audit={[]} initialContactId={sp.contact ?? null} appUrl={appUrl()} />;
    }
    const doc = await getDocument(ws, id);
    if (!doc || doc.docType !== docKind) notFound();
    const audit = await listAudit(ws, { entityId: doc.id, limit: 50 });
    return <DocumentEditor kind={docKind} doc={doc} refs={await editorRefs(docKind)} canWrite={write(area)} isAccountant={actor.role === 'accountant'} audit={audit} appUrl={appUrl()} />;
  }

  switch (section) {
    case 'recurring': {
      if (!read('invoices')) return <NoAccess />;
      if (!id) return <RecurringList items={await listRecurring(ws, { q })} canWrite={write('invoices')} />;
      if (sub) notFound();
      const [customers, items, taxes] = await Promise.all([listContacts(ws, { kind: 'customer' }), listItems(ws), listTaxRates(ws)]);
      const refs = {
        baseCurrency: base,
        customers: customers.map((c) => ({ id: c.id, name: c.name })),
        items: items.map((i) => ({ id: i.id, name: i.name, price: i.price, taxRateId: i.taxRateId })),
        taxes: taxes.map((x) => ({ id: x.id, name: x.name })),
      };
      if (id === 'new') return write('invoices') ? <RecurringEditor rec={null} documents={[]} canWrite {...refs} /> : <NoAccess />;
      const rec = await getRecurring(ws, id);
      if (!rec) notFound();
      const ids = ((await getDb().prepare('SELECT id FROM books_documents WHERE workspace_id = ? AND recurring_id = ?').all(ws, rec.id)) as Array<{ id: string }>).map((x) => x.id);
      const docs = ids.length ? (await listDocuments(ws, { docType: 'invoice', contactId: rec.contactId, limit: 500 })).items.filter((d) => ids.includes(d.id)) : [];
      return <RecurringEditor rec={rec} documents={docs} canWrite={write('invoices')} {...refs} />;
    }
    case 'quotes': {
      if (!write('invoices')) return <NoAccess />;
      if (id) notFound();
      const crm = userCanUseApp(user, 'crm');
      return <QuotesList quotes={crm ? await quotesToInvoice(ws) : []} crm={crm} />;
    }
    case 'contacts': {
      if (!read('contacts')) return <NoAccess />;
      const crm = userCanUseApp(user, 'crm');
      if (!id) return <ContactsList contacts={await listContacts(ws, { q, kind: sp.kind })} q={q} kind={sp.kind ?? ''} canWrite={write('contacts')} crm={crm} />;
      if (sub) notFound();
      if (id === 'new') return write('contacts') ? <ContactEditor contact={null} documents={[]} canWrite country={s.country} crm={crm} importMode={sp.crm === '1'} baseCurrency={base} /> : <NoAccess />;
      const contact = await getContact(ws, id);
      if (!contact) notFound();
      const types = (['invoice', 'credit_note', 'bill'] as const).filter((t) => read(docArea(t)));
      const docs = types.length ? (await listDocuments(ws, { contactId: contact.id, docType: [...types], limit: 200 })).items : [];
      return <ContactEditor contact={contact} documents={docs} canWrite={write('contacts')} country={s.country} crm={crm} importMode={false} baseCurrency={base} />;
    }
    case 'items': {
      if (!read('items')) return <NoAccess />;
      if (!id) return <ItemsList items={await listItems(ws, { q })} q={q} canWrite={write('items')} currency={base} />;
      if (sub) notFound();
      const [taxes, accounts] = await Promise.all([listTaxRates(ws), listAccounts(ws)]);
      const refs = { currency: base, taxes: taxes.map((x) => ({ id: x.id, name: x.name })), accounts: accounts.map((a) => ({ id: a.id, name: `${a.code} ${a.name}`, type: a.type })), shop: userCanUseApp(user, 'shop') };
      if (id === 'new') return write('items') ? <ItemEditor item={null} moves={[]} canWrite {...refs} /> : <NoAccess />;
      const item = await getItem(ws, id);
      if (!item) notFound();
      return <ItemEditor item={item} moves={await stockMoves(ws, item.id)} canWrite={write('items')} {...refs} />;
    }
    case 'expenses': {
      if (!read('expenses')) return <NoAccess />;
      if (!id) return <ExpensesList expenses={await listExpenses(ws, { q, status: sp.status })} q={q} status={sp.status ?? ''} canWrite={write('expenses')} />;
      if (sub) notFound();
      const [taxes, accounts, banks, suppliers] = await Promise.all([listTaxRates(ws), listAccounts(ws), listBankAccounts(ws), listContacts(ws, { kind: 'supplier' })]);
      const refs = {
        baseCurrency: base,
        taxes: taxes.map((x) => ({ id: x.id, name: x.name })),
        accounts: accounts.filter((a) => a.type === 'expense').map((a) => ({ id: a.id, name: `${a.code} ${a.name}` })),
        banks: banks.map((b) => ({ id: b.id, name: b.name })),
        suppliers: suppliers.map((c) => ({ id: c.id, name: c.name })),
        aiEnabled: aiEnabled(),
      };
      if (id === 'new') return write('expenses') ? <ExpenseEditor expense={null} canWrite {...refs} /> : <NoAccess />;
      const expense = await getExpense(ws, id);
      if (!expense) notFound();
      return <ExpenseEditor expense={expense} canWrite={write('expenses')} {...refs} />;
    }
    case 'purchase-orders': {
      if (!read('purchasing')) return <NoAccess />;
      if (!id) return <PurchaseOrdersList orders={await listPurchaseOrders(ws, { q })} q={q} canWrite={write('purchasing')} />;
      if (sub) notFound();
      const [suppliers, items, taxes] = await Promise.all([listContacts(ws, { kind: 'supplier' }), listItems(ws), listTaxRates(ws)]);
      const refs = {
        baseCurrency: base,
        suppliers: suppliers.map((c) => ({ id: c.id, name: c.name })),
        items: items.map((i) => ({ id: i.id, name: i.name, cost: i.cost, taxRateId: i.taxRateId })),
        taxes: taxes.map((x) => ({ id: x.id, name: x.name })),
      };
      if (id === 'new') return write('purchasing') ? <PurchaseOrderEditor order={null} canWrite {...refs} /> : <NoAccess />;
      const order = await getPurchaseOrder(ws, id);
      if (!order) notFound();
      return <PurchaseOrderEditor order={order} canWrite={write('purchasing')} {...refs} />;
    }
    case 'banking': {
      if (!read('banking')) return <NoAccess />;
      if (!id) return <BankAccountsList accounts={await listBankAccounts(ws)} canWrite={write('banking')} currency={base} />;
      if (sub) notFound();
      if (id === 'new') return write('banking') ? <BankAccountNew currency={base} /> : <NoAccess />;
      const account = (await listBankAccounts(ws, { includeArchived: true })).find((b) => b.id === id);
      if (!account) notFound();
      const status = ['unmatched', 'matched', 'ignored'].includes(sp.status ?? '') ? sp.status! : '';
      const [txns, sugg, accounts] = await Promise.all([listTxns(ws, id, { status: status || undefined }), suggestions(ws, id), listAccounts(ws)]);
      return (
        <BankAccountView
          account={account}
          transactions={txns}
          suggestions={sugg}
          accounts={accounts.map((a) => ({ id: a.id, code: a.code, name: a.name }))}
          canWrite={write('banking')}
          status={status}
        />
      );
    }
    case 'accounts': {
      if (!read('accounting')) return <NoAccess />;
      if (id) notFound();
      return <AccountsView accounts={await listAccounts(ws, { includeArchived: sp.archived === '1' })} canWrite={write('accounting')} showArchived={sp.archived === '1'} />;
    }
    case 'journal': {
      if (!read('accounting')) return <NoAccess />;
      if (!id) {
        const acc = sp.account ? (await listAccounts(ws, { includeArchived: true })).find((a) => a.id === sp.account) : null;
        return <JournalList journals={await listJournals(ws, { accountId: sp.account, q })} currency={base} canWrite={write('accounting')} accountName={acc ? `${acc.code} ${acc.name}` : null} />;
      }
      if (sub) notFound();
      if (id === 'new') {
        if (!write('accounting')) return <NoAccess />;
        const accounts = await listAccounts(ws);
        return <JournalNew accounts={accounts.map((a) => ({ id: a.id, code: a.code, name: a.name }))} currency={base} lockDate={s.lockDate} />;
      }
      const journal = await getJournal(ws, id);
      if (!journal) notFound();
      return <JournalView journal={journal} currency={base} canWrite={write('accounting')} />;
    }
    case 'reports': {
      if (!read('reports')) return <NoAccess />;
      if (sub) notFound();
      const today = todayIso();
      const from = sp.from && isValidDate(sp.from) ? sp.from : `${today.slice(0, 4)}-01-01`;
      const to = sp.to && isValidDate(sp.to) && sp.to >= from ? sp.to : today;
      const asOf = sp.asOf && isValidDate(sp.asOf) ? sp.asOf : today;
      switch (id) {
        case undefined:
          return <ReportsIndex />;
        case 'pnl':
          return <ProfitLossView report={await profitAndLoss(ws, from, to)} asOf={asOf} />;
        case 'balance-sheet':
          return <BalanceSheetView report={await balanceSheet(ws, asOf)} from={from} to={to} />;
        case 'cash-flow':
          return <CashFlowView report={await cashFlow(ws, from, to)} asOf={asOf} />;
        case 'aged-receivables':
          return <AgingView report={await aging(ws, 'receivables', asOf)} from={from} to={to} />;
        case 'aged-payables':
          return <AgingView report={await aging(ws, 'payables', asOf)} from={from} to={to} />;
        case 'tax':
          return <TaxView report={await taxReport(ws, from, to)} asOf={asOf} />;
        default:
          notFound();
      }
    }
    // eslint-disable-next-line no-fallthrough
    case 'settings': {
      if (id) notFound();
      const tab = booksSettingsTab(sp.tab);
      const [taxes, series, audit, roles, people] = await Promise.all([
        listTaxRates(ws),
        listSeries(ws),
        tab === 'audit' && read('accounting') ? listAudit(ws, { limit: 300 }) : Promise.resolve([]),
        actor.admin ? listRoles(ws) : Promise.resolve(null),
        actor.admin && tab === 'roles' ? listOwnerSpacePeople(ws, { app: 'books' }).catch(() => []) : Promise.resolve([]),
      ]);
      return (
        <BooksSettings
          tab={tab}
          settings={s}
          admin={actor.admin}
          canWrite={write('settings')}
          canAudit={read('accounting')}
          taxes={taxes}
          series={series}
          payments={actor.admin ? paymentsView(settings) : null}
          einvoice={actor.admin ? einvoiceView(settings) : null}
          roles={roles}
          people={people.map((p) => ({ id: p.id, name: p.name ?? null, email: p.email, role: p.role }))}
          audit={audit}
        />
      );
    }
    default:
      notFound();
  }
}
