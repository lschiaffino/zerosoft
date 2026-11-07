import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import ClientMessages from '@/components/i18n/ClientMessages';
import { UnsubscribeButton } from '@/components/analytics/Subscriptions';
import '@/styles/app-shared.css';
import '@/styles/analytics.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ t?: string; confirm?: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics.subscriptions' });
  return { title: t('unsubscribeTitle'), robots: { index: false } };
}

/** Darse de baja de un reporte: abrir el link no cambia nada, hace falta confirmar. */
export default async function UnsubscribePage(props: Props) {
  const { locale } = await props.params;
  const { t: token, confirm } = await props.searchParams;
  setRequestLocale(locale);
  return (
    <ClientMessages locale={locale} namespaces={['analytics']}>
      <main className="an-share-public">
        <UnsubscribeButton token={token ?? ''} confirm={confirm} />
      </main>
    </ClientMessages>
  );
}
