import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { canSeeQuote, sessionScope } from '@/lib/crm-visibility';
import { getQuote, type PublicQuote } from '@/lib/crm-products';
import { formatMoney } from '@/lib/crm-money';
import QuoteDocument from '@/components/crm/QuoteDocument';
import QuoteActions from '@/components/crm/QuoteActions';
import '@/styles/quote.css';

export const dynamic = 'force-dynamic';

interface QuotePageProps {
  params: Promise<{ locale: string; id: string }>;
}

function fmtTime(d: string | null, locale: string): string {
  if (!d) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(`${d.replace(' ', 'T')}Z`),
  );
}

/** Quote en la app: vista de documento + acciones + historial de estados. */
export default async function QuotePage(props: QuotePageProps) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const quote = await getQuote(user.id, id);
  if (!quote || !(await canSeeQuote(user.id, quote.id, await sessionScope(user)))) notFound();

  const baseUrl = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
  const publicUrl = `${baseUrl}/${locale}/q/${quote.token}`;

  const doc: PublicQuote = {
    number: quote.number,
    title: quote.title,
    status: quote.status,
    currency: quote.currency,
    items: quote.parsed_items,
    subtotal: quote.subtotal,
    discount_total: quote.discount_total,
    tax_total: quote.tax_total,
    total: quote.total,
    expires_at: quote.expires_at,
    terms: quote.terms,
    notes: quote.notes,
    sender_name: quote.sender_name,
    sender_email: quote.sender_email,
    sender_company: quote.sender_company,
    recipient_name: quote.recipient_name,
    recipient_email: quote.recipient_email,
    recipient_company: quote.recipient_company,
    sent_at: quote.sent_at,
    accepted_at: quote.accepted_at,
    declined_at: quote.declined_at,
    signer_name: quote.signer_name,
    decline_reason: quote.decline_reason,
    created_at: quote.created_at,
  };

  const timeline: Array<{ key: string; label: string; at: string }> = [
    { key: 'draft', label: t('quotes.timeline.created'), at: quote.created_at },
    ...(quote.sent_at ? [{ key: 'sent', label: t('quotes.timeline.sent'), at: quote.sent_at }] : []),
    ...(quote.accepted_at
      ? [{ key: 'accepted', label: t('quotes.timeline.accepted', { name: quote.signer_name }), at: quote.accepted_at }]
      : []),
    ...(quote.declined_at ? [{ key: 'declined', label: t('quotes.timeline.declined'), at: quote.declined_at }] : []),
    ...(quote.status === 'expired' && quote.expires_at
      ? [{ key: 'expired', label: t('quotes.timeline.expired'), at: `${quote.expires_at} 23:59:59` }]
      : []),
  ];

  return (
    <div className="app-page quote-app-view">
      <div>
        <Link href={`/app/crm/deals/${quote.deal_id}`} className="back-link">
          ← {quote.deal_name ?? t('quotes.backToDeal')}
        </Link>
      </div>

      <header className="detail-header">
        <div className="detail-title-row">
          <h1 className="detail-title">
            <span className="mono">{quote.number}</span> · {quote.title}
          </h1>
          <span className={`crm-dot-status q-${quote.status}`}>{t(`enums.quoteStatus.${quote.status}`)}</span>
        </div>
        <div className="detail-meta">
          <span className="detail-amount">{formatMoney(quote.total, quote.currency, locale, true)}</span>
          {quote.deal_name && (
            <Link href={`/app/crm/deals/${quote.deal_id}`} className="detail-meta-item cell-email">
              {quote.deal_name}
            </Link>
          )}
        </div>
      </header>

      <QuoteActions
        quote={{
          id: quote.id,
          status: quote.status,
          title: quote.title,
          expires_at: quote.expires_at,
          terms: quote.terms,
          notes: quote.notes,
          sender_name: quote.sender_name,
          sender_email: quote.sender_email,
          sender_company: quote.sender_company,
          recipient_name: quote.recipient_name,
          recipient_email: quote.recipient_email,
          recipient_company: quote.recipient_company,
        }}
        publicUrl={publicUrl}
        dealHref={`/app/crm/deals/${quote.deal_id}`}
      />

      <div className="quote-layout">
        <QuoteDocument quote={doc} locale={locale} />
        <aside className="quote-side">
          <h2 className="section-label">{t('quotes.timeline.title')}</h2>
          <ol className="quote-timeline">
            {timeline.map((e) => (
              <li key={e.key} className={`q-${e.key}`}>
                <span>{e.label}</span>
                <span className="mono muted">{fmtTime(e.at, locale)}</span>
              </li>
            ))}
          </ol>
          {quote.status !== 'draft' && (
            <p className="muted quote-link mono" title={publicUrl}>
              {publicUrl}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
