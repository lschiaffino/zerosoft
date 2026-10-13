import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import FeedbackForm from '@/components/FeedbackForm';
import { FEEDBACK_PRODUCTS, type FeedbackProduct } from '@/lib/feedback-constants';
import { getCurrentUser } from '@/lib/session';
import '@/styles/pages.css';
import '@/styles/feedback.css';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'feedback.page' });
  const title = t('metaTitle');
  const description = t('metaDescription');
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/feedback` },
    openGraph: { title, description, type: 'website', url: `/${locale}/feedback` },
  };
}

/** Formulario público de feedback (sin cuenta; email opcional). ?product=crm preselecciona. */
export default async function FeedbackPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ product?: string }>;
}) {
  const { locale } = await props.params;
  const { product } = await props.searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'feedback' });
  const user = await getCurrentUser().catch(() => null);
  const email = user?.actingUser?.email ?? user?.email ?? null;
  const initial: FeedbackProduct = FEEDBACK_PRODUCTS.includes(product as FeedbackProduct)
    ? (product as FeedbackProduct)
    : 'site';

  return (
    <main>
      <div className="doc-hero container">
        <p className="section-label">{t('page.label')}</p>
        <h1 className="doc-title">
          {t('page.title')}
          <br />
          <span className="dim">{t('page.titleDim')}</span>
        </h1>
        <p className="doc-intro">{t('page.intro')}</p>
      </div>

      <div className="container fb-page">
        <div className="fb-page-card">
          <FeedbackForm defaultProduct={initial} signedInEmail={email} />
        </div>
        <aside className="fb-aside">
          <p className="fb-aside-title">{t('page.asideTitle')}</p>
          <ol>
            <li>{t('page.aside1')}</li>
            <li>{t('page.aside2')}</li>
            <li>{t('page.aside3')}</li>
          </ol>
          <Link href="/changelog" className="fb-aside-link">
            {t('page.changelogLink')}
          </Link>
        </aside>
      </div>
    </main>
  );
}
