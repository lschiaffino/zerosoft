import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ensureBooks } from '@/lib/books';
import { getDocument, getPublicDocRow, markViewed } from '@/lib/books-docs';
import { onlineMethods, reconcileStripeReturn } from '@/lib/books-payments';
import { bpsToPercent, formatMoney } from '@/lib/books-money';
import PublicInvoiceActions from '@/components/books/PublicInvoiceActions';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; zs: string[] }>; searchParams: Promise<{ return?: string; session_id?: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, zs } = await props.params;
  const t = await getTranslations({ locale, namespace: 'books.public' });
  const row = zs.length === 1 ? await getPublicDocRow(zs[0]) : null;
  return {
    title: row ? `${row.number_label}` : t('notFound'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

/** Factura o nota de crédito enviada a un cliente: se lee, se descarga, se imprime y (si tiene saldo) se paga sin login. */
export default async function PublicInvoicePage(props: Props) {
  const { locale, zs } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  if (zs.length !== 1) notFound();
  const token = zs[0];
  let row = await getPublicDocRow(token);
  if (!row) notFound();
  // Vuelta de Stripe Checkout: confirma el pago aunque el webhook no haya llegado.
  if (sp.return === '1' && sp.session_id) {
    await reconcileStripeReturn(token, sp.session_id).catch(() => false);
    row = (await getPublicDocRow(token)) ?? row;
  }
  await markViewed(row).catch(() => undefined);
  const doc = await getDocument(row.workspace_id, row.id);
  if (!doc) notFound();
  const s = await ensureBooks(row.workspace_id);
  const t = await getTranslations({ locale, namespace: 'books.public' });
  const money = (v: number) => formatMoney(v, doc.currency, locale);
  const tag = locale === 'es' ? 'es-AR' : locale === 'pt' ? 'pt-BR' : 'en-US';
  const fmtDate = (d: string) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  const payable = doc.docType === 'invoice' && ['sent', 'partial', 'overdue'].includes(doc.status) && doc.amountDue > 0;
  const methods = payable ? onlineMethods(s) : [];
  const company = s.trade_name || s.legal_name;
  const anyDisc = doc.lines.some((l) => l.discountBps);
  const accent = /^#[0-9a-fA-F]{6}$/.test(s.brand_color) ? s.brand_color : '#1e3a8a';
  return (
    <main className="bk-public" style={{ ['--bk-brand' as string]: accent }}>
      <article className="bk-public-doc" aria-labelledby="bk-public-title">
        <header className="bk-public-head">
          <div>
            {s.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="bk-public-logo" src={s.logo_url} alt={company} />
            ) : (
              <p className="bk-public-company">{company}</p>
            )}
            <p className="bk-public-muted">
              {[s.legal_name, s.tax_id, s.address, s.email].filter(Boolean).map((x) => (
                <span key={x}>
                  {x}
                  <br />
                </span>
              ))}
            </p>
          </div>
          <div className="bk-public-title-box">
            <h1 id="bk-public-title" className="bk-public-title">
              {doc.docType === 'credit_note' ? t('creditNote') : t('invoice')}
            </h1>
            <p className="bk-public-number">{doc.numberLabel}</p>
            {doc.status === 'paid' && <p className="bk-public-stamp" data-status="paid">{t('paid')}</p>}
            {doc.status === 'overdue' && <p className="bk-public-stamp" data-status="overdue">{t('overdue')}</p>}
            {doc.status === 'void' && <p className="bk-public-stamp" data-status="void">{t('void')}</p>}
          </div>
        </header>
        <section className="bk-public-parties">
          <div>
            <h2 className="bk-public-label">{t('billTo')}</h2>
            <p>
              {doc.contactName}
              {doc.contactEmail && (
                <>
                  <br />
                  <span className="bk-public-muted">{doc.contactEmail}</span>
                </>
              )}
            </p>
          </div>
          <dl className="bk-public-dates">
            <div>
              <dt>{t('issued')}</dt>
              <dd>{fmtDate(doc.issueDate)}</dd>
            </div>
            {doc.dueDate && doc.docType === 'invoice' && (
              <div>
                <dt>{t('due')}</dt>
                <dd>{fmtDate(doc.dueDate)}</dd>
              </div>
            )}
            {doc.reference && (
              <div>
                <dt>{t('reference')}</dt>
                <dd>{doc.reference}</dd>
              </div>
            )}
          </dl>
        </section>
        <div className="bk-public-table">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('description')}</th>
                <th scope="col" className="num">
                  {t('qty')}
                </th>
                <th scope="col" className="num">
                  {t('price')}
                </th>
                {anyDisc && (
                  <th scope="col" className="num">
                    {t('discount')}
                  </th>
                )}
                <th scope="col" className="num">
                  {t('amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.description}
                    {l.taxBps ? <span className="bk-public-muted"> · {t('taxAt', { rate: bpsToPercent(l.taxBps) })}</span> : null}
                  </td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{money(l.unitPrice)}</td>
                  {anyDisc && <td className="num">{l.discountBps ? `${bpsToPercent(l.discountBps)}%` : ''}</td>}
                  <td className="num">{money(l.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="bk-public-totals">
          <div>
            <dt>{t('subtotal')}</dt>
            <dd>{money(doc.subtotal - doc.discountTotal)}</dd>
          </div>
          {doc.taxBreakdown
            .filter((r) => r.taxBps > 0)
            .map((r) => (
              <div key={r.taxBps}>
                <dt>{t('taxAt', { rate: bpsToPercent(r.taxBps) })}</dt>
                <dd>{money(r.tax)}</dd>
              </div>
            ))}
          <div className="bk-public-total">
            <dt>{t('total')}</dt>
            <dd>{money(doc.total)}</dd>
          </div>
          {doc.docType === 'invoice' && doc.paidTotal + doc.creditedTotal > 0 && doc.status !== 'void' && (
            <>
              <div>
                <dt>{t('paidSoFar')}</dt>
                <dd>{money(doc.paidTotal + doc.creditedTotal)}</dd>
              </div>
              <div className="bk-public-total">
                <dt>{t('balance')}</dt>
                <dd>{money(doc.amountDue)}</dd>
              </div>
            </>
          )}
        </dl>
        {doc.notes && <p className="bk-public-notes">{doc.notes}</p>}
        {doc.einvoice.status === 'authorized' && (
          <p className="bk-public-muted">
            {t('authorization', { code: String((doc.einvoice.data as { code?: string }).code ?? '') })}
            {(doc.einvoice.data as { test?: boolean }).test ? ` · ${t('testAuthorization')}` : ''}
          </p>
        )}
        {s.footer && <p className="bk-public-muted bk-public-footer">{s.footer}</p>}
      </article>
      <PublicInvoiceActions token={token} methods={methods} amount={payable ? money(doc.amountDue) : null} justPaid={sp.return === '1'} paid={doc.status === 'paid'} />
    </main>
  );
}
