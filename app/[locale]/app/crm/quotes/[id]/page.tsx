import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { canSeeQuote, sessionScope } from '@/lib/crm-visibility';
import { getQuote, type PublicQuote } from '@/lib/crm-products';
import { formatMoney } from '@/lib/crm-money';
import QuoteDocument from '@/components/crm/QuoteDocument';
import QuoteActions from '@/components/crm/QuoteActions';
import PageHeader from '@/components/ui/PageHeader';
import { QUOTE_TONE, badgeClass } from '@/lib/crm-ui-tones';
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

/** Cotización en la app: vista de documento, acciones e historial de estados. */
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
    <div className="app-page ui-page quote-app-view">
      <PageHeader
        back={{ href: `/app/crm/deals/${quote.deal_id}`, label: quote.deal_name ?? t('quotes.backToDeal') }}
        title={
          <>
            <span className="data quote-number">{quote.number}</span> {quote.title}
          </>
        }
        description={
          <span className="quote-head-meta">
            <span className={badgeClass(QUOTE_TONE, quote.status)}>{t(`enums.quoteStatus.${quote.status}`)}</span>
            <span className="data">{formatMoney(quote.total, quote.currency, locale, true)}</span>
          </span>
        }
      />

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
          <h2 className="crm-panel-title">{t('quotes.timeline.title')}</h2>
          {/* Historial de la cotización: una lista simple con la fecha de cada hito. */}
          <ol className="quote-history">
            {timeline.map((e) => (
              <li key={e.key} className={`quote-history-item q-${e.key}`}>
                <p className="quote-history-text">
                  <span>{e.label}</span>
                  <span className="data">{fmtTime(e.at, locale)}</span>
                </p>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
