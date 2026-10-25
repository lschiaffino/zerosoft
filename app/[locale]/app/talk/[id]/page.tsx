import { getTranslations } from 'next-intl/server';
import { getCurrentUser } from '@/lib/session';
import { getChannelDto, talkActor } from '@/lib/talk';
import { renderTalk } from '../talk-page';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const t = await getTranslations({ locale, namespace: 'talk' });
  const user = await getCurrentUser();
  const channel = user ? await getChannelDto(talkActor(user), id).catch(() => null) : null;
  const name = channel && (channel.kind === 'public' || channel.kind === 'private') ? `#${channel.name}` : null;
  return { title: name ? `${name} · ${t('meta.title')}` : t('meta.title') };
}

export default async function TalkChannelPage(props: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale, id } = await props.params;
  return renderTalk(locale, id, await props.searchParams);
}
