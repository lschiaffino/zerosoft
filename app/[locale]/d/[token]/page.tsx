import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPublicDesign } from '@/lib/design';
import DesignPublicView from '@/components/design/DesignPublicView';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; token: string }> };

const load = cache((token: string) => getPublicDesign(token));

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, token } = await props.params;
  const pub = await load(token);
  const t = await getTranslations({ locale, namespace: 'design.public' });
  // Nunca en buscadores; sin referrer (el token no viaja a otros sitios).
  return { title: pub?.row.name ?? t('notFound'), robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
}

/** Diseño compartido con link: las páginas en solo lectura. Si el link se revocó, 404. */
export default async function DesignPublicPage(props: Props) {
  const { locale, token } = await props.params;
  setRequestLocale(locale);
  const pub = await load(token);
  if (!pub) notFound();
  return <DesignPublicView name={pub.row.name} doc={pub.doc} token={token} />;
}
