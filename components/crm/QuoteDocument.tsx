import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/crm-money';
import type { PublicQuote } from '@/lib/crm-products';

interface QuoteDocumentProps {
  quote: PublicQuote;
  locale: string;
}

function fmtDay(d: string | null, locale: string): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${d.slice(0, 10)}T00:00:00Z`),
  );
}

function fmtTime(d: string | null, locale: string): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
    new Date(`${d.replace(' ', 'T')}Z`),
  );
}

/**
 * El quote como documento (app y página pública /q/<token>). Mismo markup en
 * pantalla e impresión; styles/quote.css define el @media print.
 */
export default function QuoteDocument({ quote, locale }: QuoteDocumentProps) {
  const t = useTranslations('crm');
  const money = (n: number) => formatMoney(n, quote.currency, locale, true);
  const hasDiscount = quote.items.some((i) => i.discount_pct > 0);
  const hasTax = quote.items.some((i) => i.tax_pct > 0);

  return (
    <article className="qd" aria-label={`${t('quotePublic.quote')} ${quote.number}`}>
      <header className="qd-head">
        <div className="qd-from">
          {quote.sender_company && <p className="qd-company">{quote.sender_company}</p>}
          {quote.sender_name && <p>{quote.sender_name}</p>}
          {quote.sender_email && <p className="mono qd-dim">{quote.sender_email}</p>}
        </div>
        <div className="qd-meta">
          <p className="qd-kind mono">{t('quotePublic.quote')}</p>
          <p className="mono qd-number">{quote.number}</p>
          <dl>
            <dt>{t('quotePublic.issued')}</dt>
            <dd className="mono">{fmtDay(quote.sent_at ?? quote.created_at, locale)}</dd>
            <dt>{t('quotePublic.validUntil')}</dt>
            <dd className="mono">{fmtDay(quote.expires_at, locale)}</dd>
          </dl>
        </div>
      </header>

      <section className="qd-to">
        <p className="qd-label mono">{t('quotePublic.preparedFor')}</p>
        {quote.recipient_company && <p className="qd-company">{quote.recipient_company}</p>}
        {quote.recipient_name && <p>{quote.recipient_name}</p>}
        {quote.recipient_email && <p className="mono qd-dim">{quote.recipient_email}</p>}
      </section>

      <h1 className="qd-title">{quote.title}</h1>

      <table className="qd-items">
        <thead>
          <tr>
            <th>{t('lineItems.item')}</th>
            <th className="num">{t('lineItems.qty')}</th>
            <th className="num">{t('lineItems.unitPrice')}</th>
            {hasDiscount && <th className="num">{t('lineItems.discount')}</th>}
            {hasTax && <th className="num">{t('lineItems.tax')}</th>}
            <th className="num">{t('lineItems.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {quote.items.map((item, i) => (
            <tr key={i}>
              <td>
                <span className="qd-item-name">{item.name}</span>
                {item.recurring !== 'none' && (
                  <span className="qd-dim"> · {t(`enums.recurring.${item.recurring}`)}</span>
                )}
                {item.sku && <span className="mono qd-dim qd-sku">{item.sku}</span>}
                {item.description && <span className="qd-desc">{item.description}</span>}
              </td>
              <td className="num mono">{item.quantity}</td>
              <td className="num mono">{money(item.unit_price)}</td>
              {hasDiscount && <td className="num mono">{item.discount_pct ? `${item.discount_pct}%` : '—'}</td>}
              {hasTax && <td className="num mono">{item.tax_pct ? `${item.tax_pct}%` : '—'}</td>}
              <td className="num mono">{money(item.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="qd-totals">
        <dt>{t('lineItems.subtotal')}</dt>
        <dd className="mono">{money(quote.subtotal)}</dd>
        {quote.discount_total > 0 && (
          <>
            <dt>{t('lineItems.discount')}</dt>
            <dd className="mono">−{money(quote.discount_total)}</dd>
          </>
        )}
        {quote.tax_total > 0 && (
          <>
            <dt>{t('lineItems.tax')}</dt>
            <dd className="mono">{money(quote.tax_total)}</dd>
          </>
        )}
        <dt className="qd-grand">{t('lineItems.total')}</dt>
        <dd className="mono qd-grand">{money(quote.total)}</dd>
      </dl>

      {quote.notes && (
        <section className="qd-block">
          <p className="qd-label mono">{t('quotes.form.notes')}</p>
          <p className="qd-text">{quote.notes}</p>
        </section>
      )}
      {quote.terms && (
        <section className="qd-block">
          <p className="qd-label mono">{t('quotes.form.terms')}</p>
          <p className="qd-text">{quote.terms}</p>
        </section>
      )}

      {quote.status === 'accepted' && (
        <section className="qd-signature">
          <p className="qd-label mono">{t('quotePublic.acceptedBy')}</p>
          <p className="qd-signer">{quote.signer_name}</p>
          <p className="mono qd-dim">{fmtTime(quote.accepted_at, locale)} UTC</p>
        </section>
      )}
      {quote.status === 'declined' && (
        <section className="qd-signature">
          <p className="qd-label mono">{t('quotePublic.declinedOn', { date: fmtTime(quote.declined_at, locale) })}</p>
          {quote.decline_reason && <p className="qd-text">{quote.decline_reason}</p>}
        </section>
      )}
    </article>
  );
}
