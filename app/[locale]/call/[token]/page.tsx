import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import ClientMessages from '@/components/i18n/ClientMessages';
import SharedCallView from '@/components/calls/SharedCallView';
import { getSharedCall } from '@/lib/calls/core';
import '@/styles/calls.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; token: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'calls.share' });
  // Un previsualizador de links no ve el título: ni índice, ni referer con el token.
  return { title: t('metaTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/** Link compartido de una llamada de Calls, sin cuenta: grabación, transcripción y resumen. */
export default async function CallSharePage(props: Props) {
  const { locale, token } = await props.params;
  setRequestLocale(locale);
  const shared = await getSharedCall(token);
  if (!shared) notFound();
  return (
    <ClientMessages locale={locale} namespaces={['calls']}>
      <SharedCallView call={shared.view} token={token} />
    </ClientMessages>
  );
}
