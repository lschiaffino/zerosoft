'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { DocDto } from '@/lib/books-docs';
import type { AuditEntry } from '@/lib/books';
import { bpsToPercent, convert, docTotals, formatMoney, normalizeRate, percentToBps, todayIso } from '@/lib/books-money';
import { Dialog, MoneyInput, StatusBadge, api, useDate, useErrorText, useToast } from './ui';

export type DocKind = 'invoice' | 'credit_note' | 'bill';
const PATH: Record<DocKind, string> = { invoice: 'invoices', credit_note: 'credit-notes', bill: 'bills' };
const NAV: Record<DocKind, string> = { invoice: 'invoices', credit_note: 'creditNotes', bill: 'bills' };

export interface EditorRefs {
  baseCurrency: string;
  country: string;
  contacts: Array<{ id: string; name: string; email: string; currency: string | null; termsDays: number | null }>;
  items: Array<{ id: string; name: string; price: number; cost: number; taxRateId: string | null; description: string }>;
  taxes: Array<{ id: string; name: string; rate_bps: number; is_default: number }>;
  series: Array<{ id: string; name: string; doc_type: string; is_default: number }>;
  bankAccounts: Array<{ id: string; name: string }>;
  termsDays: number;
  einvoiceProvider: string | null;
}

interface LineState {
  key: number;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPrice: number | null;
  discount: string;
  taxRateId: string | null;
}

let seq = 0;
const blank = (taxRateId: string | null): LineState => ({ key: ++seq, itemId: null, description: '', quantity: '1', unitPrice: null, discount: '', taxRateId });

const CURRENCIES = ['ARS', 'MXN', 'BRL', 'CLP', 'COP', 'PEN', 'UYU', 'PYG', 'BOB', 'USD', 'EUR', 'GBP', 'CAD'];

