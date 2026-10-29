import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getBrandKit } from '@/lib/design';
import { designActorOf } from '@/lib/design-http';
import DesignBrandKit from '@/components/design/DesignBrandKit';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'design.brand' });
  return { title: `${t('title')} · Design` };
}

/** Kit de marca del workspace: logos, colores y fuentes. Lo editan owner y admins; lo usa todo el que tiene Design. */
export default async function DesignBrandPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const actor = designActorOf(user);
  const brand = await getBrandKit(actor.ws);
  return <DesignBrandKit initial={brand} canEdit={actor.admin} />;
}
