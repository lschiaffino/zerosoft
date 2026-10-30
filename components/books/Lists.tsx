'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { DocSummary } from '@/lib/books-docs';
import type { ContactDto, ItemDto } from '@/lib/books';
import type { ExpenseDto, PoDto } from '@/lib/books-purchasing';
import type { RecurringDto } from '@/lib/books-recurring';
import type { BankAccountDto } from '@/lib/books-bank';
import { formatMoney, parseAmount } from '@/lib/books-money';
import { StatusBadge, useDate } from './ui';

type DocKind = 'invoice' | 'credit_note' | 'bill';
const PATH: Record<DocKind, string> = { invoice: 'invoices', credit_note: 'credit-notes', bill: 'bills' };
const NAV: Record<DocKind, string> = { invoice: 'invoices', credit_note: 'creditNotes', bill: 'bills' };

function SearchBar({ base, q, placeholder, extra }: { base: string; q: string; placeholder: string; extra?: Record<string, string> }) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const sp = new URLSearchParams({ ...(extra ?? {}), ...(query.trim() ? { q: query.trim() } : {}) });
    router.push(`${base}${sp.toString() ? `?${sp}` : ''}`);
  };
  return (
    <form onSubmit={submit} role="search" className="bk-search">
      <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </form>
  );
}

