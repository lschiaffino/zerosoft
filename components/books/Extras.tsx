'use client';

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { BatchDto } from '@/lib/books-batch';
import type { QuoteDto } from '@/lib/books-quotes';
import type { AssetDto, BudgetDto, TrackingCategoryDto } from '@/lib/books-accounting';
import type { BankRuleDto } from '@/lib/books-bankrules';
import type { Statement } from '@/lib/books-statements';
import { bpsToPercent, docTotals, formatMoney, parseAmountLocal, percentToBps, todayIso, toInputString } from '@/lib/books-money';
import { budgetMonths } from '@/lib/books-budget-months';
import { Dialog, MoneyInput, StatusBadge, api, useDate, useErrorText, useToast } from './ui';

type Opt = { id: string; name: string };

const CURRENCIES = ['ARS', 'MXN', 'BRL', 'CLP', 'COP', 'PEN', 'UYU', 'PYG', 'BOB', 'USD', 'EUR', 'GBP', 'CAD'];

/** Tabla que a 390 se apila en pares rótulo / valor: cada celda lleva su data-label. */
function StackTable({ head, children }: { head: Array<{ label: string; num?: boolean }>; children: ReactNode }) {
  return (
    <div className="table-wrap bk-table-wrap table-stack">
      <table className="table bk-table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h.label} scope="col" className={h.num ? 'num' : undefined}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

// ---------- Cobros y pagos por lote ----------

export function BatchList({ batches, canInvoices, canBills }: { batches: BatchDto[]; canInvoices: boolean; canBills: boolean }) {
  const t = useTranslations('books');
  const locale = useLocale();
  const date = useDate();
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [remove, setRemove] = useState<BatchDto | null>(null);
  const doRemove = async () => {
    if (!remove) return;
    const res = await api(`/api/books/batches/${remove.id}`, { method: 'DELETE' });
    setRemove(null);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(t('batch.removed'));
    router.refresh();
  };
  const actions = (
    <>
      {canBills && (
        <Link className="btn btn-secondary" href="/app/books/batch-payments/new?type=bill">
          {t('batch.newBill')}
        </Link>
      )}
      {canInvoices && (
        <Link className="btn btn-primary" href="/app/books/batch-payments/new?type=invoice">
          {t('batch.newInvoice')}
        </Link>
      )}
    </>
  );
  return (
    <div className="app-page ui-page bk-page">
      {toast}
      <PageHeader title={t('nav.batchPayments')} description={t('batch.desc')} actions={actions} />
      {batches.length === 0 ? (
        <EmptyState product="books" title={t('batch.emptyTitle')} body={t('batch.emptyBody')} />
      ) : (
        <StackTable head={[{ label: t('batch.colDate') }, { label: t('batch.colKind') }, { label: t('batch.colAccount') }, { label: t('batch.colDocs'), num: true }, { label: t('batch.colTotal'), num: true }, { label: t('common.actions') }]}>
          {batches.map((b) => (
            <tr key={b.id}>
              <th scope="row">
                <span className="bk-rowtext">
                  <span className="bk-rowtitle">{b.reference || date(b.date)}</span>
                  {b.reference && <span className="bk-rowmeta">{date(b.date)}</span>}
                </span>
              </th>
              <td data-label={t('batch.colKind')}>{t(b.docType === 'bill' ? 'batch.kindBill' : 'batch.kindInvoice')}</td>
              <td data-label={t('batch.colAccount')}>{b.accountName}</td>
              <td className="num" data-label={t('batch.colDocs')}>
                {b.count}
              </td>
              <td className="num data" data-label={t('batch.colTotal')}>
                {formatMoney(b.total, b.currency, locale)}
              </td>
              <td className="table-stack-actions">
                {b.journalId && (
                  <Link className="btn btn-ghost btn-sm" href={`/app/books/journal/${b.journalId}`}>
                    {t('batch.viewJournal')}
                  </Link>
                )}
                {!b.bankTxnId && ((b.docType === 'bill' && canBills) || (b.docType === 'invoice' && canInvoices)) && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemove(b)}>
                    {t('common.delete')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </StackTable>
      )}
      <ConfirmDialog open={!!remove} title={t('batch.removeTitle')} message={t('batch.removeBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} tone="danger" onConfirm={doRemove} onCancel={() => setRemove(null)} />
    </div>
  );
}

export interface BatchDoc {
  id: string;
  label: string;
  contactName: string;
  dueDate: string | null;
  currency: string;
  amountDue: number;
}

export function BatchNew({ docType, docs, banks, baseCurrency }: { docType: 'invoice' | 'bill'; docs: BatchDoc[]; banks: Opt[]; baseCurrency: string }) {
  const t = useTranslations('books');
  const locale = useLocale();
  const router = useRouter();
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const currencies = [...new Set(docs.map((d) => d.currency))].sort();
  const [currency, setCurrency] = useState(currencies.includes(baseCurrency) ? baseCurrency : (currencies[0] ?? baseCurrency));
  const [day, setDay] = useState(todayIso());
  const [bankId, setBankId] = useState(banks[0]?.id ?? '');
  const [reference, setReference] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [amounts, setAmounts] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const shown = docs.filter((d) => d.currency === currency);
  const selected = shown.filter((d) => amounts[d.id] != null && amounts[d.id]! > 0);
  const total = selected.reduce((a, d) => a + (amounts[d.id] ?? 0), 0);
  const allOn = shown.length > 0 && shown.every((d) => amounts[d.id] != null);
  const toggleAll = () => setAmounts(allOn ? {} : Object.fromEntries(shown.map((d) => [d.id, d.amountDue])));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected.length) return push(t('batch.pickSome'), 'bad');
    setBusy(true);
    const res = await api('/api/books/batches', { method: 'POST', json: { docType, date: day, bankAccountId: bankId, reference, ...(fxRate ? { fxRate } : {}), allocations: selected.map((d) => ({ docId: d.id, amount: amounts[d.id] })) } });
    setBusy(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.replace('/app/books/batch-payments');
    router.refresh();
  };
  const back = { href: '/app/books/batch-payments', label: t('nav.batchPayments') };
  const title = t(docType === 'bill' ? 'batch.newBill' : 'batch.newInvoice');
  if (!banks.length) {
    return (
      <div className="app-page ui-page bk-page">
        <PageHeader back={back} title={title} />
        <EmptyState product="books" title={t('batch.noBanksTitle')} body={t('batch.noBanksBody')} action={{ label: t('banking.new'), href: '/app/books/banking/new' }} />
      </div>
    );
  }
  if (!docs.length) {
    return (
      <div className="app-page ui-page bk-page">
        <PageHeader back={back} title={title} />
        <EmptyState product="books" title={t('batch.noOpenTitle')} body={t(docType === 'bill' ? 'batch.noOpenBill' : 'batch.noOpenInvoice')} />
      </div>
    );
  }
  return (
    <div className="app-page ui-page bk-page">
      {toast}
      <PageHeader back={back} title={title} description={t('batch.newDesc')} />
      <form onSubmit={submit}>
        <section className="panel bk-panel">
          <div className="bk-grid">
            <label className="ui-field">
              <span className="label">{t('batch.date')}</span>
              <input className="input" type="date" required value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
            <label className="ui-field">
              <span className="label">{t('batch.bank')}</span>
              <select className="select" required value={bankId} onChange={(e) => setBankId(e.target.value)}>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="label">{t('batch.reference')}</span>
              <input className="input" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
            {currencies.length > 1 && (
              <label className="ui-field">
                <span className="label">{t('editor.currency')}</span>
                <select
                  className="select"
                  value={currency}
                  onChange={(e) => {
                    setCurrency(e.target.value);
                    setAmounts({});
                  }}
                >
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            )}
            {currency !== baseCurrency && (
              <label className="ui-field">
                <span className="label">{t('batch.fxRate', { base: baseCurrency, currency })}</span>
                <input className="input data" inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
              </label>
            )}
          </div>
        </section>
        <section className="panel bk-panel">
          <div className="bk-panel-head">
            <h2 className="bk-panel-title">{t('batch.documents')}</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={toggleAll}>
              {allOn ? t('batch.selectNone') : t('batch.selectAll')}
            </button>
          </div>
          <StackTable head={[{ label: t('batch.colDocument') }, { label: t('batch.colDue') }, { label: t('batch.colBalance'), num: true }, { label: t('batch.colPay'), num: true }]}>
            {shown.map((d) => {
              const on = amounts[d.id] != null;
              return (
                <tr key={d.id}>
                  <th scope="row">
                    <label className="bk-check-row">
                      <input type="checkbox" checked={on} onChange={(e) => setAmounts((a) => ({ ...a, [d.id]: e.target.checked ? d.amountDue : null }))} />
                      <span className="bk-rowtext">
                        <span className="bk-rowtitle">{d.label}</span>
                        <span className="bk-rowmeta">{d.contactName}</span>
                      </span>
                    </label>
                  </th>
                  <td data-label={t('batch.colDue')}>{d.dueDate ? date(d.dueDate) : '-'}</td>
                  <td className="num data" data-label={t('batch.colBalance')}>
                    {formatMoney(d.amountDue, d.currency, locale)}
                  </td>
                  <td className="num" data-label={t('batch.colPay')}>
                    {on ? <MoneyInput value={amounts[d.id] ?? null} onChange={(v) => setAmounts((a) => ({ ...a, [d.id]: v ?? 0 }))} currency={d.currency} label={t('batch.colPay')} /> : <span className="bk-rowmeta">-</span>}
                  </td>
                </tr>
              );
            })}
          </StackTable>
          <p className="bk-total-line" data-testid="batch-total">
            <span>{t('batch.total', { n: selected.length })}</span>
            <span className="data">{formatMoney(total, currency, locale)}</span>
          </p>
          <div className="bk-row bk-row-end">
            <button type="submit" className="btn btn-primary" disabled={busy || !selected.length} aria-busy={busy}>
              {t('batch.record')}
            </button>
          </div>
        </section>
      </form>
    </div>
  );
}

// ---------- Presupuestos ----------

export function QuotesIndex({ quotes, q, canWrite, crmSlot }: { quotes: QuoteDto[]; q: string; canWrite: boolean; crmSlot?: ReactNode }) {
  const t = useTranslations('books');
  const locale = useLocale();
  const date = useDate();
  return (
    <div className="app-page ui-page bk-page">
      <PageHeader
        title={t('nav.quotes')}
        description={t('quotesNative.desc')}
        actions={
          canWrite ? (
            <Link className="btn btn-primary" href="/app/books/quotes/new">
              {t('quotesNative.new')}
            </Link>
          ) : undefined
        }
      />
      {quotes.length === 0 ? (
        q ? (
          <EmptyState compact body={t('common.noMatch')} />
        ) : (
          <EmptyState product="books" title={t('quotesNative.emptyTitle')} body={t('quotesNative.emptyBody')} action={canWrite ? { label: t('quotesNative.new'), href: '/app/books/quotes/new' } : undefined} />
        )
      ) : (
        <StackTable head={[{ label: t('quotesNative.colQuote') }, { label: t('quotesNative.colExpiry') }, { label: t('docs.colStatus') }, { label: t('docs.colTotal'), num: true }]}>
          {quotes.map((x) => (
            <tr key={x.id}>
              <th scope="row">
                <Link href={`/app/books/quotes/${x.id}`} className="bk-rowtext">
                  <span className="bk-rowtitle">{x.title || x.label || x.contactName || t('docs.untitled')}</span>
                  <span className="bk-rowmeta">{[x.title ? x.label : '', x.contactName].filter(Boolean).join(' · ') || t('status.draft')}</span>
                </Link>
              </th>
              <td data-label={t('quotesNative.colExpiry')}>{x.expiryDate ? date(x.expiryDate) : '-'}</td>
              <td data-label={t('docs.colStatus')}>
                <StatusBadge status={x.status === 'sent' ? 'awaiting_decision' : x.status} />
              </td>
              <td className="num data" data-label={t('docs.colTotal')}>
                {formatMoney(x.total, x.currency, locale)}
              </td>
            </tr>
          ))}
        </StackTable>
      )}
      {crmSlot}
    </div>
  );
}

interface QLine {
  key: number;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPrice: number | null;
  discount: string;
  taxRateId: string | null;
}
let qSeq = 0;

export interface QuoteRefs {
  baseCurrency: string;
  contacts: Opt[];
  items: Array<{ id: string; name: string; price: number; taxRateId: string | null; description: string }>;
  taxes: Array<{ id: string; name: string; rate_bps: number; is_default: number }>;
  appUrl: string;
}

export function QuoteEditor({ quote, refs, canWrite }: { quote: QuoteDto | null; refs: QuoteRefs; canWrite: boolean }) {
  const t = useTranslations('books');
  const locale = useLocale();
  const router = useRouter();
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const editable = canWrite && (!quote || quote.status === 'draft');
  const defaultTax = refs.taxes.find((x) => x.is_default)?.id ?? null;
  const blank = (): QLine => ({ key: ++qSeq, itemId: null, description: '', quantity: '1', unitPrice: null, discount: '', taxRateId: defaultTax });
  const [title, setTitle] = useState(quote?.title ?? '');
  const [contactId, setContactId] = useState(quote?.contactId ?? '');
  const [issueDate, setIssueDate] = useState(quote?.issueDate ?? todayIso());
  const [expiryDate, setExpiryDate] = useState(quote?.expiryDate ?? '');
  const [currency, setCurrency] = useState(quote?.currency ?? refs.baseCurrency);
  const [fxRate, setFxRate] = useState(quote && quote.fxRate !== '1' ? quote.fxRate : '');
  const [taxInclusive, setTaxInclusive] = useState(quote?.taxInclusive ?? false);
  const [terms, setTerms] = useState(quote?.terms ?? '');
  const [lines, setLines] = useState<QLine[]>(() =>
    quote?.lines.length
      ? quote.lines.map((l) => ({ key: ++qSeq, itemId: l.itemId, description: l.description, quantity: String(l.quantity), unitPrice: l.unitPrice, discount: l.discountBps ? bpsToPercent(l.discountBps) : '', taxRateId: l.taxRateId }))
      : [blank()],
  );
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const taxBps = (id: string | null) => refs.taxes.find((x) => x.id === id)?.rate_bps ?? 0;
  const totals = useMemo(
    () => docTotals(lines.map((l) => ({ quantity: Number(l.quantity.replace(',', '.')) || 0, unitPrice: l.unitPrice ?? 0, discountBps: percentToBps(l.discount || '0') ?? 0, taxBps: taxBps(l.taxRateId) })), taxInclusive),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, taxInclusive, refs.taxes],
  );
  const money = (v: number) => formatMoney(v, quote?.currency ?? currency, locale);
  const setLine = (key: number, patch: Partial<QLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pick = (key: number, id: string) => {
    const it = refs.items.find((i) => i.id === id);
    setLine(key, it ? { itemId: it.id, description: it.description || it.name, unitPrice: it.price, taxRateId: it.taxRateId ?? defaultTax } : { itemId: null });
  };
  const body = () => ({
    title,
    contactId: contactId || null,
    issueDate,
    expiryDate: expiryDate || null,
    currency,
    ...(currency !== refs.baseCurrency ? { fxRate } : {}),
    taxInclusive,
    terms,
    lines: lines
      .filter((l) => l.description.trim() || l.itemId)
      .map((l) => ({ itemId: l.itemId, description: l.description, quantity: Number(l.quantity.replace(',', '.')) || 0, unitPrice: l.unitPrice ?? 0, discountBps: percentToBps(l.discount || '0') ?? 0, taxRateId: l.taxRateId })),
  });
  const save = async (): Promise<string | null> => {
    const res = quote ? await api<{ quote?: QuoteDto }>(`/api/books/quotes/${quote.id}`, { method: 'PATCH', json: body() }) : await api<{ quote?: QuoteDto }>('/api/books/quotes', { method: 'POST', json: body() });
    if (!res.ok || !res.data.quote) {
      push(errText(res.data.error), 'bad');
      return null;
    }
    return res.data.quote.id;
  };
  const go = (id: string) => {
    if (!quote) router.replace(`/app/books/quotes/${id}`);
    else router.refresh();
  };
  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const id = await save();
    setBusy(false);
    if (!id) return;
    push(t('common.saved'));
    go(id);
  };
  const publish = async (email: boolean) => {
    setBusy(true);
    const id = editable ? await save() : (quote?.id ?? null);
    if (!id) return setBusy(false);
    const res = await api(`/api/books/quotes/${id}/send`, { method: 'POST', json: { email, locale } });
    setBusy(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(t(email ? 'quotesNative.emailed' : 'quotesNative.published'));
    go(id);
  };
  const toInvoice = async () => {
    if (!quote) return;
    setBusy(true);
    const res = await api<{ doc?: { id: string } }>(`/api/books/quotes/${quote.id}/invoice`, { method: 'POST' });
    setBusy(false);
    if (!res.ok || !res.data.doc) return push(errText(res.data.error), 'bad');
    router.push(`/app/books/invoices/${res.data.doc.id}`);
  };
  const reopen = async () => {
    if (!quote) return;
    const res = await api(`/api/books/quotes/${quote.id}`, { method: 'PATCH', json: { status: 'draft' } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.refresh();
  };
  const remove = async () => {
    if (!quote) return;
    const res = await api(`/api/books/quotes/${quote.id}`, { method: 'DELETE' });
    setConfirm(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.replace('/app/books/quotes');
    router.refresh();
  };
  const link = quote?.publicToken ? `${refs.appUrl}/${locale}/quote/${quote.publicToken}` : null;
  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link).catch(() => undefined);
    push(t('editor.linkCopied'));
  };
  const back = { href: '/app/books/quotes', label: t('nav.quotes') };
  const heading = quote ? quote.title || quote.label || t('quotesNative.draftTitle') : t('quotesNative.new');

  if (quote && !editable) {
    return (
      <div className="app-page ui-page bk-page bk-narrow">
        {toast}
        <PageHeader back={back} title={heading} description={[quote.title ? quote.label : '', quote.contactName].filter(Boolean).join(' · ')} actions={<StatusBadge status={quote.status === 'sent' ? 'awaiting_decision' : quote.status} />} />
        <section className="panel bk-panel">
          <dl className="bk-meta">
            <div>
              <dt>{t('editor.customer')}</dt>
              <dd>{quote.contactName || '-'}</dd>
            </div>
            <div>
              <dt>{t('editor.issueDate')}</dt>
              <dd>{date(quote.issueDate)}</dd>
            </div>
            {quote.expiryDate && (
              <div>
                <dt>{t('quotesNative.expiry')}</dt>
                <dd>{date(quote.expiryDate)}</dd>
              </div>
            )}
            {quote.decidedAt && (
              <div>
                <dt>{t(quote.status === 'declined' ? 'quotesNative.declinedBy' : 'quotesNative.acceptedBy')}</dt>
                <dd>{[quote.decidedName, date(quote.decidedAt, true)].filter(Boolean).join(' · ')}</dd>
              </div>
            )}
          </dl>
          <StackTable head={[{ label: t('editor.colDescription') }, { label: t('editor.colQty'), num: true }, { label: t('editor.colPrice'), num: true }, { label: t('editor.colAmount'), num: true }]}>
            {quote.lines.map((l, i) => (
              <tr key={i}>
                <th scope="row">{l.description}</th>
                <td className="num" data-label={t('editor.colQty')}>
                  {l.quantity}
                </td>
                <td className="num" data-label={t('editor.colPrice')}>
                  {money(l.unitPrice)}
                </td>
                <td className="num data" data-label={t('editor.colAmount')}>
                  {money(quote.taxInclusive ? l.total : l.net)}
                </td>
              </tr>
            ))}
          </StackTable>
          <p className="bk-total-line">
            <span>{t('editor.total')}</span>
            <span className="data">{money(quote.total)}</span>
          </p>
          {quote.terms && <p className="bk-notes">{quote.terms}</p>}
        </section>
        {canWrite && (
          <section className="panel bk-panel">
            <h2 className="bk-panel-title">{t('quotesNative.next')}</h2>
            {link && (
              <div className="bk-row">
                <input className="input data" readOnly value={link} aria-label={t('quotesNative.link')} onFocus={(e) => e.target.select()} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
                  {t('editor.copyLink')}
                </button>
              </div>
            )}
            <div className="bk-row">
              {!quote.invoiceId && quote.status !== 'declined' && (
                <button type="button" className={`btn ${quote.status === 'accepted' ? 'btn-primary' : 'btn-secondary'}`} disabled={busy} onClick={toInvoice}>
                  {t('quotesNative.toInvoice')}
                </button>
              )}
              {quote.invoiceId && (
                <Link className="btn btn-secondary" href={`/app/books/invoices/${quote.invoiceId}`}>
                  {t('quotesNative.openInvoice')}
                </Link>
              )}
              {quote.status === 'sent' && (
                <>
                  <button type="button" className="btn btn-secondary" disabled={busy || !quote.contactEmail} title={quote.contactEmail ? undefined : t('quotesNative.noEmail')} onClick={() => publish(true)}>
                    {t('quotesNative.email')}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={reopen}>
                    {t('quotesNative.reopen')}
                  </button>
                </>
              )}
              {!quote.invoiceId && (
                <button type="button" className="btn btn-ghost btn-danger" onClick={() => setConfirm(true)}>
                  {t('common.delete')}
                </button>
              )}
            </div>
            {quote.status === 'sent' && !quote.contactEmail && <p className="ui-help">{t('quotesNative.noEmail')}</p>}
          </section>
        )}
        <ConfirmDialog open={confirm} title={t('quotesNative.deleteTitle')} message={t('quotesNative.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} tone="danger" onConfirm={remove} onCancel={() => setConfirm(false)} />
      </div>
    );
  }

  return (
    <div className="app-page ui-page bk-page">
      {toast}
      <PageHeader back={back} title={heading} />
      <form className="bk-editor" onSubmit={onSave}>
        <div className="bk-editor-main">
          <section className="panel bk-panel">
            <div className="bk-grid">
              <label className="ui-field">
                <span className="label">{t('quotesNative.title')}</span>
                <input className="input" maxLength={160} autoFocus={!quote} value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="ui-field">
                <span className="label">{t('editor.customer')}</span>
                <select className="select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                  <option value="">{t('editor.pickContact')}</option>
                  {refs.contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ui-field">
                <span className="label">{t('editor.issueDate')}</span>
                <input className="input" type="date" required value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </label>
              <label className="ui-field">
                <span className="label">{t('quotesNative.expiry')}</span>
                <input className="input" type="date" min={issueDate} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              </label>
              <label className="ui-field">
                <span className="label">{t('editor.currency')}</span>
                <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {[...new Set([refs.baseCurrency, ...CURRENCIES])].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              {currency !== refs.baseCurrency && (
                <label className="ui-field">
                  <span className="label">{t('batch.fxRate', { base: refs.baseCurrency, currency })}</span>
                  <input className="input data" inputMode="decimal" required value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
                </label>
              )}
              <label className="ui-field">
                <span className="label">{t('editor.taxMode')}</span>
                <select className="select" value={taxInclusive ? 'inclusive' : 'exclusive'} onChange={(e) => setTaxInclusive(e.target.value === 'inclusive')}>
                  <option value="exclusive">{t('editor.taxExclusive')}</option>
                  <option value="inclusive">{t('editor.taxInclusive')}</option>
                </select>
              </label>
            </div>
          </section>
          <section className="panel bk-panel">
            <h2 className="bk-panel-title">{t('editor.lines')}</h2>
            <div className="bk-table-wrap">
              <table className="table bk-table bk-lines">
                <thead>
                  <tr>
                    <th scope="col">{t('editor.colItem')}</th>
                    <th scope="col">{t('editor.colDescription')}</th>
                    <th scope="col" className="num">
                      {t('editor.colQty')}
                    </th>
                    <th scope="col" className="num">
                      {t('editor.colPrice')}
                    </th>
                    <th scope="col" className="num">
                      {t('editor.colDiscount')}
                    </th>
                    <th scope="col">{t('editor.colTax')}</th>
                    <th scope="col" className="num">
                      {t('editor.colAmount')}
                    </th>
                    <th scope="col">
                      <span className="sr-only">{t('common.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.key}>
                      <td data-label={t('editor.colItem')}>
                        <select className="select bk-cell" aria-label={t('editor.colItem')} value={l.itemId ?? ''} onChange={(e) => pick(l.key, e.target.value)}>
                          <option value="">{t('editor.noItem')}</option>
                          {refs.items.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td data-label={t('editor.colDescription')}>
                        <input className="input bk-cell bk-cell-wide" aria-label={t('editor.colDescription')} maxLength={1000} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} />
                      </td>
                      <td data-label={t('editor.colQty')}>
                        <input className="input num bk-cell bk-cell-xs" inputMode="decimal" aria-label={t('editor.colQty')} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                      </td>
                      <td data-label={t('editor.colPrice')}>
                        <MoneyInput value={l.unitPrice} onChange={(v) => setLine(l.key, { unitPrice: v })} currency={currency} label={t('editor.colPrice')} />
                      </td>
                      <td data-label={t('editor.colDiscount')}>
                        <input className="input num bk-cell bk-cell-xs" inputMode="decimal" aria-label={t('editor.colDiscount')} placeholder="0" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} />
                      </td>
                      <td data-label={t('editor.colTax')}>
                        <select className="select bk-cell" aria-label={t('editor.colTax')} value={l.taxRateId ?? ''} onChange={(e) => setLine(l.key, { taxRateId: e.target.value || null })}>
                          <option value="">{t('editor.noTax')}</option>
                          {refs.taxes.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="num data" data-label={t('editor.colAmount')}>
                        {money(taxInclusive ? (totals.lines[i]?.total ?? 0) : (totals.lines[i]?.net ?? 0))}
                      </td>
                      <td>
                        <button type="button" className="btn btn-ghost btn-sm" aria-label={t('editor.removeLine')} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, blank()])}>
                {t('editor.addLine')}
              </button>
            </div>
          </section>
          <section className="panel bk-panel">
            <label className="ui-field">
              <span className="label">{t('quotesNative.terms')}</span>
              <textarea className="textarea" rows={3} maxLength={4000} value={terms} onChange={(e) => setTerms(e.target.value)} />
            </label>
          </section>
        </div>
        <aside className="bk-editor-side">
          <section className="panel bk-panel">
            <h2 className="bk-panel-title">{t('editor.summary')}</h2>
            <dl className="bk-totals">
              <div>
                <dt>{t('editor.subtotal')}</dt>
                <dd>{money(totals.subtotal - totals.discountTotal)}</dd>
              </div>
              {totals.byRate
                .filter((r) => r.taxBps > 0)
                .map((r) => (
                  <div key={r.taxBps}>
                    <dt>{t(taxInclusive ? 'editor.taxIncludedAt' : 'editor.taxAt', { rate: bpsToPercent(r.taxBps) })}</dt>
                    <dd>{money(r.tax)}</dd>
                  </div>
                ))}
              <div className="bk-total-strong">
                <dt>{t('editor.total')}</dt>
                <dd>{money(totals.total)}</dd>
              </div>
            </dl>
          </section>
          <section className="panel bk-panel bk-actions">
            <button type="submit" className="btn btn-secondary" disabled={busy} aria-busy={busy}>
              {t('editor.saveDraft')}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || !contactId} onClick={() => publish(false)}>
              {t('quotesNative.publish')}
            </button>
            {!contactId && <p className="ui-help">{t('quotesNative.needsContact')}</p>}
            {quote && (
              <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
                {t('common.delete')}
              </button>
            )}
            <p className="ui-help">{t('quotesNative.help')}</p>
          </section>
        </aside>
      </form>
      <ConfirmDialog open={confirm} title={t('quotesNative.deleteTitle')} message={t('quotesNative.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} tone="danger" onConfirm={remove} onCancel={() => setConfirm(false)} />
    </div>
  );
}

// ---------- Bienes de uso ----------

export function AssetsList({ assets, q, canWrite, currency }: { assets: AssetDto[]; q: string; canWrite: boolean; currency: string }) {
  const t = useTranslations('books');
  const locale = useLocale();
  const router = useRouter();
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [through, setThrough] = useState(todayIso().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const m = (v: number) => formatMoney(v, currency, locale);
  const registered = assets.filter((a) => a.status === 'registered');
  const run = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await api<{ months?: number; total?: number }>('/api/books/assets/depreciation', { method: 'POST', json: { through } });
    setBusy(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(res.data.months ? t('assets.ran', { months: res.data.months, total: m(res.data.total ?? 0) }) : t('assets.nothingToRun'));
    router.refresh();
  };
  const undo = async () => {
    setConfirmUndo(false);
    const res = await api<{ month?: string | null }>('/api/books/assets/depreciation', { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(res.data.month ? t('assets.undone', { month: res.data.month }) : t('assets.nothingToUndo'));
    router.refresh();
  };
  return (
    <div className="app-page ui-page bk-page">
      {toast}
      <PageHeader
        title={t('nav.fixedAssets')}
        description={t('assets.desc')}
        actions={
          canWrite ? (
            <Link className="btn btn-primary" href="/app/books/fixed-assets/new">
              {t('assets.new')}
            </Link>
          ) : undefined
        }
      />
      {canWrite && registered.length > 0 && (
        <form className="panel bk-panel" onSubmit={run}>
          <h2 className="bk-panel-title">{t('assets.runTitle')}</h2>
          <div className="bk-toolbar">
            <label className="ui-field">
              <span className="label">{t('assets.through')}</span>
              <input className="input" type="month" required value={through} onChange={(e) => setThrough(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
              {t('assets.run')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmUndo(true)}>
              {t('assets.undo')}
            </button>
          </div>
          <p className="ui-help">{t('assets.runHelp')}</p>
        </form>
      )}
      {assets.length === 0 ? (
        q ? (
          <EmptyState compact body={t('common.noMatch')} />
        ) : (
          <EmptyState product="books" title={t('assets.emptyTitle')} body={t('assets.emptyBody')} action={canWrite ? { label: t('assets.new'), href: '/app/books/fixed-assets/new' } : undefined} />
        )
      ) : (
        <StackTable head={[{ label: t('assets.colAsset') }, { label: t('assets.colPurchased') }, { label: t('docs.colStatus') }, { label: t('assets.colCost'), num: true }, { label: t('assets.colAccumulated'), num: true }, { label: t('assets.colBook'), num: true }]}>
          {assets.map((a) => (
            <tr key={a.id}>
              <th scope="row">
                <Link href={`/app/books/fixed-assets/${a.id}`} className="bk-rowtext">
                  <span className="bk-rowtitle">{a.name}</span>
                  {a.reference && <span className="bk-rowmeta">{a.reference}</span>}
                </Link>
              </th>
              <td data-label={t('assets.colPurchased')}>{date(a.purchaseDate)}</td>
              <td data-label={t('docs.colStatus')}>
                <StatusBadge status={a.status} />
              </td>
              <td className="num" data-label={t('assets.colCost')}>
                {m(a.cost)}
              </td>
              <td className="num" data-label={t('assets.colAccumulated')}>
                {m(a.accumulated)}
              </td>
              <td className="num data" data-label={t('assets.colBook')}>
                {m(a.bookValue)}
              </td>
            </tr>
          ))}
        </StackTable>
      )}
      <ConfirmDialog open={confirmUndo} title={t('assets.undoTitle')} message={t('assets.undoBody')} confirmLabel={t('assets.undo')} cancelLabel={t('common.cancel')} tone="danger" onConfirm={undo} onCancel={() => setConfirmUndo(false)} />
    </div>
  );
}

type AccOpt = { id: string; code: string; name: string; type: string; subtype: string };

export function AssetEditor({ asset, accounts, currency, canWrite }: { asset: AssetDto | null; accounts: AccOpt[]; currency: string; canWrite: boolean }) {
  const t = useTranslations('books');
  const locale = useLocale();
  const router = useRouter();
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const locked = Boolean(asset && (asset.hasRuns || asset.status === 'disposed'));
  const [name, setName] = useState(asset?.name ?? '');
  const [reference, setReference] = useState(asset?.reference ?? '');
  const [purchaseDate, setPurchaseDate] = useState(asset?.purchaseDate ?? todayIso());
  const [startDate, setStartDate] = useState(asset?.startDate ?? '');
  const [cost, setCost] = useState<number | null>(asset?.cost ?? null);
  const [residual, setResidual] = useState<number | null>(asset?.residual ?? 0);
  const [method, setMethod] = useState(asset?.method ?? 'straight_line');
  const [life, setLife] = useState(asset?.lifeMonths != null ? String(asset.lifeMonths) : '60');
  const [rate, setRate] = useState(asset?.rateBps != null ? bpsToPercent(asset.rateBps) : '20');
  const [assetAcc, setAssetAcc] = useState(asset?.assetAccountId ?? '');
  const [accumAcc, setAccumAcc] = useState(asset?.accumAccountId ?? '');
  const [expenseAcc, setExpenseAcc] = useState(asset?.expenseAccountId ?? '');
  const [confirm, setConfirm] = useState(false);
  const [dispose, setDispose] = useState<{ date: string; proceeds: number | null; account: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const m = (v: number) => formatMoney(v, currency, locale);
  const assets = accounts.filter((a) => a.type === 'asset');
  const expenses = accounts.filter((a) => a.type === 'expense');
  const body = () =>
    locked
      ? { name, reference }
      : {
          name,
          reference,
          purchaseDate,
          startDate: startDate || purchaseDate,
          cost: cost ?? 0,
          residual: residual ?? 0,
          method,
          lifeMonths: method === 'straight_line' ? Number(life) : null,
          rateBps: method === 'declining' ? percentToBps(rate) : null,
          assetAccountId: assetAcc || null,
          accumAccountId: accumAcc || null,
          expenseAccountId: expenseAcc || null,
        };
  const save = async (e?: FormEvent, status?: 'registered') => {
    e?.preventDefault();
    setBusy(true);
    const res = asset
      ? await api<{ asset?: AssetDto }>(`/api/books/assets/${asset.id}`, { method: 'PATCH', json: { ...body(), ...(status ? { status } : {}) } })
      : await api<{ asset?: AssetDto }>('/api/books/assets', { method: 'POST', json: body() });
    setBusy(false);
    if (!res.ok || !res.data.asset) return push(errText(res.data.error), 'bad');
    if (!asset && status) {
      const reg = await api(`/api/books/assets/${res.data.asset.id}`, { method: 'PATCH', json: { status } });
      if (!reg.ok) push(errText(reg.data.error), 'bad');
    }
    push(t('common.saved'));
    if (!asset) router.replace(`/app/books/fixed-assets/${res.data.asset.id}`);
    else router.refresh();
  };
  const remove = async () => {
    if (!asset) return;
    const res = await api(`/api/books/assets/${asset.id}`, { method: 'DELETE' });
    setConfirm(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.replace('/app/books/fixed-assets');
    router.refresh();
  };
  const doDispose = async (e: FormEvent) => {
    e.preventDefault();
    if (!asset || !dispose) return;
    const res = await api(`/api/books/assets/${asset.id}`, { method: 'POST', json: { date: dispose.date, proceeds: dispose.proceeds ?? 0, ...(dispose.account ? { proceedsAccountId: dispose.account } : {}) } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setDispose(null);
    router.refresh();
  };
  const select = (label: string, value: string, set: (v: string) => void, list: AccOpt[]) => (
    <label className="ui-field">
      <span className="label">{label}</span>
      <select className="select" value={value} disabled={locked} onChange={(e) => set(e.target.value)}>
        <option value="">{t('assets.autoAccount')}</option>
        {list.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} {a.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="app-page ui-page bk-page bk-narrow">
      {toast}
      <PageHeader back={{ href: '/app/books/fixed-assets', label: t('nav.fixedAssets') }} title={asset ? asset.name : t('assets.new')} actions={asset ? <StatusBadge status={asset.status} /> : undefined} />
      {asset && (
        <div className="bk-kpis">
          <div className="bk-kpi">
            <span className="bk-kpi-label">{t('assets.colCost')}</span>
            <span className="bk-kpi-value bk-kpi-small">{m(asset.cost)}</span>
          </div>
          <div className="bk-kpi">
            <span className="bk-kpi-label">{t('assets.colAccumulated')}</span>
            <span className="bk-kpi-value bk-kpi-small">{m(asset.accumulated)}</span>
          </div>
          <div className="bk-kpi">
            <span className="bk-kpi-label">{t('assets.colBook')}</span>
            <span className="bk-kpi-value bk-kpi-small">{m(asset.bookValue)}</span>
          </div>
        </div>
      )}
      <form className="panel bk-panel" onSubmit={(e) => save(e)}>
        <fieldset className="bk-fieldset" disabled={!canWrite}>
          <div className="bk-grid">
            <label className="ui-field">
              <span className="label">{t('assets.name')}</span>
              <input className="input" required maxLength={160} autoFocus={!asset} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="ui-field">
              <span className="label">{t('assets.reference')}</span>
              <input className="input" maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
            <label className="ui-field">
              <span className="label">{t('assets.purchaseDate')}</span>
              <input className="input" type="date" required disabled={locked} value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </label>
            <label className="ui-field">
              <span className="label">{t('assets.startDate')}</span>
              <input className="input" type="date" disabled={locked} min={purchaseDate} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="ui-field">
              <span className="label">{t('assets.cost', { currency })}</span>
              {locked ? <input className="input num" disabled value={toInputString(cost ?? 0, currency)} /> : <MoneyInput value={cost} onChange={setCost} currency={currency} label={t('assets.cost', { currency })} required />}
            </label>
            <label className="ui-field">
              <span className="label">{t('assets.residual')}</span>
              {locked ? <input className="input num" disabled value={toInputString(residual ?? 0, currency)} /> : <MoneyInput value={residual} onChange={setResidual} currency={currency} label={t('assets.residual')} />}
            </label>
            <label className="ui-field">
              <span className="label">{t('assets.method')}</span>
              <select className="select" disabled={locked} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="straight_line">{t('assets.methodLine')}</option>
                <option value="declining">{t('assets.methodDeclining')}</option>
                <option value="none">{t('assets.methodNone')}</option>
              </select>
            </label>
            {method === 'straight_line' && (
              <label className="ui-field">
                <span className="label">{t('assets.life')}</span>
                <input className="input num" inputMode="numeric" required disabled={locked} value={life} onChange={(e) => setLife(e.target.value)} />
              </label>
            )}
            {method === 'declining' && (
              <label className="ui-field">
                <span className="label">{t('assets.rate')}</span>
                <input className="input num" inputMode="decimal" required disabled={locked} value={rate} onChange={(e) => setRate(e.target.value)} />
              </label>
            )}
            {select(t('assets.assetAccount'), assetAcc, setAssetAcc, assets)}
            {select(t('assets.accumAccount'), accumAcc, setAccumAcc, assets)}
            {select(t('assets.expenseAccount'), expenseAcc, setExpenseAcc, expenses)}
          </div>
          {locked && <p className="ui-help">{t('assets.lockedHelp')}</p>}
          {!asset && <p className="ui-help">{t('assets.createHelp')}</p>}
          {canWrite && (
            <div className="bk-row bk-row-end">
              {asset && !asset.hasRuns && asset.status !== 'disposed' && (
                <button type="button" className="btn btn-ghost btn-danger" onClick={() => setConfirm(true)}>
                  {t('common.delete')}
                </button>
              )}
              {asset?.status === 'registered' && (
                <button type="button" className="btn btn-secondary" onClick={() => setDispose({ date: todayIso(), proceeds: 0, account: '' })}>
                  {t('assets.dispose')}
                </button>
              )}
              <button type="submit" className="btn btn-secondary" disabled={busy}>
                {t('common.save')}
              </button>
              {(!asset || asset.status === 'draft') && (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(undefined, 'registered')}>
                  {t('assets.register')}
                </button>
              )}
            </div>
          )}
        </fieldset>
      </form>
      {asset && asset.status === 'disposed' && (
        <p className="ui-help">{t('assets.disposedOn', { date: date(asset.disposedDate), amount: m(asset.disposalProceeds ?? 0) })}</p>
      )}
      <Dialog open={!!dispose} title={t('assets.dispose')} onClose={() => setDispose(null)}>
        {dispose && (
          <form onSubmit={doDispose}>
            <div className="ui-modal-body">
              <label className="ui-field">
                <span className="label">{t('assets.disposeDate')}</span>
                <input className="input" type="date" required autoFocus value={dispose.date} onChange={(e) => setDispose({ ...dispose, date: e.target.value })} />
              </label>
              <label className="ui-field">
                <span className="label">{t('assets.proceeds')}</span>
                <MoneyInput value={dispose.proceeds} onChange={(v) => setDispose({ ...dispose, proceeds: v })} currency={currency} label={t('assets.proceeds')} />
              </label>
              <label className="ui-field">
                <span className="label">{t('assets.proceedsAccount')}</span>
                <select className="select" value={dispose.account} onChange={(e) => setDispose({ ...dispose, account: e.target.value })}>
                  <option value="">{t('assets.defaultBank')}</option>
                  {assets
                    .filter((a) => a.subtype === 'bank' || a.subtype === 'cash')
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <p className="ui-help">{t('assets.disposeHelp')}</p>
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setDispose(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary">
                {t('assets.disposeConfirm')}
              </button>
            </div>
          </form>
        )}
      </Dialog>
      <ConfirmDialog open={confirm} title={t('assets.deleteTitle')} message={t('assets.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} tone="danger" onConfirm={remove} onCancel={() => setConfirm(false)} />
    </div>
  );
}

// ---------- Presupuestos financieros ----------

export function BudgetsList({ budgets, canWrite }: { budgets: Array<{ id: string; name: string; startMonth: string; months: number; total: number }>; canWrite: boolean }) {
  const t = useTranslations('books');
  return (
    <div className="app-page ui-page bk-page">
      <PageHeader
        title={t('nav.budgets')}
        description={t('budgets.desc')}
        actions={
          canWrite ? (
            <Link className="btn btn-primary" href="/app/books/budgets/new">
              {t('budgets.new')}
            </Link>
          ) : undefined
        }
      />
      {budgets.length === 0 ? (
        <EmptyState product="books" title={t('budgets.emptyTitle')} body={t('budgets.emptyBody')} action={canWrite ? { label: t('budgets.new'), href: '/app/books/budgets/new' } : undefined} />
      ) : (
        <StackTable head={[{ label: t('budgets.colName') }, { label: t('budgets.colStart') }, { label: t('budgets.colMonths'), num: true }, { label: t('common.actions') }]}>
          {budgets.map((b) => (
            <tr key={b.id}>
              <th scope="row">
                <Link href={`/app/books/budgets/${b.id}`} className="bk-rowtext">
                  <span className="bk-rowtitle">{b.name}</span>
                </Link>
              </th>
              <td className="data" data-label={t('budgets.colStart')}>
                {b.startMonth}
              </td>
              <td className="num" data-label={t('budgets.colMonths')}>
                {b.months}
              </td>
              <td className="table-stack-actions">
                <Link className="btn btn-ghost btn-sm" href={`/app/books/reports/budget-variance?budget=${b.id}`}>
                  {t('budgets.compare')}
                </Link>
              </td>
            </tr>
          ))}
        </StackTable>
      )}
    </div>
  );
}

export function BudgetEditor({ budget, accounts, currency, canWrite, fiscalStartMonth }: { budget: BudgetDto | null; accounts: AccOpt[]; currency: string; canWrite: boolean; fiscalStartMonth: number }) {
  const t = useTranslations('books');
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const year = Number(todayIso().slice(0, 4));
  const [name, setName] = useState(budget?.name ?? '');
  const [startMonth, setStartMonth] = useState(budget?.startMonth ?? `${year}-${String(fiscalStartMonth).padStart(2, '0')}`);
  const [months, setMonths] = useState(String(budget?.months ?? 12));
  const [cells, setCells] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [acc, row] of Object.entries(budget?.lines ?? {})) for (const [mon, v] of Object.entries(row)) out[`${acc}:${mon}`] = toInputString(v, currency);
    return out;
  });
  const [fillAcc, setFillAcc] = useState<{ accountId: string; amount: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const monthList = useMemo(() => (/^\d{4}-\d{2}$/.test(startMonth) ? budgetMonths(startMonth, Math.max(1, Math.min(36, Number(months) || 12))) : []), [startMonth, months]);
  const parsed = (v: string | undefined) => (v?.trim() ? parseAmountLocal(v, currency) : 0);
  const rowsFor = (type: string) => accounts.filter((a) => a.type === type);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const lines: Array<{ accountId: string; month: string; amount: number }> = [];
    for (const a of accounts) {
      for (const mon of monthList) {
        const v = parsed(cells[`${a.id}:${mon}`]);
        if (v == null) return push(t('errors.invalid_amount'), 'bad');
        if (v !== 0 || budget?.lines[a.id]?.[mon] !== undefined) lines.push({ accountId: a.id, month: mon, amount: v });
      }
    }
    setBusy(true);
    const json = { name, startMonth, months: Number(months) || 12, lines };
    const res = budget ? await api<{ budget?: BudgetDto }>(`/api/books/budgets/${budget.id}`, { method: 'PATCH', json }) : await api<{ budget?: BudgetDto }>('/api/books/budgets', { method: 'POST', json });
    setBusy(false);
    if (!res.ok || !res.data.budget) return push(errText(res.data.error), 'bad');
    push(t('common.saved'));
    if (!budget) router.replace(`/app/books/budgets/${res.data.budget.id}`);
    else router.refresh();
  };
  const fill = (e: FormEvent) => {
    e.preventDefault();
    if (!fillAcc) return;
    setCells((c) => ({ ...c, ...Object.fromEntries(monthList.map((m) => [`${fillAcc.accountId}:${m}`, fillAcc.amount])) }));
    setFillAcc(null);
  };
  const remove = async () => {
    if (!budget) return;
    const res = await api(`/api/books/budgets/${budget.id}`, { method: 'DELETE' });
    setConfirm(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.replace('/app/books/budgets');
    router.refresh();
  };
  const section = (title: string, type: string) => (
    <>
      <tr className="bk-budget-section">
        <th scope="colgroup" colSpan={monthList.length + 1}>
          {title}
        </th>
      </tr>
      {rowsFor(type).map((a) => (
        <tr key={a.id}>
          <th scope="row" className="bk-budget-account">
            <span className="bk-budget-name" title={`${a.code} ${a.name}`}>
              {a.code} {a.name}
            </span>
            {canWrite && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFillAcc({ accountId: a.id, amount: '' })}>
                {t('budgets.fill')}
              </button>
            )}
          </th>
          {monthList.map((mon) => (
            <td key={mon}>
              <input className="input num bk-budget-cell" inputMode="decimal" disabled={!canWrite} aria-label={`${a.name} ${mon}`} value={cells[`${a.id}:${mon}`] ?? ''} onChange={(e) => setCells((c) => ({ ...c, [`${a.id}:${mon}`]: e.target.value }))} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
  return (
    <div className="app-page ui-page bk-page">
      {toast}
      <PageHeader
        back={{ href: '/app/books/budgets', label: t('nav.budgets') }}
        title={budget ? budget.name : t('budgets.new')}
        actions={
          budget ? (
            <Link className="btn btn-secondary" href={`/app/books/reports/budget-variance?budget=${budget.id}`}>
              {t('budgets.compare')}
            </Link>
          ) : undefined
        }
      />
      <form onSubmit={save}>
        <section className="panel bk-panel">
          <fieldset className="bk-fieldset" disabled={!canWrite}>
            <div className="bk-grid">
              <label className="ui-field">
                <span className="label">{t('budgets.colName')}</span>
                <input className="input" required maxLength={120} autoFocus={!budget} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="ui-field">
                <span className="label">{t('budgets.colStart')}</span>
                <input className="input" type="month" required value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
              </label>
              <label className="ui-field">
                <span className="label">{t('budgets.colMonths')}</span>
                <input className="input num" type="number" min={1} max={36} required value={months} onChange={(e) => setMonths(e.target.value)} />
              </label>
            </div>
          </fieldset>
        </section>
        <section className="panel bk-panel">
          <p className="ui-help">{t('budgets.help', { currency })}</p>
          <div className="bk-table-wrap bk-budget-wrap" tabIndex={0} role="region" aria-label={t('nav.budgets')}>
            <table className="table bk-table bk-budget">
              <thead>
                <tr>
                  <th scope="col">{t('budgets.colAccount')}</th>
                  {monthList.map((m) => (
                    <th key={m} scope="col" className="num data">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section(t('reports.income'), 'income')}
                {section(t('reports.expenses'), 'expense')}
              </tbody>
            </table>
          </div>
          {canWrite && (
            <div className="bk-row bk-row-end">
              {budget && (
                <button type="button" className="btn btn-ghost btn-danger" onClick={() => setConfirm(true)}>
                  {t('common.delete')}
                </button>
              )}
              <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
                {t('common.save')}
              </button>
            </div>
          )}
        </section>
      </form>
      <Dialog open={!!fillAcc} title={t('budgets.fillTitle')} onClose={() => setFillAcc(null)}>
        {fillAcc && (
          <form onSubmit={fill}>
            <div className="ui-modal-body">
              <label className="ui-field">
                <span className="label">{t('budgets.fillAmount', { currency })}</span>
                <input className="input num" inputMode="decimal" autoFocus required value={fillAcc.amount} onChange={(e) => setFillAcc({ ...fillAcc, amount: e.target.value })} />
              </label>
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setFillAcc(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary">
                {t('budgets.fill')}
              </button>
            </div>
          </form>
        )}
      </Dialog>
      <ConfirmDialog open={confirm} title={t('budgets.deleteTitle')} message={t('budgets.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} tone="danger" onConfirm={remove} onCancel={() => setConfirm(false)} />
    </div>
  );
}

// ---------- Reglas bancarias y transferencias ----------

type RuleForm = { id?: string; name: string; direction: string; op: string; text: string; minAmount: number | null; maxAmount: number | null; bankAccountId: string; accountId: string; memo: string };

export function BankRulesView({ rules, accounts, banks, canWrite, currency }: { rules: BankRuleDto[]; accounts: Array<{ id: string; code: string; name: string; subtype: string }>; banks: Opt[]; canWrite: boolean; currency: string }) {
  const t = useTranslations('books');
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [form, setForm] = useState<RuleForm | null>(null);
  const [remove, setRemove] = useState<BankRuleDto | null>(null);
  const blank: RuleForm = { name: '', direction: 'any', op: 'contains', text: '', minAmount: null, maxAmount: null, bankAccountId: '', accountId: '', memo: '' };
  const targets = accounts.filter((a) => a.subtype !== 'receivable' && a.subtype !== 'payable' && a.subtype !== 'bank');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const { id, bankAccountId, ...rest } = form;
    const json = { ...rest, bankAccountId: bankAccountId || null };
    const res = id ? await api(`/api/books/bank-rules/${id}`, { method: 'PATCH', json }) : await api('/api/books/bank-rules', { method: 'POST', json });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setForm(null);
    push(t('common.saved'));
    router.refresh();
  };
  const doRemove = async () => {
    if (!remove) return;
    const res = await api(`/api/books/bank-rules/${remove.id}`, { method: 'DELETE' });
    setRemove(null);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.refresh();
  };
  const cond = (r: BankRuleDto) => t(`rules.op.${r.op}`, { text: r.text });
  return (
    <div className="app-page ui-page bk-page">
      {toast}
      <PageHeader
        back={{ href: '/app/books/banking', label: t('nav.banking') }}
        title={t('rules.title')}
        description={t('rules.desc')}
        actions={
          canWrite ? (
            <button type="button" className="btn btn-primary" onClick={() => setForm(blank)}>
              {t('rules.new')}
            </button>
          ) : undefined
        }
      />
      {rules.length === 0 ? (
        <EmptyState product="books" title={t('rules.emptyTitle')} body={t('rules.emptyBody')} />
      ) : (
        <StackTable head={[{ label: t('rules.colName') }, { label: t('rules.colCondition') }, { label: t('rules.colDirection') }, { label: t('rules.colAccount') }, { label: t('rules.colApplied'), num: true }, { label: t('common.actions') }]}>
          {rules.map((r) => (
            <tr key={r.id}>
              <th scope="row">
                <span className="bk-rowtitle">{r.name}</span>
              </th>
              <td className="bk-break" data-label={t('rules.colCondition')}>
                {cond(r)}
              </td>
              <td data-label={t('rules.colDirection')}>{t(`rules.dir.${r.direction}`)}</td>
              <td className="bk-break" data-label={t('rules.colAccount')}>
                {r.accountName}
              </td>
              <td className="num" data-label={t('rules.colApplied')}>
                {r.appliedCount}
              </td>
              <td className="table-stack-actions">
                {canWrite && (
                  <>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ id: r.id, name: r.name, direction: r.direction, op: r.op, text: r.text, minAmount: r.minAmount, maxAmount: r.maxAmount, bankAccountId: r.bankAccountId ?? '', accountId: r.accountId, memo: r.memo })}>
                      {t('rules.edit')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemove(r)}>
                      {t('common.delete')}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </StackTable>
      )}
      <p className="ui-help bk-foot">{t('rules.help')}</p>
      <Dialog open={!!form} title={form?.id ? t('rules.edit') : t('rules.new')} onClose={() => setForm(null)}>
        {form && (
          <form onSubmit={save}>
            <div className="ui-modal-body">
              <label className="ui-field">
                <span className="label">{t('rules.colName')}</span>
                <input className="input" maxLength={120} autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <div className="bk-grid">
                <label className="ui-field">
                  <span className="label">{t('rules.match')}</span>
                  <select className="select" value={form.op} onChange={(e) => setForm({ ...form, op: e.target.value })}>
                    {['contains', 'starts', 'equals'].map((o) => (
                      <option key={o} value={o}>
                        {t(`rules.opLabel.${o}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ui-field">
                  <span className="label">{t('rules.text')}</span>
                  <input className="input" required maxLength={120} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
                </label>
                <label className="ui-field">
                  <span className="label">{t('rules.colDirection')}</span>
                  <select className="select" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                    {['any', 'in', 'out'].map((o) => (
                      <option key={o} value={o}>
                        {t(`rules.dir.${o}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ui-field">
                  <span className="label">{t('rules.bank')}</span>
                  <select className="select" value={form.bankAccountId} onChange={(e) => setForm({ ...form, bankAccountId: e.target.value })}>
                    <option value="">{t('rules.anyBank')}</option>
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ui-field">
                  <span className="label">{t('rules.min')}</span>
                  <MoneyInput value={form.minAmount} onChange={(v) => setForm({ ...form, minAmount: v })} currency={currency} label={t('rules.min')} />
                </label>
                <label className="ui-field">
                  <span className="label">{t('rules.max')}</span>
                  <MoneyInput value={form.maxAmount} onChange={(v) => setForm({ ...form, maxAmount: v })} currency={currency} label={t('rules.max')} />
                </label>
              </div>
              <label className="ui-field">
                <span className="label">{t('rules.colAccount')}</span>
                <select className="select" required value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
                  <option value="">{t('banking.pickAccount')}</option>
                  {targets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ui-field">
                <span className="label">{t('banking.memo')}</span>
                <input className="input" maxLength={200} value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
              </label>
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={!form.accountId || !form.text.trim()}>
                {t('common.save')}
              </button>
            </div>
          </form>
        )}
      </Dialog>
      <ConfirmDialog open={!!remove} title={t('rules.deleteTitle')} message={t('rules.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} tone="danger" onConfirm={doRemove} onCancel={() => setRemove(null)} />
    </div>
  );
}

export function TransferDialog({ open, onClose, banks, currency, onDone, initialFrom }: { open: boolean; onClose: () => void; banks: Opt[]; currency: string; onDone: (msg: string, bad?: boolean) => void; initialFrom?: string }) {
  const t = useTranslations('books');
  const errText = useErrorText();
  const [fromId, setFromId] = useState(initialFrom ?? banks[0]?.id ?? '');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [day, setDay] = useState(todayIso());
  const [reference, setReference] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await api('/api/books/transfers', { method: 'POST', json: { fromId, toId, amount: amount ?? 0, date: day, reference } });
    if (!res.ok) return onDone(errText(res.data.error), true);
    setAmount(null);
    setReference('');
    onDone(t('transfer.done'));
    onClose();
  };
  return (
    <Dialog open={open} title={t('transfer.title')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="ui-modal-body">
          <label className="ui-field">
            <span className="label">{t('transfer.from')}</span>
            <select className="select" required autoFocus value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            <span className="label">{t('transfer.to')}</span>
            <select className="select" required value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">{t('banking.pickAccount')}</option>
              {banks
                .filter((b) => b.id !== fromId)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="ui-field">
            <span className="label">{t('transfer.amount', { currency })}</span>
            <MoneyInput value={amount} onChange={setAmount} currency={currency} label={t('transfer.amount', { currency })} required />
          </label>
          <label className="ui-field">
            <span className="label">{t('batch.date')}</span>
            <input className="input" type="date" required value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          <label className="ui-field">
            <span className="label">{t('batch.reference')}</span>
            <input className="input" maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
          <p className="ui-help">{t('transfer.help')}</p>
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!toId || !amount}>
            {t('transfer.submit')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------- Saldos iniciales ----------

export function OpeningBalances({ accounts, currency, lockDate }: { accounts: Array<{ id: string; code: string; name: string; type: string; subtype: string }>; currency: string; lockDate: string | null }) {
  const t = useTranslations('books');
  const locale = useLocale();
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [day, setDay] = useState(`${Number(todayIso().slice(0, 4)) - 1}-12-31`);
  const [values, setValues] = useState<Record<string, { debit: number | null; credit: number | null }>>({});
  const [busy, setBusy] = useState(false);
  const list = accounts.filter((a) => a.subtype !== 'receivable' && a.subtype !== 'payable');
  const d = Object.values(values).reduce((s, v) => s + (v.debit ?? 0), 0);
  const c = Object.values(values).reduce((s, v) => s + (v.credit ?? 0), 0);
  const m = (v: number) => formatMoney(v, currency, locale);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const lines = Object.entries(values)
      .filter(([, v]) => (v.debit ?? 0) || (v.credit ?? 0))
      .map(([accountId, v]) => ({ accountId, debit: v.debit ?? 0, credit: v.credit ?? 0 }));
    if (!lines.length) return push(t('opening.nothing'), 'bad');
    setBusy(true);
    const res = await api<{ journalId?: string }>('/api/books/opening-balances', { method: 'POST', json: { date: day, lines } });
    setBusy(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.push(`/app/books/journal/${res.data.journalId}`);
  };
  return (
    <div className="app-page ui-page bk-page bk-narrow">
      {toast}
      <PageHeader back={{ href: '/app/books/journal', label: t('nav.journal') }} title={t('opening.title')} description={t('opening.desc')} />
      <form className="panel bk-panel" onSubmit={submit}>
        <label className="ui-field">
          <span className="label">{t('opening.date')}</span>
          <input className="input" type="date" required value={day} min={lockDate ?? undefined} onChange={(e) => setDay(e.target.value)} />
        </label>
        <p className="ui-help">{t('opening.help')}</p>
        <StackTable head={[{ label: t('opening.colAccount') }, { label: t('opening.colDebit'), num: true }, { label: t('opening.colCredit'), num: true }]}>
          {list.map((a) => (
            <tr key={a.id}>
              <th scope="row">
                {a.code} {a.name}
              </th>
              <td data-label={t('opening.colDebit')}>
                <MoneyInput value={values[a.id]?.debit ?? null} onChange={(v) => setValues((x) => ({ ...x, [a.id]: { debit: v, credit: x[a.id]?.credit ?? null } }))} currency={currency} label={`${a.name} ${t('opening.colDebit')}`} />
              </td>
              <td data-label={t('opening.colCredit')}>
                <MoneyInput value={values[a.id]?.credit ?? null} onChange={(v) => setValues((x) => ({ ...x, [a.id]: { credit: v, debit: x[a.id]?.debit ?? null } }))} currency={currency} label={`${a.name} ${t('opening.colCredit')}`} />
              </td>
            </tr>
          ))}
        </StackTable>
        <p className="bk-total-line">
          <span>{t('opening.diff')}</span>
          <span className="data">{m(d - c)}</span>
        </p>
        <div className="bk-row bk-row-end">
          <button type="submit" className="btn btn-primary" disabled={busy || d + c === 0} aria-busy={busy}>
            {t('opening.post')}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- Estado de cuenta de un contacto ----------

export function StatementPanel({ contactId, kind, email, portalToken, canWrite, appUrl }: { contactId: string; kind: string; email: string; portalToken: string | null; canWrite: boolean; appUrl: string }) {
  const t = useTranslations('books');
  const locale = useLocale();
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const today = todayIso();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [side, setSide] = useState<'customer' | 'supplier'>(kind === 'supplier' ? 'supplier' : 'customer');
  const [st, setSt] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(portalToken);
  useEffect(() => {
    let live = true;
    setSt(null);
    setError(null);
    api<{ statement?: Statement }>(`/api/books/contacts/${contactId}/statement?from=${from}&to=${to}&side=${side}`).then((res) => {
      if (!live) return;
      if (res.ok && res.data.statement) setSt(res.data.statement);
      else setError(errText(res.data.error));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId, from, to, side]);
  const portal = async (action: 'enable' | 'revoke' | 'send') => {
    const res = await api<{ token?: string | null; to?: string }>(`/api/books/contacts/${contactId}/portal`, { method: 'POST', json: { action, locale } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    if (action === 'send') {
      push(t('statement.sent', { to: res.data.to ?? email }));
      if (!token) {
        const again = await api<{ token?: string | null }>(`/api/books/contacts/${contactId}/portal`, { method: 'POST', json: { action: 'enable' } });
        if (again.ok) setToken(again.data.token ?? null);
      }
    } else setToken(res.data.token ?? null);
  };
  const link = token ? `${appUrl}/${locale}/statement/${token}` : null;
  return (
    <section className="panel bk-panel">
      {toast}
      <div className="bk-toolbar">
        <label className="ui-field">
          <span className="label">{t('reports.from')}</span>
          <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="ui-field">
          <span className="label">{t('reports.to')}</span>
          <input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        {kind === 'both' && (
          <label className="ui-field">
            <span className="label">{t('statement.side')}</span>
            <select className="select" value={side} onChange={(e) => setSide(e.target.value as typeof side)}>
              <option value="customer">{t('statement.customer')}</option>
              <option value="supplier">{t('statement.supplier')}</option>
            </select>
          </label>
        )}
        <a className="btn btn-secondary" href={`/api/books/contacts/${contactId}/statement?from=${from}&to=${to}&side=${side}&format=csv`} download>
          {t('reports.csv')}
        </a>
      </div>
      {error ? (
        <p className="ui-error" role="alert">
          {error}
        </p>
      ) : !st ? (
        <p className="ui-help" role="status">
          {t('common.loading')}
        </p>
      ) : st.currencies.length === 0 ? (
        <EmptyState compact body={t('statement.empty')} />
      ) : (
        st.currencies.map((c) => (
          <div key={c.currency} className="bk-section">
            {st.currencies.length > 1 && <h3 className="bk-panel-title">{c.currency}</h3>}
            <StackTable head={[{ label: t('statement.colDate') }, { label: t('statement.colDoc') }, { label: t('statement.colCharge'), num: true }, { label: t('statement.colCredit'), num: true }, { label: t('statement.colBalance'), num: true }]}>
              <tr>
                <th scope="row" colSpan={4}>
                  {t('statement.opening')}
                </th>
                <td className="num data" data-label={t('statement.colBalance')}>
                  {formatMoney(c.opening, c.currency, locale)}
                </td>
              </tr>
              {c.entries.map((e, i) => (
                <tr key={`${e.docId}:${i}`}>
                  <td data-label={t('statement.colDate')}>{date(e.date)}</td>
                  <th scope="row">
                    {t(`statement.kinds.${e.kind}`)} {e.label}
                  </th>
                  <td className="num" data-label={t('statement.colCharge')}>
                    {e.charge ? formatMoney(e.charge, c.currency, locale) : ''}
                  </td>
                  <td className="num" data-label={t('statement.colCredit')}>
                    {e.credit ? formatMoney(e.credit, c.currency, locale) : ''}
                  </td>
                  <td className="num data" data-label={t('statement.colBalance')}>
                    {formatMoney(e.balance, c.currency, locale)}
                  </td>
                </tr>
              ))}
            </StackTable>
            <p className="bk-total-line" data-testid="statement-closing">
              <span>{t('statement.closing')}</span>
              <span className="data">{formatMoney(c.closing, c.currency, locale)}</span>
            </p>
          </div>
        ))
      )}
      {side === 'customer' && canWrite && (
        <div className="bk-section">
          <h3 className="bk-panel-title">{t('statement.portal')}</h3>
          <p className="ui-help">{t('statement.portalHelp')}</p>
          {link && (
            <div className="bk-row">
              <input className="input data bk-grow" readOnly value={link} aria-label={t('statement.portal')} onFocus={(e) => e.target.select()} />
            </div>
          )}
          <div className="bk-row">
            {link ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => portal('revoke')}>
                {t('statement.revoke')}
              </button>
            ) : (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => portal('enable')}>
                {t('statement.enable')}
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" disabled={!email} onClick={() => portal('send')}>
              {t('statement.send')}
            </button>
          </div>
          {!email && <p className="ui-help">{t('statement.noEmail')}</p>}
        </div>
      )}
    </section>
  );
}

// ---------- Centros de costo (Ajustes) ----------

export function TrackingSettings({ categories, canWrite }: { categories: TrackingCategoryDto[]; canWrite: boolean }) {
  const t = useTranslations('books');
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(categories.map((c) => [c.slot, c.name])));
  const [newOption, setNewOption] = useState<Record<string, string>>({});
  const call = async (json: Record<string, unknown>) => {
    const res = await api('/api/books/tracking', { method: 'POST', json });
    if (!res.ok) {
      push(errText(res.data.error), 'bad');
      return false;
    }
    router.refresh();
    return true;
  };
  return (
    <section className="panel bk-panel">
      {toast}
      <p className="ui-help">{t('tracking.help')}</p>
      {(['a', 'b'] as const).map((slot) => {
        const cat = categories.find((c) => c.slot === slot);
        return (
          <div key={slot} className="bk-section">
            <form
              className="bk-toolbar"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await call({ slot, name: names[slot] ?? '' })) push(t('common.saved'));
              }}
            >
              <label className="ui-field">
                <span className="label">{t('tracking.category', { n: slot === 'a' ? 1 : 2 })}</span>
                <input className="input" maxLength={80} disabled={!canWrite} placeholder={t('tracking.categoryPh')} value={names[slot] ?? ''} onChange={(e) => setNames({ ...names, [slot]: e.target.value })} />
              </label>
              {canWrite && (
                <button type="submit" className="btn btn-secondary">
                  {t('common.save')}
                </button>
              )}
            </form>
            {cat ? (
              <>
                {cat.options.length === 0 ? (
                  <p className="ui-help">{t('tracking.noOptions')}</p>
                ) : (
                  <ul className="bk-list">
                    {cat.options.map((o) => (
                      <li key={o.id}>
                        <span className="bk-break">{o.name}</span>
                        {o.archived && <span className="bk-rowmeta">{t('tracking.archived')}</span>}
                        {canWrite && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => call({ categoryId: cat.id, id: o.id, archived: !o.archived })}>
                            {o.archived ? t('tracking.restore') : t('tracking.archive')}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canWrite && (
                  <form
                    className="bk-toolbar"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await call({ categoryId: cat.id, name: newOption[cat.id] ?? '' })) setNewOption({ ...newOption, [cat.id]: '' });
                    }}
                  >
                    <label className="ui-field">
                      <span className="label">{t('tracking.newOption')}</span>
                      <input className="input" maxLength={80} required value={newOption[cat.id] ?? ''} onChange={(e) => setNewOption({ ...newOption, [cat.id]: e.target.value })} />
                    </label>
                    <button type="submit" className="btn btn-secondary">
                      {t('tracking.add')}
                    </button>
                  </form>
                )}
              </>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

// ---------- Importar y exportar CSV ----------

export function CsvTools({ kind }: { kind: 'contacts' | 'items' }) {
  const t = useTranslations('books');
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    const form = new FormData();
    form.set('kind', kind);
    form.set('file', file);
    const res = await api<{ created?: number; skipped?: number; errors?: unknown[] }>('/api/books/import', { method: 'POST', body: form });
    setBusy(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(t('csv.imported', { created: res.data.created ?? 0, skipped: res.data.skipped ?? 0, errors: res.data.errors?.length ?? 0 }), res.data.errors?.length ? 'bad' : 'ok');
    router.refresh();
  };
  return (
    <>
      {toast}
      <label className={`btn btn-secondary bk-file${busy ? ' is-disabled' : ''}`} aria-busy={busy} title={t(`csv.help.${kind}`)}>
        {t('csv.import')}
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f);
          }}
        />
      </label>
    </>
  );
}
