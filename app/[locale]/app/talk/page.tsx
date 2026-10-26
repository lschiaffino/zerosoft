import { getTranslations } from 'next-intl/server';
import { renderTalk } from './talk-page';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'talk' });
  return { title: t('meta.title') };
}

export default async function TalkPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await props.params;
  return renderTalk(locale, null, await props.searchParams);
}
