import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPublicQuote, markQuoteViewed } from '@/lib/crm-products';
import { getDb, type CrmQuoteRow } from '@/lib/db';
import { canPayQuote, reconcileQuoteCheckout } from '@/lib/crm-quote-pay';
import QuoteDocument from '@/components/crm/QuoteDocument';
import QuotePublicActions from '@/components/crm/QuotePublicActions';
import '@/styles/quote.css';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ paid?: string; session_id?: string }>;
};

export async function generateMetadata(props: Props) {
  const { locale, token } = await props.params;
  const quote = await getPublicQuote(token);
  const t = await getTranslations({ locale, namespace: 'crm' });
  return {
    title: quote ? `${quote.number} · ${quote.title}` : t('quotePublic.notFound'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer' as const,
  };
}

/** Quote enviado a un cliente: se lee, se imprime, se firma y (si cobra) se paga sin login. */
export default async function PublicQuotePage(props: Props) {
  const { locale, token } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  await markQuoteViewed(token).catch(() => undefined);
  // Vuelta de Stripe Checkout: confirma el pago aunque el webhook no haya llegado.
  if (sp.paid === '1' && sp.session_id) await reconcileQuoteCheckout(token, sp.session_id).catch(() => false);
  const quote = await getPublicQuote(token);
  if (!quote) notFound();
  const row = (await getDb().prepare('SELECT user_id, status, collect_payment, payment_status, total FROM crm_quotes WHERE token = ?').get(token)) as
    | Pick<CrmQuoteRow, 'user_id' | 'status' | 'collect_payment' | 'payment_status' | 'total'>
    | undefined;
  const canPay = row ? await canPayQuote(row) : false;
  return (
    <main className="qp">
      <QuoteDocument quote={quote} locale={locale} />
      <QuotePublicActions
        token={token}
        status={quote.status}
        recipientEmail={quote.recipient_email}
        payment={{
          collect: !!quote.collect_payment,
          status: quote.payment_status ?? 'none',
          paidAt: quote.paid_at ?? null,
          canPay,
          total: quote.total,
          currency: quote.currency,
        }}
        locale={locale}
      />
    </main>
  );
}
