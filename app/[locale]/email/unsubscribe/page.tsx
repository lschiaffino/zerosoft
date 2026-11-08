import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import ClientMessages from '@/components/i18n/ClientMessages';
import UnsubscribeConfirm from '@/components/settings/UnsubscribeConfirm';
import { parseUnsubscribeToken } from '@/lib/lifecycle/prefs';
import '@/styles/email-unsubscribe.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ t?: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.emailPrefs.unsub' });
  return { title: t('metaTitle'), robots: { index: false } };
}

/** Baja de los emails de ciclo de vida (link del pie de cada email). Abrirla no cambia nada. */
export default async function EmailUnsubscribePage(props: Props) {
  const { locale } = await props.params;
  const { t: token } = await props.searchParams;
  setRequestLocale(locale);
  const parsed = parseUnsubscribeToken(token);
  const t = await getTranslations({ locale, namespace: 'settings.emailPrefs.unsub' });
  return (
    <main className="eu-page">
      {parsed && token ? (
        <ClientMessages locale={locale} namespaces={['settings.emailPrefs']}>
          <UnsubscribeConfirm token={token} category={parsed.scope === 'all' ? null : parsed.scope} />
        </ClientMessages>
      ) : (
        <div className="eu-card" data-testid="email-unsubscribe-invalid">
          <p className="eu-brand">zerosoft</p>
          <h1 className="eu-title">{t('title')}</h1>
          <p className="eu-body">{t('invalid')}</p>
          <Link href="/app/settings/notifications" className="eu-link" prefetch={false}>
            {t('manage')}
          </Link>
        </div>
      )}
    </main>
  );
}
