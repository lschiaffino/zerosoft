import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPublicQuote } from '@/lib/crm-products';
import QuoteDocument from '@/components/crm/QuoteDocument';
import QuotePublicActions from '@/components/crm/QuotePublicActions';
import '@/styles/quote.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; token: string }> };

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

/** Quote enviado a un cliente: se lee, se imprime y se acepta o rechaza sin login. */
export default async function PublicQuotePage(props: Props) {
  const { locale, token } = await props.params;
  setRequestLocale(locale);
  const quote = await getPublicQuote(token);
  if (!quote) notFound();
  return (
    <main className="qp">
      <QuoteDocument quote={quote} locale={locale} />
      <QuotePublicActions token={token} status={quote.status} />
    </main>
  );
}