function Table({ head, children, caption }: { head: Array<{ label: string; num?: boolean; hideSm?: boolean }>; children: ReactNode; caption?: string }) {
  return (
    <div className="table-wrap bk-table-wrap">
      <table className="table bk-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h.label} scope="col" className={`${h.num ? 'num' : ''}${h.hideSm ? ' bk-hide-sm' : ''}`.trim() || undefined}>
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

export function DocumentsList({ kind, items, total, q, status, canWrite, baseCurrency }: { kind: DocKind; items: DocSummary[]; total: number; q: string; status: string; canWrite: boolean; baseCurrency: string }) {
  const t = useTranslations('books');
  const locale = useLocale();
  const date = useDate();
  const base = `/app/books/${PATH[kind]}`;
  const statuses = kind === 'credit_note' ? ['', 'draft', 'sent', 'paid', 'void'] : ['', 'draft', 'open', 'overdue', 'paid', 'void'];
  return (
    <div className="app-page ui-page bk-page">
      <PageHeader
        title={t(`nav.${NAV[kind]}`)}
        description={t(`docs.${kind}.desc`)}
        actions={
          canWrite && kind !== 'credit_note' ? (
            <Link className="btn btn-primary" href={`${base}/new`}>
              {t(`docs.${kind}.new`)}
            </Link>
          ) : undefined
        }
      />
      <div className="bk-toolbar">
        <SearchBar base={base} q={q} placeholder={t('docs.search')} extra={status ? { status } : undefined} />
        <div className="ui-tabs bk-filter" role="tablist" aria-label={t('docs.filter')}>
          {statuses.map((s) => (
            <Link key={s || 'all'} role="tab" aria-selected={status === s} className="ui-tab" href={`${base}${s || q ? `?${new URLSearchParams({ ...(q ? { q } : {}), ...(s ? { status: s } : {}) })}` : ''}`}>
              {s ? t(`status.${s}`) : t('common.all')}
            </Link>
          ))}
        </div>
      </div>
      {items.length === 0 ? (
        q || status ? (
          <EmptyState compact body={t('common.noMatch')} />
        ) : (
          <EmptyState
            product="books"
            title={t(`docs.${kind}.emptyTitle`)}
            body={t(`docs.${kind}.emptyBody`)}
            action={canWrite && kind !== 'credit_note' ? { label: t(`docs.${kind}.new`), href: `${base}/new` } : undefined}
          />
        )
      ) : (
        <Table
          caption={t('common.count', { n: total })}
          head={[
            { label: t('docs.colDocument') },
            { label: t('docs.colContact'), hideSm: true },
            { label: t('docs.colDate'), hideSm: true },
            { label: t('docs.colStatus') },
            { label: t('docs.colTotal'), num: true },
            { label: t('docs.colDue'), num: true, hideSm: true },
          ]}
        >
          {items.map((d) => (
            <tr key={d.id}>
              <th scope="row">
                <Link href={`${base}/${d.id}`} className="bk-rowtext">
                  <span className="bk-rowtitle">{d.reference || d.numberLabel || d.contactName || t('docs.untitled')}</span>
                  <span className="bk-rowmeta">{[d.reference ? d.numberLabel : '', d.contactName].filter(Boolean).join(' · ') || t('status.draft')}</span>
                </Link>
              </th>
              <td className="bk-hide-sm bk-ellipsis">{d.contactName}</td>
              <td className="bk-hide-sm">{date(d.issueDate)}</td>
              <td>
                <StatusBadge status={d.status} />
              </td>
              <td className="num">{formatMoney(d.total, d.currency, locale)}</td>
              <td className="num bk-hide-sm">{d.amountDue ? formatMoney(d.amountDue, d.currency, locale) : ''}</td>
            </tr>
          ))}
        </Table>
      )}
      {baseCurrency && <p className="ui-help bk-foot">{t('docs.baseCurrency', { currency: baseCurrency })}</p>}
    </div>
  );
}

export function ContactsList({ contacts, q, kind, canWrite, crm }: { contacts: ContactDto[]; q: string; kind: string; canWrite: boolean; crm: boolean }) {
  const t = useTranslations('books');
  const kinds = ['', 'customer', 'supplier'];
  return (
    <div className="app-page ui-page bk-page">
      <PageHeader
        title={t('nav.contacts')}
        description={t('contacts.desc')}
        actions={
          canWrite ? (
            <>
              {crm && (
                <Link className="btn btn-secondary" href="/app/books/contacts/new?crm=1">
                  {t('contacts.importCrm')}
                </Link>
              )}
              <Link className="btn btn-primary" href="/app/books/contacts/new">
                {t('contacts.new')}
              </Link>
            </>
          ) : undefined
        }
      />
      <div className="bk-toolbar">
        <SearchBar base="/app/books/contacts" q={q} placeholder={t('contacts.search')} extra={kind ? { kind } : undefined} />
        <div className="ui-tabs bk-filter" role="tablist" aria-label={t('contacts.kind')}>
          {kinds.map((k) => (
            <Link key={k || 'all'} role="tab" aria-selected={kind === k} className="ui-tab" href={`/app/books/contacts${k || q ? `?${new URLSearchParams({ ...(q ? { q } : {}), ...(k ? { kind: k } : {}) })}` : ''}`}>
              {k ? t(`contacts.kinds.${k}`) : t('common.all')}
            </Link>
          ))}
        </div>
      </div>
      {contacts.length === 0 ? (
        q || kind ? (
          <EmptyState compact body={t('common.noMatch')} />
        ) : (
          <EmptyState product="books" title={t('contacts.emptyTitle')} body={t('contacts.emptyBody')} action={canWrite ? { label: t('contacts.new'), href: '/app/books/contacts/new' } : undefined} />
        )
      ) : (
        <Table head={[{ label: t('contacts.colName') }, { label: t('contacts.colTaxId'), hideSm: true }, { label: t('contacts.colKind') }]}>
          {contacts.map((c) => (
            <tr key={c.id}>
              <th scope="row">
                <Link href={`/app/books/contacts/${c.id}`} className="bk-rowtext">
                  <span className="bk-rowtitle">{c.name}</span>
                  {c.email && <span className="bk-rowmeta">{c.email}</span>}
                </Link>
              </th>
              <td className="bk-hide-sm data">{c.taxId}</td>
              <td>{t(`contacts.kinds.${c.kind}`)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

export function ItemsList({ items, q, canWrite, currency }: { items: ItemDto[]; q: string; canWrite: boolean; currency: string }) {
  const t = useTranslations('books');
  const locale = useLocale();
  return (
    <div className="app-page ui-page bk-page">
      <PageHeader
        title={t('nav.items')}
        description={t('items.desc')}
        actions={
          canWrite ? (
            <Link className="btn btn-primary" href="/app/books/items/new">
              {t('items.new')}
            </Link>
          ) : undefined
        }
      />
      <div className="bk-toolbar">
        <SearchBar base="/app/books/items" q={q} placeholder={t('items.search')} />
      </div>
      {items.length === 0 ? (
        q ? (
          <EmptyState compact body={t('common.noMatch')} />
        ) : (
          <EmptyState product="books" title={t('items.emptyTitle')} body={t('items.emptyBody')} action={canWrite ? { label: t('items.new'), href: '/app/books/items/new' } : undefined} />
        )
      ) : (
        <Table head={[{ label: t('items.colName') }, { label: t('items.colPrice'), num: true }, { label: t('items.colCost'), num: true, hideSm: true }, { label: t('items.colStock'), num: true }]}>
          {items.map((i) => (
            <tr key={i.id}>
              <th scope="row">
                <Link href={`/app/books/items/${i.id}`} className="bk-rowtext">
                  <span className="bk-rowtitle">{i.name}</span>
                  <span className="bk-rowmeta">{[i.sku, t(`items.kinds.${i.kind}`), i.shopLinked ? t('items.shopLinkedShort') : ''].filter(Boolean).join(' · ')}</span>
                </Link>
              </th>
              <td className="num">{formatMoney(i.price, currency, locale)}</td>
              <td className="num bk-hide-sm">{formatMoney(i.cost, currency, locale)}</td>
              <td className="num">{i.trackStock ? i.stock : ''}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

export function ExpensesList({ expenses, q, status, canWrite }: { expenses: ExpenseDto[]; q: string; status: string; canWrite: boolean }) {
  const t = useTranslations('books');
  const locale = useLocale();
  const date = useDate();
  return (
    <div className="app-page ui-page bk-page">
      <PageHeader
        title={t('nav.expenses')}
        description={t('expenses.desc')}
        actions={
          canWrite ? (
            <Link className="btn btn-primary" href="/app/books/expenses/new">
              {t('expenses.new')}
            </Link>
          ) : undefined
        }
      />
      <div className="bk-toolbar">
        <SearchBar base="/app/books/expenses" q={q} placeholder={t('expenses.search')} extra={status ? { status } : undefined} />
        <div className="ui-tabs bk-filter" role="tablist" aria-label={t('docs.filter')}>
          {['', 'draft', 'posted', 'void'].map((s) => (
            <Link key={s || 'all'} role="tab" aria-selected={status === s} className="ui-tab" href={`/app/books/expenses${s || q ? `?${new URLSearchParams({ ...(q ? { q } : {}), ...(s ? { status: s } : {}) })}` : ''}`}>
              {s ? t(`status.${s}`) : t('common.all')}
            </Link>
          ))}
        </div>
      </div>
      {expenses.length === 0 ? (
        q || status ? (
          <EmptyState compact body={t('common.noMatch')} />
        ) : (
          <EmptyState product="books" title={t('expenses.emptyTitle')} body={t('expenses.emptyBody')} action={canWrite ? { label: t('expenses.new'), href: '/app/books/expenses/new' } : undefined} />
        )
      ) : (
        <Table head={[{ label: t('expenses.colVendor') }, { label: t('expenses.colCategory'), hideSm: true }, { label: t('docs.colStatus') }, { label: t('docs.colTotal'), num: true }]}>
          {expenses.map((e) => (
            <tr key={e.id}>
              <th scope="row">
                <Link href={`/app/books/expenses/${e.id}`} className="bk-rowtext">
                  <span className="bk-rowtitle">{e.vendor || e.description || t('expenses.untitled')}</span>
                  <span className="bk-rowmeta">
                    {date(e.date)}
                    {e.hasReceipt ? ` · ${t('expenses.hasReceipt')}` : ''}
                  </span>
                </Link>
              </th>
              <td className="bk-hide-sm bk-ellipsis">{e.accountName}</td>
              <td>
                <StatusBadge status={e.status} />
              </td>
              <td className="num">{formatMoney(e.total, e.currency, locale)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

export function PurchaseOrdersList({ orders, q, canWrite }: { orders: PoDto[]; q: string; canWrite: boolean }) {
  const t = useTranslations('books');
  const locale = useLocale();
  const date = useDate();
  return (
    <div className="app-page ui-page bk-page">
      <PageHeader
        title={t('nav.purchaseOrders')}
        description={t('po.desc')}
        actions={
          canWrite ? (
            <Link className="btn btn-primary" href="/app/books/purchase-orders/new">
              {t('po.new')}
            </Link>
          ) : undefined
        }
      />
      <div className="bk-toolbar">
        <SearchBar base="/app/books/purchase-orders" q={q} placeholder={t('po.search')} />
      </div>
      {orders.length === 0 ? (
        q ? (
          <EmptyState compact body={t('common.noMatch')} />
        ) : (
          <EmptyState product="books" title={t('po.emptyTitle')} body={t('po.emptyBody')} action={canWrite ? { label: t('po.new'), href: '/app/books/purchase-orders/new' } : undefined} />
        )
      ) : (
        <Table head={[{ label: t('po.colNumber') }, { label: t('docs.colContact') }, { label: t('docs.colStatus') }, { label: t('docs.colTotal'), num: true }]}>
          {orders.map((o) => (
            <tr key={o.id}>
              <th scope="row">
                <Link href={`/app/books/purchase-orders/${o.id}`} className="bk-rowtext">
                  <span className="bk-rowtitle data">{o.label}</span>
                  <span className="bk-rowmeta">{date(o.issueDate)}</span>
                </Link>
              </th>
              <td className="bk-ellipsis">{o.contactName}</td>
              <td>
                <StatusBadge status={o.status} />
              </td>
              <td className="num">{formatMoney(o.total, o.currency, locale)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

export function RecurringList({ items, canWrite }: { items: RecurringDto[]; canWrite: boolean }) {
  const t = useTranslations('books');
  const date = useDate();
  return (
    <div className="app-page ui-page bk-page">
      <PageHeader
        title={t('nav.recurring')}
        description={t('recurring.desc')}
        actions={
          canWrite ? (
            <Link className="btn btn-primary" href="/app/books/recurring/new">
              {t('recurring.new')}
            </Link>
          ) : undefined
        }
      />
      {items.length === 0 ? (
        <EmptyState product="books" title={t('recurring.emptyTitle')} body={t('recurring.emptyBody')} action={canWrite ? { label: t('recurring.new'), href: '/app/books/recurring/new' } : undefined} />
      ) : (
        <Table head={[{ label: t('recurring.colName') }, { label: t('docs.colContact'), hideSm: true }, { label: t('recurring.colNext') }, { label: t('docs.colStatus') }]}>
          {items.map((r) => (
            <tr key={r.id}>
              <th scope="row">
                <Link href={`/app/books/recurring/${r.id}`} className="bk-rowtext">
                  <span className="bk-rowtitle">{r.name}</span>
                  <span className="bk-rowmeta">{t(`recurring.freq.${r.frequency}`)}</span>
                </Link>
              </th>
              <td className="bk-hide-sm bk-ellipsis">{r.contactName}</td>
              <td>{r.status === 'active' ? date(r.nextDate) : ''}</td>
              <td>
                <StatusBadge status={r.status} />
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

export function BankAccountsList({ accounts, canWrite, currency }: { accounts: BankAccountDto[]; canWrite: boolean; currency: string }) {
  const t = useTranslations('books');
  const locale = useLocale();
  return (
    <div className="app-page ui-page bk-page">
      <PageHeader
        title={t('nav.banking')}
        description={t('banking.desc')}
        actions={
          canWrite ? (
            <Link className="btn btn-primary" href="/app/books/banking/new">
              {t('banking.new')}
            </Link>
          ) : undefined
        }
      />
      <p className="ui-help bk-note">{t('banking.noFeeds')}</p>
      {accounts.length === 0 ? (
        <EmptyState product="books" title={t('banking.emptyTitle')} body={t('banking.emptyBody')} action={canWrite ? { label: t('banking.new'), href: '/app/books/banking/new' } : undefined} />
      ) : (
        <Table head={[{ label: t('banking.colName') }, { label: t('banking.colBalance'), num: true }, { label: t('banking.colUnmatched'), num: true }]}>
          {accounts.map((a) => (
            <tr key={a.id}>
              <th scope="row">
                <Link href={`/app/books/banking/${a.id}`} className="bk-rowtext">
                  <span className="bk-rowtitle">{a.name}</span>
                  <span className="bk-rowmeta">{[a.bankName, a.last4 ? `···${a.last4}` : ''].filter(Boolean).join(' ')}</span>
                </Link>
              </th>
              <td className="num">{formatMoney(a.balance, currency, locale)}</td>
              <td className="num">{a.unmatched || ''}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

export function QuotesList({ quotes, crm }: { quotes: Array<{ id: string; number: string; title: string; total: number; currency: string; recipient: string; status: string }>; crm: boolean }) {
  const t = useTranslations('books');
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const convert = async (id: string) => {
    setBusy(id);
    setError(null);
    const res = await fetch('/api/books/documents/from-quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteId: id }) });
    const data = (await res.json().catch(() => ({}))) as { doc?: { id: string }; error?: string };
    setBusy(null);
    if (!res.ok || !data.doc) return setError(data.error ?? 'generic');
    router.push(`/app/books/invoices/${data.doc.id}`);
  };
  return (
    <div className="app-page ui-page bk-page">
      <PageHeader title={t('nav.quotes')} description={t('quotes.desc')} />
      {error && (
        <p className="ui-error" role="alert">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : t('errors.generic')}
        </p>
      )}
      {!crm ? (
        <EmptyState product="books" title={t('quotes.noCrmTitle')} body={t('quotes.noCrmBody')} />
      ) : quotes.length === 0 ? (
        <EmptyState product="books" title={t('quotes.emptyTitle')} body={t('quotes.emptyBody')} action={{ label: t('quotes.openCrm'), href: '/app/crm/quotes' }} />
      ) : (
        <Table head={[{ label: t('quotes.colQuote') }, { label: t('docs.colStatus') }, { label: t('docs.colTotal'), num: true }, { label: '' }]}>
          {quotes.map((q) => (
            <tr key={q.id}>
              <th scope="row">
                <span className="bk-rowtext">
                  <span className="bk-rowtitle">
                    {q.number}
                    {q.title ? ` · ${q.title}` : ''}
                  </span>
                  <span className="bk-rowmeta">{q.recipient}</span>
                </span>
              </th>
              <td>{t.has(`quotes.status.${q.status}`) ? t(`quotes.status.${q.status}`) : q.status}</td>
              <td className="num">{formatMoney(parseAmount(q.total, q.currency) ?? 0, q.currency, locale)}</td>
              <td className="num">
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy === q.id} aria-busy={busy === q.id} onClick={() => convert(q.id)}>
                  {t('quotes.convert')}
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
