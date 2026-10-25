import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import ComingSoonApp from '@/components/app/ComingSoonApp';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'rec' });
  return { title: t('meta.title') };
}

/** Rec: todavía en construcción. Las tandas siguientes reemplazan este inicio. */
export default async function RecPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  await requireUser(locale);
  return <ComingSoonApp locale={locale} product="rec" />;
}
