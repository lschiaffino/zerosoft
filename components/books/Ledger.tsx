'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { BankAccountDto, BankTxnDto, MatchCandidate } from '@/lib/books-bank';
import type { AccountRow } from '@/lib/books';
import type { JournalDto } from '@/lib/books-ledger';
import { formatMoney, todayIso } from '@/lib/books-money';
import { Dialog, MoneyInput, StatusBadge, api, useDate, useErrorText, useToast } from './ui';

// ---------- Bancos ----------

export function BankAccountNew({ currency }: { currency: string }) {
  const t = useTranslations('books');
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [f, setF] = useState({ name: '', bankName: '', last4: '' });
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await api<{ account?: BankAccountDto }>('/api/books/bank-accounts', { method: 'POST', json: { ...f, currency } });
    setBusy(false);
    if (!res.ok || !res.data.account) return push(errText(res.data.error), 'bad');
    router.replace(`/app/books/banking/${res.data.account.id}`);
  };
  return (
    <div className="app-page ui-page bk-page bk-narrow">
      {toast}
      <PageHeader back={{ href: '/app/books/banking', label: t('nav.banking') }} title={t('banking.new')} />
      <form className="panel bk-panel" onSubmit={save}>
        <label className="ui-field">
          <span className="label">{t('banking.name')}</span>
          <input className="input" required autoFocus maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('banking.namePh')} />
        </label>
        <label className="ui-field">
          <span className="label">{t('banking.bankName')}</span>
          <input className="input" maxLength={120} value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} />
        </label>
        <label className="ui-field">
          <span className="label">{t('banking.last4')}</span>
          <input className="input data" inputMode="numeric" maxLength={4} value={f.last4} onChange={(e) => setF({ ...f, last4: e.target.value })} />
        </label>
        <p className="ui-help">{t('banking.currencyNote', { currency })}</p>
        <div className="bk-row">
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
            {t('common.create')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function BankAccountView({
  account,
  transactions,
  suggestions,
  accounts,
  canWrite,
  status,
}: {
  account: BankAccountDto;
  transactions: BankTxnDto[];
  suggestions: Record<string, MatchCandidate[]>;
  accounts: Array<{ id: string; code: string; name: string }>;
  canWrite: boolean;
  status: string;
}) {
  const t = useTranslations('books');
  const locale = useLocale();
  const router = useRouter();
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [categorize, setCategorize] = useState<{ txn: BankTxnDto; accountId: string; description: string } | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const money = (v: number, cur = account.currency) => formatMoney(v, cur, locale);

  const upload = async (file: File) => {
    setBusy('import');
    const form = new FormData();
    form.set('file', file);
    const res = await api<{ imported?: number; duplicates?: number; errors?: Array<{ row: number; error: string }> }>(`/api/books/bank-accounts/${account.id}/import`, { method: 'POST', body: form });
    setBusy(null);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(t('banking.imported', { n: res.data.imported ?? 0, dup: res.data.duplicates ?? 0, err: res.data.errors?.length ?? 0 }), res.data.errors?.length ? 'bad' : 'ok');
    router.refresh();
  };

  const reconcile = async (txnId: string, json: Record<string, unknown>) => {
    setBusy(txnId);
    const res = await api(`/api/books/bank-transactions/${txnId}/reconcile`, { method: 'POST', json });
    setBusy(null);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(t('banking.matched'));
    router.refresh();
  };

  const undo = async (txnId: string) => {
    setBusy(txnId);
    const res = await api(`/api/books/bank-transactions/${txnId}/unreconcile`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.refresh();
  };

  const doCategorize = async (e: FormEvent) => {
    e.preventDefault();
    if (!categorize) return;
    await reconcile(categorize.txn.id, { kind: 'account', accountId: categorize.accountId, description: categorize.description });
    setCategorize(null);
  };

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    const res = await api(`/api/books/bank-accounts/${account.id}`, { method: 'PATCH', json: { name: rename } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setRename(null);
    router.refresh();
  };

  const remove = async () => {
    const res = await api(`/api/books/bank-accounts/${account.id}`, { method: 'DELETE' });
    setConfirm(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.replace('/app/books/banking');
    router.refresh();
  };

  const statuses = ['', 'unmatched', 'matched', 'ignored'];
  return (
    <div className="app-page ui-page bk-page">
      {toast}
      <PageHeader
        back={{ href: '/app/books/banking', label: t('nav.banking') }}
        title={account.name}
        description={[account.bankName, account.last4 ? `···${account.last4}` : ''].filter(Boolean).join(' ')}
        actions={
          canWrite ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setRename(account.name)}>
                {t('common.rename')}
              </button>
              <label className="btn btn-primary bk-file">
                {busy === 'import' ? t('common.loading') : t('banking.import')}
                <input
                  type="file"
                  className="sr-only"
                  accept=".csv,.ofx,.qfx,text/csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </>
          ) : undefined
        }
      />
      <div className="bk-kpis">
        <div className="bk-kpi">
          <span className="bk-kpi-label">{t('banking.bookBalance')}</span>
          <span className="bk-kpi-value bk-kpi-small">{money(account.balance)}</span>
        </div>
        <div className="bk-kpi">
          <span className="bk-kpi-label">{t('banking.statementBalance')}</span>
          <span className="bk-kpi-value bk-kpi-small">{money(account.statementBalance)}</span>
        </div>
        <div className="bk-kpi">
          <span className="bk-kpi-label">{t('banking.toReconcile')}</span>
          <span className="bk-kpi-value bk-kpi-small">{account.unmatched}</span>
        </div>
      </div>
      <p className="ui-help bk-note">{t('banking.importHelp')}</p>
      <div className="ui-tabs bk-filter" role="tablist" aria-label={t('docs.filter')}>
        {statuses.map((s) => (
          <Link key={s || 'all'} role="tab" aria-selected={status === s} className="ui-tab" href={`/app/books/banking/${account.id}${s ? `?status=${s}` : ''}`}>
            {s ? t(`status.${s}`) : t('common.all')}
          </Link>
        ))}
      </div>
      {transactions.length === 0 ? (
        status ? (
          <EmptyState compact body={t('common.noMatch')} />
        ) : (
          <EmptyState product="books" title={t('banking.noTxnsTitle')} body={t('banking.noTxnsBody')} />
        )
      ) : (
        <ul className="bk-txns">
          {transactions.map((x) => {
            const sugg = suggestions[x.id] ?? [];
            return (
              <li key={x.id} className="bk-txn" data-status={x.status}>
                <div className="bk-txn-main">
                  <span className="bk-rowmeta">{date(x.date)}</span>
                  <span className="bk-break">{x.description || '-'}</span>
                  <span className={`data bk-amount${x.amount < 0 ? ' bk-neg' : ''}`}>{money(x.amount)}</span>
                  <StatusBadge status={x.status} />
                </div>
                {x.status !== 'unmatched' ? (
                  <div className="bk-txn-actions">
                    {x.matchLabel && <span className="bk-rowmeta">{t('banking.matchedTo', { what: x.matchLabel })}</span>}
                    {canWrite && (
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy === x.id} onClick={() => undo(x.id)}>
                        {t('banking.undo')}
                      </button>
                    )}
                  </div>
                ) : (
                  canWrite && (
                    <div className="bk-txn-actions">
                      {sugg.map((c) => (
                        <button
                          key={`${c.kind}:${c.id}`}
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busy === x.id}
                          onClick={() => reconcile(x.id, c.kind === 'payment' ? { kind: 'payment', paymentId: c.id } : { kind: c.kind, docId: c.docId })}
                        >
                          {t(c.kind === 'payment' ? 'banking.matchPayment' : c.kind === 'bill' ? 'banking.matchBill' : 'banking.matchInvoice', { label: c.label, contact: c.contactName || '-' })}
                        </button>
                      ))}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCategorize({ txn: x, accountId: '', description: x.description })}>
                        {t('banking.categorize')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy === x.id} onClick={() => reconcile(x.id, { kind: 'ignore' })}>
                        {t('banking.ignore')}
                      </button>
                    </div>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canWrite && (
        <div className="bk-row bk-foot">
          <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setConfirm(true)}>
            {t('banking.delete')}
          </button>
        </div>
      )}
      <Dialog open={!!categorize} title={t('banking.categorize')} onClose={() => setCategorize(null)}>
        {categorize && (
          <form onSubmit={doCategorize}>
            <div className="ui-modal-body">
              <p>
                {categorize.txn.description} · <span className="data">{money(categorize.txn.amount)}</span>
              </p>
              <label className="ui-field">
                <span className="label">{t('banking.account')}</span>
                <select className="select" required autoFocus value={categorize.accountId} onChange={(e) => setCategorize({ ...categorize, accountId: e.target.value })}>
                  <option value="">{t('banking.pickAccount')}</option>
                  {accounts
                    .filter((a) => a.id !== account.accountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="ui-field">
                <span className="label">{t('banking.memo')}</span>
                <input className="input" maxLength={200} value={categorize.description} onChange={(e) => setCategorize({ ...categorize, description: e.target.value })} />
              </label>
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setCategorize(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={!categorize.accountId}>
                {t('banking.register')}
              </button>
            </div>
          </form>
        )}
      </Dialog>
      <Dialog open={rename != null} title={t('common.rename')} onClose={() => setRename(null)}>
        {rename != null && (
          <form onSubmit={saveName}>
            <div className="ui-modal-body">
              <label className="ui-field">
                <span className="label">{t('banking.name')}</span>
                <input className="input" required autoFocus maxLength={120} value={rename} onChange={(e) => setRename(e.target.value)} />
              </label>
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setRename(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary">
                {t('common.save')}
              </button>
            </div>
          </form>
        )}
      </Dialog>
      <ConfirmDialog open={confirm} title={t('banking.deleteTitle')} body={t('banking.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} danger onConfirm={remove} onCancel={() => setConfirm(false)} />
    </div>
  );
}

// ---------- Plan de cuentas ----------

const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;

export function AccountsView({ accounts, canWrite, showArchived }: { accounts: AccountRow[]; canWrite: boolean; showArchived: boolean }) {
  const t = useTranslations('books');
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [edit, setEdit] = useState<{ id?: string; code: string; name: string; type: string } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    const res = edit.id
      ? await api(`/api/books/accounts/${edit.id}`, { method: 'PATCH', json: { code: edit.code, name: edit.name } })
      : await api('/api/books/accounts', { method: 'POST', json: { code: edit.code, name: edit.name, type: edit.type } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setEdit(null);
    router.refresh();
  };

  const archive = async (a: AccountRow) => {
    const res = await api(`/api/books/accounts/${a.id}`, { method: 'PATCH', json: { archived: !a.archived } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.refresh();
  };

  return (
    <div className="app-page ui-page bk-page">
      {toast}
      <PageHeader
        title={t('nav.accounts')}
        description={t('accounts.desc')}
        actions={
          canWrite ? (
            <button type="button" className="btn btn-primary" onClick={() => setEdit({ code: '', name: '', type: 'expense' })}>
              {t('accounts.new')}
            </button>
          ) : undefined
        }
      />
      <div className="bk-toolbar">
        <Link className="btn btn-ghost btn-sm" href={showArchived ? '/app/books/accounts' : '/app/books/accounts?archived=1'}>
          {showArchived ? t('accounts.hideArchived') : t('accounts.showArchived')}
        </Link>
      </div>
      {TYPES.map((type) => {
        const list = accounts.filter((a) => a.type === type);
        if (!list.length) return null;
        return (
          <section key={type} className="bk-section" aria-labelledby={`bk-acc-${type}`}>
            <h2 className="bk-panel-title" id={`bk-acc-${type}`}>
              {t(`accounts.types.${type}`)}
            </h2>
            <div className="table-wrap bk-table-wrap">
              <table className="table bk-table">
                <tbody>
                  {list.map((a) => (
                    <tr key={a.id} data-archived={a.archived ? '' : undefined}>
                      <td className="data bk-code">{a.code}</td>
                      <th scope="row">
                        <Link href={`/app/books/journal?account=${a.id}`} className="bk-rowtext">
                          <span className="bk-rowtitle">{a.name}</span>
                          {a.system_key && <span className="bk-rowmeta">{t('accounts.system')}</span>}
                        </Link>
                      </th>
                      <td className="num">
                        {canWrite && (
                          <span className="bk-row bk-row-end">
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit({ id: a.id, code: a.code, name: a.name, type: a.type })}>
                              {t('common.rename')}
                            </button>
                            {!a.system_key && (
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => archive(a)}>
                                {a.archived ? t('accounts.restore') : t('accounts.archive')}
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      <Dialog open={!!edit} title={edit?.id ? t('accounts.edit') : t('accounts.new')} onClose={() => setEdit(null)}>
        {edit && (
          <form onSubmit={save}>
            <div className="ui-modal-body">
              <label className="ui-field">
                <span className="label">{t('accounts.code')}</span>
                <input className="input data" required autoFocus maxLength={20} value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} />
              </label>
              <label className="ui-field">
                <span className="label">{t('accounts.name')}</span>
                <input className="input" required maxLength={120} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </label>
              {!edit.id && (
                <label className="ui-field">
                  <span className="label">{t('accounts.type')}</span>
                  <select className="select" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
                    {TYPES.map((x) => (
                      <option key={x} value={x}>
                        {t(`accounts.types.${x}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setEdit(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary">
                {t('common.save')}
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}

// ---------- Libro diario ----------

export function JournalList({ journals, currency, canWrite, accountName }: { journals: Array<Omit<JournalDto, 'lines'>>; currency: string; canWrite: boolean; accountName: string | null }) {
  const t = useTranslations('books');
  const locale = useLocale();
  const date = useDate();
  return (
    <div className="app-page ui-page bk-page">
      <PageHeader
        title={t('nav.journal')}
        description={accountName ? t('journal.forAccount', { account: accountName }) : t('journal.desc')}
        actions={
          canWrite ? (
            <Link className="btn btn-primary" href="/app/books/journal/new">
              {t('journal.new')}
            </Link>
          ) : undefined
        }
      />
      {journals.length === 0 ? (
        <EmptyState product="books" title={t('journal.emptyTitle')} body={t('journal.emptyBody')} />
      ) : (
        <div className="table-wrap bk-table-wrap">
          <table className="table bk-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{t('journal.memo')}</th>
                <th scope="col" className="bk-hide-sm">
                  {t('journal.source')}
                </th>
                <th scope="col" className="num">
                  {t('journal.amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {journals.map((j) => (
                <tr key={j.id}>
                  <td className="data">
                    <Link href={`/app/books/journal/${j.id}`}>{j.number}</Link>
                  </td>
                  <th scope="row">
                    <Link href={`/app/books/journal/${j.id}`} className="bk-rowtext">
                      <span className="bk-rowtitle">{j.memo || '-'}</span>
                      <span className="bk-rowmeta">{date(j.date)}</span>
                    </Link>
                  </th>
                  <td className="bk-hide-sm">{t.has(`journal.sources.${j.sourceType}`) ? t(`journal.sources.${j.sourceType}`) : j.sourceType}</td>
                  <td className="num">{formatMoney(j.total, currency, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface JLine {
  key: number;
  accountId: string;
  debit: number | null;
  credit: number | null;
  description: string;
}
let jSeq = 0;

export function JournalNew({ accounts, currency, lockDate }: { accounts: Array<{ id: string; code: string; name: string }>; currency: string; lockDate: string | null }) {
  const t = useTranslations('books');
  const locale = useLocale();
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [date, setDate] = useState(todayIso());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<JLine[]>([
    { key: ++jSeq, accountId: '', debit: null, credit: null, description: '' },
    { key: ++jSeq, accountId: '', debit: null, credit: null, description: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const debit = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
  const credit = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
  const balanced = debit === credit && debit > 0 && lines.filter((l) => l.accountId && ((l.debit ?? 0) || (l.credit ?? 0))).length >= 2;
  const setLine = (key: number, p: Partial<JLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!balanced) return;
    setBusy(true);
    const res = await api<{ journal?: JournalDto }>('/api/books/journals', {
      method: 'POST',
      json: { date, memo, lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, debit: l.debit ?? 0, credit: l.credit ?? 0, description: l.description })) },
    });
    setBusy(false);
    if (!res.ok || !res.data.journal) return push(errText(res.data.error), 'bad');
    router.replace(`/app/books/journal/${res.data.journal.id}`);
  };

  return (
    <div className="app-page ui-page bk-page">
      {toast}
      <PageHeader back={{ href: '/app/books/journal', label: t('nav.journal') }} title={t('journal.new')} description={t('journal.newDesc')} />
      <form className="panel bk-panel" onSubmit={save}>
        <div className="bk-grid">
          <label className="ui-field">
            <span className="label">{t('journal.date')}</span>
            <input className="input" type="date" required value={date} min={lockDate ?? undefined} onChange={(e) => setDate(e.target.value)} />
            {lockDate && <span className="ui-help">{t('journal.lockHelp', { date: lockDate })}</span>}
          </label>
          <label className="ui-field">
            <span className="label">{t('journal.memo')}</span>
            <input className="input" maxLength={300} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </label>
        </div>
        <div className="bk-table-wrap">
          <table className="table bk-table bk-lines">
            <thead>
              <tr>
                <th scope="col">{t('journal.account')}</th>
                <th scope="col">{t('editor.colDescription')}</th>
                <th scope="col" className="num">
                  {t('journal.debit')}
                </th>
                <th scope="col" className="num">
                  {t('journal.credit')}
                </th>
                <th scope="col">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td>
                    <select className="select bk-cell" aria-label={t('journal.account')} value={l.accountId} onChange={(e) => setLine(l.key, { accountId: e.target.value })}>
                      <option value="">{t('banking.pickAccount')}</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="input bk-cell bk-cell-wide" aria-label={t('editor.colDescription')} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} />
                  </td>
                  <td>
                    <MoneyInput value={l.debit} onChange={(v) => setLine(l.key, { debit: v, ...(v ? { credit: null } : {}) })} currency={currency} label={t('journal.debit')} />
                  </td>
                  <td>
                    <MoneyInput value={l.credit} onChange={(v) => setLine(l.key, { credit: v, ...(v ? { debit: null } : {}) })} currency={currency} label={t('journal.credit')} />
                  </td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={t('editor.removeLine')} disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  {t('journal.totals')}
                </th>
                <td className="num data">{formatMoney(debit, currency, locale)}</td>
                <td className="num data">{formatMoney(credit, currency, locale)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="bk-row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, { key: ++jSeq, accountId: '', debit: null, credit: null, description: '' }])}>
            {t('editor.addLine')}
          </button>
        </div>
        <p className={balanced ? 'ui-help' : 'ui-error'} role="status">
          {balanced ? t('journal.balanced') : t('journal.unbalanced', { diff: formatMoney(Math.abs(debit - credit), currency, locale) })}
        </p>
        <div className="bk-row">
          <button type="submit" className="btn btn-primary" disabled={!balanced || busy} aria-busy={busy}>
            {t('journal.post')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function JournalView({ journal, currency, canWrite }: { journal: JournalDto; currency: string; canWrite: boolean }) {
  const t = useTranslations('books');
  const locale = useLocale();
  const router = useRouter();
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [confirm, setConfirm] = useState(false);
  const reverse = async () => {
    setConfirm(false);
    const res = await api<{ journal?: JournalDto }>(`/api/books/journals/${journal.id}/reverse`, { method: 'POST', json: {} });
    if (!res.ok || !res.data.journal) return push(errText(res.data.error), 'bad');
    router.push(`/app/books/journal/${res.data.journal.id}`);
  };
  const sourceHref =
    journal.sourceId && ['invoice', 'credit_note', 'bill'].includes(journal.sourceType)
      ? `/app/books/${journal.sourceType === 'bill' ? 'bills' : journal.sourceType === 'credit_note' ? 'credit-notes' : 'invoices'}/${journal.sourceId}`
      : journal.sourceId && journal.sourceType === 'expense'
        ? `/app/books/expenses/${journal.sourceId}`
        : null;
  return (
    <div className="app-page ui-page bk-page">
      {toast}
      <PageHeader
        back={{ href: '/app/books/journal', label: t('nav.journal') }}
        title={t('journal.title', { n: journal.number })}
        description={`${date(journal.date)} · ${t.has(`journal.sources.${journal.sourceType}`) ? t(`journal.sources.${journal.sourceType}`) : journal.sourceType}`}
        actions={
          canWrite && journal.sourceType === 'manual' && !journal.reversedBy ? (
            <button type="button" className="btn btn-secondary" onClick={() => setConfirm(true)}>
              {t('journal.reverse')}
            </button>
          ) : undefined
        }
      />
      <section className="panel bk-panel">
        {journal.memo && <p>{journal.memo}</p>}
        <div className="bk-table-wrap">
          <table className="table bk-table">
            <thead>
              <tr>
                <th scope="col">{t('journal.account')}</th>
                <th scope="col" className="bk-hide-sm">
                  {t('editor.colDescription')}
                </th>
                <th scope="col" className="num">
                  {t('journal.debit')}
                </th>
                <th scope="col" className="num">
                  {t('journal.credit')}
                </th>
              </tr>
            </thead>
            <tbody>
              {journal.lines.map((l) => (
                <tr key={l.id}>
                  <th scope="row">
                    <span className="data">{l.accountCode}</span> {l.accountName}
                  </th>
                  <td className="bk-hide-sm">{l.description}</td>
                  <td className="num">{l.debit ? formatMoney(l.debit, currency, locale) : ''}</td>
                  <td className="num">{l.credit ? formatMoney(l.credit, currency, locale) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t('journal.totals')}</th>
                <td className="bk-hide-sm" />
                <td className="num data">{formatMoney(journal.total, currency, locale)}</td>
                <td className="num data">{formatMoney(journal.total, currency, locale)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <ul className="bk-list">
          {sourceHref && (
            <li>
              <Link href={sourceHref}>{t('journal.openSource')}</Link>
            </li>
          )}
          {journal.reversalOf && (
            <li>
              <Link href={`/app/books/journal/${journal.reversalOf}`}>{t('journal.reversalOf')}</Link>
            </li>
          )}
          {journal.reversedBy && (
            <li>
              <Link href={`/app/books/journal/${journal.reversedBy}`}>{t('journal.reversedBy')}</Link>
            </li>
          )}
        </ul>
        <p className="ui-help">{t('journal.immutable')}</p>
      </section>
      <ConfirmDialog open={confirm} title={t('journal.reverseTitle')} body={t('journal.reverseBody')} confirmLabel={t('journal.reverse')} cancelLabel={t('common.cancel')} onConfirm={reverse} onCancel={() => setConfirm(false)} />
    </div>
  );
}