export default function DocumentEditor({
  kind,
  doc,
  refs,
  canWrite,
  isAccountant,
  audit,
  initialContactId,
  appUrl,
}: {
  kind: DocKind;
  doc: DocDto | null;
  refs: EditorRefs;
  canWrite: boolean;
  isAccountant: boolean;
  audit: AuditEntry[];
  initialContactId?: string | null;
  appUrl: string;
}) {
  const t = useTranslations('books');
  const locale = useLocale();
  const router = useRouter();
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const editable = canWrite && (!doc || doc.status === 'draft');
  const defaultTax = refs.taxes.find((x) => x.is_default)?.id ?? null;
  const [contacts, setContacts] = useState(refs.contacts);
  const [contactId, setContactId] = useState<string>(doc?.contactId ?? initialContactId ?? '');
  const [issueDate, setIssueDate] = useState(doc?.issueDate ?? todayIso());
  const [termsDays, setTermsDays] = useState<string>(doc?.termsDays != null ? String(doc.termsDays) : kind === 'credit_note' ? '0' : String(refs.termsDays));
  const [dueDate, setDueDate] = useState(doc?.dueDate ?? '');
  const [currency, setCurrency] = useState(doc?.currency ?? refs.baseCurrency);
  const [fxRate, setFxRate] = useState(doc && doc.fxRate !== '1' ? doc.fxRate : '');
  const [seriesId, setSeriesId] = useState(doc?.seriesId ?? '');
  const [reference, setReference] = useState(doc?.reference ?? '');
  const [notes, setNotes] = useState(doc?.notes ?? '');
  const [lines, setLines] = useState<LineState[]>(() =>
    doc?.lines.length
      ? doc.lines.map((l) => ({
          key: ++seq,
          itemId: l.itemId,
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: l.unitPrice,
          discount: l.discountBps ? bpsToPercent(l.discountBps) : '',
          taxRateId: l.taxRateId,
        }))
      : [blank(defaultTax)],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [newContact, setNewContact] = useState<{ name: string; email: string; taxId: string } | null>(null);
  const [send, setSend] = useState<{ to: string; message: string } | null>(null);
  const [pay, setPay] = useState<{ amount: number | null; date: string; bankAccountId: string; method: string; reference: string; fxRate: string } | null>(null);
  const [confirm, setConfirm] = useState<'void' | 'delete' | null>(null);

  const taxBps = (id: string | null) => refs.taxes.find((x) => x.id === id)?.rate_bps ?? 0;
  const totals = useMemo(
    () =>
      docTotals(
        lines.map((l) => ({
          quantity: Number(l.quantity.replace(',', '.')) || 0,
          unitPrice: l.unitPrice ?? 0,
          discountBps: percentToBps(l.discount || '0') ?? 0,
          taxBps: taxBps(l.taxRateId),
        })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, refs.taxes],
  );
  const money = (v: number, cur = currency) => formatMoney(v, cur, locale);
  const base = `/app/books/${PATH[kind]}`;
  const seriesForKind = refs.series.filter((s) => s.doc_type === kind);

  const setLine = (key: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickItem = (key: number, itemId: string) => {
    const it = refs.items.find((i) => i.id === itemId);
    if (!it) return setLine(key, { itemId: null });
    setLine(key, { itemId: it.id, description: it.description || it.name, unitPrice: kind === 'bill' ? it.cost : it.price, taxRateId: it.taxRateId ?? defaultTax });
  };

  const body = () => ({
    docType: kind,
    contactId: contactId || null,
    issueDate,
    termsDays: termsDays === '' ? null : Number(termsDays),
    ...(dueDate ? { dueDate } : {}),
    currency,
    ...(currency !== refs.baseCurrency ? { fxRate } : {}),
    ...(kind !== 'bill' ? { seriesId: seriesId || null } : {}),
    reference,
    notes,
    lines: lines
      .filter((l) => l.description.trim() || l.itemId)
      .map((l) => ({
        itemId: l.itemId,
        description: l.description,
        quantity: Number(l.quantity.replace(',', '.')) || 0,
        unitPrice: l.unitPrice ?? 0,
        discountBps: percentToBps(l.discount || '0') ?? 0,
        taxRateId: l.taxRateId,
      })),
  });

  /** Guarda el borrador; devuelve el id (nuevo o el mismo). */
  const saveDraft = async (): Promise<string | null> => {
    const res = doc
      ? await api<{ doc?: DocDto }>(`/api/books/documents/${doc.id}`, { method: 'PATCH', json: body() })
      : await api<{ doc?: DocDto }>('/api/books/documents', { method: 'POST', json: body() });
    if (!res.ok || !res.data.doc) {
      push(errText(res.data.error), 'bad');
      return null;
    }
    return res.data.doc.id;
  };

  const onSave = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy('save');
    const id = await saveDraft();
    setBusy(null);
    if (!id) return;
    push(t('common.saved'));
    if (!doc) router.replace(`${base}/${id}`);
    else router.refresh();
  };

  const onApprove = async () => {
    setBusy('approve');
    const id = await saveDraft();
    if (!id) return setBusy(null);
    const res = await api(`/api/books/documents/${id}/approve`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) {
      push(errText(res.data.error), 'bad');
      if (!doc) router.replace(`${base}/${id}`);
      return;
    }
    push(t('editor.approved'));
    if (!doc) router.replace(`${base}/${id}`);
    else router.refresh();
  };

  const openSend = () => {
    const c = contacts.find((x) => x.id === (doc?.contactId ?? contactId));
    setSend({ to: c?.email ?? doc?.contactEmail ?? '', message: '' });
  };

  const doSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!send) return;
    setBusy('send');
    let id = doc?.id ?? null;
    if (editable) id = await saveDraft();
    if (!id) return setBusy(null);
    const res = await api(`/api/books/documents/${id}/send`, { method: 'POST', json: { to: send.to, message: send.message, locale } });
    setBusy(null);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setSend(null);
    push(t('editor.sentOk', { to: send.to }));
    if (!doc) router.replace(`${base}/${id}`);
    else router.refresh();
  };

  const action = async (path: string, json?: unknown, okMsg?: string) => {
    if (!doc) return;
    setBusy(path);
    const res = await api<{ doc?: DocDto }>(`/api/books/documents/${doc.id}/${path}`, { method: 'POST', json: json ?? {} });
    setBusy(null);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    if (okMsg) push(okMsg);
    if (path === 'credit-note' && res.data.doc) return router.push(`/app/books/credit-notes/${res.data.doc.id}`);
    router.refresh();
  };

  const doPay = async (e: FormEvent) => {
    e.preventDefault();
    if (!doc || !pay || pay.amount == null) return;
    setBusy('pay');
    const res = await api(`/api/books/documents/${doc.id}/payments`, {
      method: 'POST',
      json: { amount: pay.amount, date: pay.date, method: pay.method, reference: pay.reference, ...(pay.bankAccountId ? { bankAccountId: pay.bankAccountId } : {}), ...(pay.fxRate ? { fxRate: pay.fxRate } : {}) },
    });
    setBusy(null);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setPay(null);
    push(t('editor.paymentSaved'));
    router.refresh();
  };

  const removePayment = async (id: string) => {
    const res = await api(`/api/books/payments/${id}`, { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.refresh();
  };

  const doDelete = async () => {
    if (!doc) return;
    const res = await api(`/api/books/documents/${doc.id}`, { method: 'DELETE' });
    setConfirm(null);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.replace(base);
    router.refresh();
  };

  const createContact = async (e: FormEvent) => {
    e.preventDefault();
    if (!newContact) return;
    const res = await api<{ contact?: { id: string; name: string; email: string; currency: string | null; termsDays: number | null } }>('/api/books/contacts', {
      method: 'POST',
      json: { kind: kind === 'bill' ? 'supplier' : 'customer', name: newContact.name, email: newContact.email, taxId: newContact.taxId },
    });
    if (!res.ok || !res.data.contact) return push(errText(res.data.error), 'bad');
    const c = res.data.contact;
    setContacts((cs) => [...cs, c].sort((a, b) => a.name.localeCompare(b.name)));
    setContactId(c.id);
    setNewContact(null);
  };

  const publicLink = doc?.publicToken ? `${appUrl}/${locale}/invoice/${doc.publicToken}` : null;
  const copyLink = async () => {
    if (!publicLink) return;
    await navigator.clipboard.writeText(publicLink).catch(() => undefined);
    push(t('editor.linkCopied'));
  };

  const title = doc ? doc.reference || doc.numberLabel || t(`docs.${kind}.draftTitle`) : t(`docs.${kind}.new`);

  // ---------- Vista de un documento emitido ----------
  if (doc && !editable) {
    const open = ['sent', 'partial', 'overdue'].includes(doc.status);
    return (
      <div className="app-page ui-page bk-page">
        {toast}
        <PageHeader
          back={{ href: base, label: t(`nav.${NAV[kind]}`) }}
          title={title}
          description={[doc.reference ? doc.numberLabel : '', doc.contactName].filter(Boolean).join(' · ')}
          actions={
            <>
              <a className="btn btn-secondary" href={`/api/books/documents/${doc.id}/pdf?locale=${locale}`} target="_blank" rel="noreferrer">
                {t('editor.pdf')}
              </a>
              {canWrite && open && kind !== 'credit_note' && (
                <button type="button" className="btn btn-primary" onClick={() => setPay({ amount: doc.amountDue, date: todayIso(), bankAccountId: refs.bankAccounts[0]?.id ?? '', method: 'bank', reference: '', fxRate: '' })}>
                  {kind === 'bill' ? t('editor.recordPaymentBill') : t('editor.recordPayment')}
                </button>
              )}
            </>
          }
        />
        <div className="bk-editor">
          <div className="bk-editor-main">
            <section className="panel bk-panel">
              <div className="bk-panel-head">
                <StatusBadge status={doc.status} />
                <span className="data">{doc.numberLabel}</span>
              </div>
              <dl className="bk-meta">
                <div>
                  <dt>{kind === 'bill' ? t('editor.supplier') : t('editor.customer')}</dt>
                  <dd>{doc.contactId ? <Link href={`/app/books/contacts/${doc.contactId}`}>{doc.contactName}</Link> : '-'}</dd>
                </div>
                <div>
                  <dt>{t('editor.issueDate')}</dt>
                  <dd>{date(doc.issueDate)}</dd>
                </div>
                {doc.dueDate && kind !== 'credit_note' && (
                  <div>
                    <dt>{t('editor.dueDate')}</dt>
                    <dd>{date(doc.dueDate)}</dd>
                  </div>
                )}
                <div>
                  <dt>{t('editor.currency')}</dt>
                  <dd>
                    {doc.currency}
                    {doc.fxRate !== '1' ? ` · ${t('editor.fxRateShort', { rate: doc.fxRate, base: refs.baseCurrency })}` : ''}
                  </dd>
                </div>
                {doc.reference && (
                  <div>
                    <dt>{kind === 'bill' ? t('editor.supplierNumber') : t('editor.reference')}</dt>
                    <dd>{doc.reference}</dd>
                  </div>
                )}
              </dl>
              <DocLinesTable doc={doc} />
              {doc.notes && <p className="bk-notes">{doc.notes}</p>}
            </section>
            {doc.payments.length > 0 && (
              <section className="panel bk-panel" aria-labelledby="bk-payments">
                <h2 className="bk-panel-title" id="bk-payments">
                  {t('editor.payments')}
                </h2>
                <ul className="bk-list">
                  {doc.payments.map((p) => (
                    <li key={p.id}>
                      <span>{date(p.date)}</span>
                      <span>{t.has(`methods.${p.method}`) ? t(`methods.${p.method}`) : p.method}</span>
                      <span className="bk-ellipsis">{p.reference}</span>
                      <span className="data">{money(p.amount, doc.currency)}</span>
                      {canWrite && !p.reference.startsWith('stripe:') && !p.reference.startsWith('mp:') && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => removePayment(p.id)}>
                          {t('editor.removePayment')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {doc.creditNotes.length > 0 && (
              <section className="panel bk-panel">
                <h2 className="bk-panel-title">{t('nav.creditNotes')}</h2>
                <ul className="bk-list">
                  {doc.creditNotes.map((c) => (
                    <li key={c.id}>
                      <Link href={`/app/books/credit-notes/${c.id}`}>{c.numberLabel}</Link>
                      <StatusBadge status={c.status} />
                      <span className="data">{money(c.total, doc.currency)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <AuditTrail entries={audit} />
          </div>
          <aside className="bk-editor-side">
            <section className="panel bk-panel">
              <h2 className="bk-panel-title">{t('editor.summary')}</h2>
              <dl className="bk-totals">
                <div>
                  <dt>{t('editor.total')}</dt>
                  <dd>{money(doc.total, doc.currency)}</dd>
                </div>
                {kind !== 'credit_note' && (
                  <>
                    <div>
                      <dt>{t('editor.paid')}</dt>
                      <dd>{money(doc.paidTotal + doc.creditedTotal, doc.currency)}</dd>
                    </div>
                    <div className="bk-total-strong">
                      <dt>{t('editor.amountDue')}</dt>
                      <dd>{money(doc.amountDue, doc.currency)}</dd>
                    </div>
                  </>
                )}
              </dl>
              {doc.sentAt && <p className="ui-help">{t('editor.sentAt', { date: date(doc.sentAt, true) })}</p>}
              {doc.viewedAt && <p className="ui-help">{t('editor.viewedAt', { date: date(doc.viewedAt, true) })}</p>}
            </section>
            {canWrite && doc.status !== 'void' && (
              <section className="panel bk-panel bk-actions">
                {kind !== 'bill' && (
                  <button type="button" className="btn btn-secondary" onClick={openSend}>
                    {doc.sentAt ? t('editor.resend') : t('editor.send')}
                  </button>
                )}
                {kind === 'invoice' && (
                  <button type="button" className="btn btn-secondary" disabled={busy === 'credit-note'} onClick={() => action('credit-note')}>
                    {t('editor.creditNote')}
                  </button>
                )}
                <button type="button" className="btn btn-danger" onClick={() => setConfirm('void')}>
                  {t('editor.void')}
                </button>
              </section>
            )}
            {kind !== 'bill' && doc.status !== 'void' && (
              <section className="panel bk-panel">
                <h2 className="bk-panel-title">{t('editor.publicLink')}</h2>
                {publicLink ? (
                  <>
                    <p className="ui-help bk-break">{publicLink}</p>
                    <div className="bk-row">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={copyLink}>
                        {t('editor.copyLink')}
                      </button>
                      <a className="btn btn-ghost btn-sm" href={publicLink} target="_blank" rel="noreferrer">
                        {t('editor.openLink')}
                      </a>
                      {canWrite && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => action('link', { action: 'revoke' }, t('editor.linkRevoked'))}>
                          {t('editor.revokeLink')}
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="ui-help">{t('editor.linkOff')}</p>
                    {canWrite && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => action('link', { action: 'regenerate' }, t('editor.linkNew'))}>
                        {t('editor.newLink')}
                      </button>
                    )}
                  </>
                )}
              </section>
            )}
            {kind !== 'bill' && refs.einvoiceProvider && (
              <section className="panel bk-panel">
                <h2 className="bk-panel-title">{t('editor.einvoice')}</h2>
                <EInvoiceStatus doc={doc} />
                {isAccountant && doc.status !== 'void' && doc.einvoice.status !== 'authorized' && (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy === 'einvoice'} onClick={() => action('einvoice', {}, t('editor.einvoiceDone'))}>
                    {t('editor.einvoiceRequest')}
                  </button>
                )}
              </section>
            )}
          </aside>
        </div>

        <SendDialog send={send} setSend={setSend} onSubmit={doSend} busy={busy === 'send'} />
        <Dialog open={!!pay} title={kind === 'bill' ? t('editor.recordPaymentBill') : t('editor.recordPayment')} onClose={() => setPay(null)}>
          {pay && (
            <form onSubmit={doPay}>
              <div className="ui-modal-body">
                <label className="ui-field">
                  <span className="label">{t('editor.amount', { max: money(doc.amountDue, doc.currency) })}</span>
                  <MoneyInput value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} currency={doc.currency} label={t('editor.amountLabel')} required autoFocus />
                </label>
                <label className="ui-field">
                  <span className="label">{t('editor.paymentDate')}</span>
                  <input className="input" type="date" required value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} />
                </label>
                <label className="ui-field">
                  <span className="label">{t('editor.method')}</span>
                  <select className="select" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                    {['bank', 'cash', 'card', 'stripe', 'mercadopago', 'other'].map((m) => (
                      <option key={m} value={m}>
                        {t(`methods.${m}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {(pay.method === 'bank' || pay.method === 'card' || pay.method === 'other') && refs.bankAccounts.length > 0 && (
                  <label className="ui-field">
                    <span className="label">{t('editor.bankAccount')}</span>
                    <select className="select" value={pay.bankAccountId} onChange={(e) => setPay({ ...pay, bankAccountId: e.target.value })}>
                      {refs.bankAccounts.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {doc.currency !== refs.baseCurrency && (
                  <label className="ui-field">
                    <span className="label">{t('editor.paymentFx', { base: refs.baseCurrency, cur: doc.currency })}</span>
                    <input className="input num" inputMode="decimal" value={pay.fxRate} placeholder={doc.fxRate} onChange={(e) => setPay({ ...pay, fxRate: e.target.value })} />
                  </label>
                )}
                <label className="ui-field">
                  <span className="label">{t('editor.paymentReference')}</span>
                  <input className="input" maxLength={120} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
                </label>
              </div>
              <div className="ui-modal-foot">
                <button type="button" className="btn btn-secondary" onClick={() => setPay(null)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy === 'pay' || pay.amount == null} aria-busy={busy === 'pay'}>
                  {t('editor.savePayment')}
                </button>
              </div>
            </form>
          )}
        </Dialog>
        <ConfirmDialog
          open={confirm === 'void'}
          title={t('editor.voidTitle')}
          body={t('editor.voidBody')}
          confirmLabel={t('editor.void')}
          cancelLabel={t('common.cancel')}
          danger
          busy={busy === 'void'}
          onConfirm={() => {
            setConfirm(null);
            void action('void', {}, t('editor.voided'));
          }}
          onCancel={() => setConfirm(null)}
        />
      </div>
    );
  }

  // ---------- Borrador (o nuevo) ----------
  return (
    <div className="app-page ui-page bk-page">
      {toast}
      <PageHeader back={{ href: base, label: t(`nav.${NAV[kind]}`) }} title={title} description={doc ? t('status.draft') : t(`docs.${kind}.desc`)} />
      <form className="bk-editor" onSubmit={onSave}>
        <div className="bk-editor-main">
          <section className="panel bk-panel">
            <div className="bk-grid">
              <label className="ui-field">
                <span className="label">{kind === 'bill' ? t('editor.supplier') : t('editor.customer')}</span>
                <select
                  className="select"
                  value={contactId}
                  disabled={!editable}
                  onChange={(e) => {
                    if (e.target.value === '__new') return setNewContact({ name: '', email: '', taxId: '' });
                    setContactId(e.target.value);
                    const c = contacts.find((x) => x.id === e.target.value);
                    if (c?.currency && !doc) setCurrency(c.currency);
                    if (c?.termsDays != null && kind !== 'credit_note') setTermsDays(String(c.termsDays));
                  }}
                >
                  <option value="">{t('editor.pickContact')}</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="__new">{t('editor.newContactOption')}</option>
                </select>
              </label>
              <label className="ui-field">
                <span className="label">{kind === 'bill' ? t('editor.supplierNumber') : t('editor.reference')}</span>
                <input className="input" maxLength={120} required={kind === 'bill'} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={kind === 'bill' ? '0001-00001234' : t('editor.referencePh')} />
              </label>
              <label className="ui-field">
                <span className="label">{t('editor.issueDate')}</span>
                <input className="input" type="date" required value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </label>
              {kind !== 'credit_note' && (
                <>
                  <label className="ui-field">
                    <span className="label">{t('editor.terms')}</span>
                    <input
                      className="input num"
                      type="number"
                      min={0}
                      max={365}
                      value={termsDays}
                      onChange={(e) => {
                        setTermsDays(e.target.value);
                        setDueDate('');
                      }}
                    />
                  </label>
                  <label className="ui-field">
                    <span className="label">{t('editor.dueDate')}</span>
                    <input className="input" type="date" value={dueDate} min={issueDate} onChange={(e) => setDueDate(e.target.value)} />
                    <span className="ui-help">{t('editor.dueHelp')}</span>
                  </label>
                </>
              )}
              <label className="ui-field">
                <span className="label">{t('editor.currency')}</span>
                <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {[...new Set([refs.baseCurrency, ...CURRENCIES])].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              {currency !== refs.baseCurrency && (
                <label className="ui-field">
                  <span className="label">{t('editor.fxRate', { base: refs.baseCurrency, cur: currency })}</span>
                  <input className="input num" inputMode="decimal" required value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="1050.25" />
                  <span className="ui-help">{t('editor.fxHelp')}</span>
                </label>
              )}
              {kind !== 'bill' && seriesForKind.length > 0 && (
                <label className="ui-field">
                  <span className="label">{t('editor.series')}</span>
                  <select className="select" value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
                    <option value="">{t('editor.seriesAuto')}</option>
                    {seriesForKind.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </section>
          <section className="panel bk-panel" aria-labelledby="bk-lines">
            <h2 className="bk-panel-title" id="bk-lines">
              {t('editor.lines')}
            </h2>
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
                        <select className="select bk-cell" aria-label={t('editor.colItem')} value={l.itemId ?? ''} onChange={(e) => pickItem(l.key, e.target.value)}>
                          <option value="">{t('editor.noItem')}</option>
                          {refs.items.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td data-label={t('editor.colDescription')}>
                        <input className="input bk-cell bk-cell-wide" aria-label={t('editor.colDescription')} value={l.description} maxLength={1000} onChange={(e) => setLine(l.key, { description: e.target.value })} />
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
                      <td className="num data" data-label={t('editor.colAmount')}>{money(totals.lines[i]?.net ?? 0)}</td>
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
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, blank(defaultTax)])}>
                {t('editor.addLine')}
              </button>
            </div>
          </section>
          <section className="panel bk-panel">
            <label className="ui-field">
              <span className="label">{t('editor.notes')}</span>
              <textarea className="textarea" rows={3} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('editor.notesPh')} />
            </label>
          </section>
          {doc && <AuditTrail entries={audit} />}
        </div>
        <aside className="bk-editor-side">
          <section className="panel bk-panel">
            <h2 className="bk-panel-title">{t('editor.summary')}</h2>
            <dl className="bk-totals">
              <div>
                <dt>{t('editor.subtotal')}</dt>
                <dd>{money(totals.subtotal)}</dd>
              </div>
              {totals.discountTotal > 0 && (
                <div>
                  <dt>{t('editor.discount')}</dt>
                  <dd>-{money(totals.discountTotal)}</dd>
                </div>
              )}
              {totals.byRate
                .filter((r) => r.taxBps > 0)
                .map((r) => (
                  <div key={r.taxBps}>
                    <dt>{t('editor.taxAt', { rate: bpsToPercent(r.taxBps) })}</dt>
                    <dd>{money(r.tax)}</dd>
                  </div>
                ))}
              <div className="bk-total-strong">
                <dt>{t('editor.total')}</dt>
                <dd>{money(totals.total)}</dd>
              </div>
            </dl>
            {currency !== refs.baseCurrency && normalizeRate(fxRate) && (
              <p className="ui-help">{t('editor.inBase', { amount: formatMoney(convert(totals.total, currency, normalizeRate(fxRate)!, refs.baseCurrency), refs.baseCurrency, locale) })}</p>
            )}
          </section>
          {editable && (
            <section className="panel bk-panel bk-actions">
              <button type="submit" className="btn btn-secondary" disabled={!!busy} aria-busy={busy === 'save'}>
                {t('editor.saveDraft')}
              </button>
              <button type="button" className="btn btn-primary" disabled={!!busy} aria-busy={busy === 'approve'} onClick={onApprove}>
                {t('editor.approve')}
              </button>
              {kind !== 'bill' && (
                <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={openSend}>
                  {t('editor.approveSend')}
                </button>
              )}
              {doc && (
                <button type="button" className="btn btn-danger" onClick={() => setConfirm('delete')}>
                  {t('editor.deleteDraft')}
                </button>
              )}
              <p className="ui-help">{t('editor.approveHelp')}</p>
            </section>
          )}
        </aside>
      </form>
      <SendDialog send={send} setSend={setSend} onSubmit={doSend} busy={busy === 'send'} />
      <Dialog open={!!newContact} title={kind === 'bill' ? t('contacts.newSupplier') : t('contacts.newCustomer')} onClose={() => setNewContact(null)}>
        {newContact && (
          <form onSubmit={createContact}>
            <div className="ui-modal-body">
              <label className="ui-field">
                <span className="label">{t('contacts.name')}</span>
                <input className="input" required autoFocus maxLength={160} value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} />
              </label>
              <label className="ui-field">
                <span className="label">{t('contacts.email')}</span>
                <input className="input" type="email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} />
              </label>
              <label className="ui-field">
                <span className="label">{t('contacts.taxId')}</span>
                <input className="input data" value={newContact.taxId} onChange={(e) => setNewContact({ ...newContact, taxId: e.target.value })} />
              </label>
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setNewContact(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary">
                {t('common.create')}
              </button>
            </div>
          </form>
        )}
      </Dialog>
      <ConfirmDialog open={confirm === 'delete'} title={t('editor.deleteTitle')} body={t('editor.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} danger onConfirm={doDelete} onCancel={() => setConfirm(null)} />
    </div>
  );
}

function SendDialog({ send, setSend, onSubmit, busy }: { send: { to: string; message: string } | null; setSend: (v: { to: string; message: string } | null) => void; onSubmit: (e: FormEvent) => void; busy: boolean }) {
  const t = useTranslations('books');
  return (
    <Dialog open={!!send} title={t('editor.sendTitle')} onClose={() => setSend(null)}>
      {send && (
        <form onSubmit={onSubmit}>
          <div className="ui-modal-body">
            <label className="ui-field">
              <span className="label">{t('editor.sendTo')}</span>
              <input className="input" type="email" required autoFocus value={send.to} onChange={(e) => setSend({ ...send, to: e.target.value })} />
            </label>
            <label className="ui-field">
              <span className="label">{t('editor.sendMessage')}</span>
              <textarea className="textarea" rows={4} maxLength={2000} value={send.message} onChange={(e) => setSend({ ...send, message: e.target.value })} />
            </label>
            <p className="ui-help">{t('editor.sendHelp')}</p>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-secondary" onClick={() => setSend(null)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
              {t('editor.sendConfirm')}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function DocLinesTable({ doc }: { doc: DocDto }) {
  const t = useTranslations('books');
  const locale = useLocale();
  const money = (v: number) => formatMoney(v, doc.currency, locale);
  const anyDisc = doc.lines.some((l) => l.discountBps);
  return (
    <>
      <div className="bk-table-wrap">
        <table className="table bk-table">
          <thead>
            <tr>
              <th scope="col">{t('editor.colDescription')}</th>
              <th scope="col" className="num">
                {t('editor.colQty')}
              </th>
              <th scope="col" className="num">
                {t('editor.colPrice')}
              </th>
              {anyDisc && (
                <th scope="col" className="num">
                  {t('editor.colDiscount')}
                </th>
              )}
              <th scope="col" className="num">
                {t('editor.colTax')}
              </th>
              <th scope="col" className="num">
                {t('editor.colAmount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.id}>
                <td className="bk-break">{l.description}</td>
                <td className="num">{l.quantity}</td>
                <td className="num">{money(l.unitPrice)}</td>
                {anyDisc && <td className="num">{l.discountBps ? `${bpsToPercent(l.discountBps)}%` : ''}</td>}
                <td className="num">{bpsToPercent(l.taxBps)}%</td>
                <td className="num">{money(l.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="bk-totals bk-totals-inline">
        <div>
          <dt>{t('editor.subtotal')}</dt>
          <dd>{money(doc.subtotal)}</dd>
        </div>
        {doc.discountTotal > 0 && (
          <div>
            <dt>{t('editor.discount')}</dt>
            <dd>-{money(doc.discountTotal)}</dd>
          </div>
        )}
        {doc.taxBreakdown
          .filter((r) => r.taxBps > 0)
          .map((r) => (
            <div key={r.taxBps}>
              <dt>{t('editor.taxAt', { rate: bpsToPercent(r.taxBps) })}</dt>
              <dd>{money(r.tax)}</dd>
            </div>
          ))}
        <div className="bk-total-strong">
          <dt>{t('editor.total')}</dt>
          <dd>{money(doc.total)}</dd>
        </div>
      </dl>
    </>
  );
}

function EInvoiceStatus({ doc }: { doc: DocDto }) {
  const t = useTranslations('books');
  const e = doc.einvoice;
  const data = e.data as { code?: string; expiresAt?: string; test?: boolean; errors?: Array<{ code: string; message: string }>; error?: string };
  if (!e.status) return <p className="ui-help">{t('editor.einvoiceNone')}</p>;
  if (e.status === 'authorized')
    return (
      <p className="ui-help">
        {t('editor.einvoiceAuthorized', { code: data.code ?? '', date: data.expiresAt ?? '' })}
        {data.test ? ` ${t('editor.einvoiceTest')}` : ''}
      </p>
    );
  if (e.status === 'rejected')
    return (
      <ul className="ui-error">
        {(data.errors ?? []).map((x) => (
          <li key={x.code}>
            {x.code}: {x.message}
          </li>
        ))}
      </ul>
    );
  if (e.status === 'error') return <p className="ui-error">{t.has(`errors.${data.error}`) ? t(`errors.${data.error}`) : t('errors.generic')}</p>;
  return <p className="ui-help">{t('editor.einvoicePending')}</p>;
}

export function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  const t = useTranslations('books');
  const date = useDate();
  if (!entries.length) return null;
  return (
    <section className="panel bk-panel" aria-labelledby="bk-audit">
      <h2 className="bk-panel-title" id="bk-audit">
        {t('editor.history')}
      </h2>
      <ol className="bk-timeline">
        {entries.map((a) => (
          <li key={a.id}>
            <span>{t.has(`audit.${a.action.replace(/\./g, '_')}`) ? t(`audit.${a.action.replace(/\./g, '_')}`) : a.action}</span>
            <span className="bk-rowmeta">
              {a.personName ?? t('audit.system')} · {date(a.createdAt, true)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

