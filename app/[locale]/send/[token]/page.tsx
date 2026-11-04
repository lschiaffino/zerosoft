import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import ClientMessages from '@/components/i18n/ClientMessages';
import SendViewer from '@/components/send/SendViewer';
import { loadSession, resolveLink, viewerState } from '@/lib/send/viewer';
import { sessionCookie } from '@/lib/send/types';
import '@/styles/send.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; token: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'send.viewer' });
  // Un previsualizador de links no ve el título: ni índice, ni referer con el token.
  return { title: t('metaTitle'), description: t('metaDescription'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/** Link público de Send, sin cuenta. Esta página solo lee: no crea sesión ni visita. */
export default async function SendPublicPage(props: Props) {
  const { locale, token } = await props.params;
  setRequestLocale(locale);
  const link = await resolveLink(token);
  if (!link) notFound();
  const jar = await cookies();
  const session = await loadSession(link, jar.get(sessionCookie(link.id))?.value);
  return (
    <ClientMessages locale={locale} namespaces={['send']}>
      <SendViewer token={token} initial={await viewerState(link, session)} />
    </ClientMessages>
  );
}
