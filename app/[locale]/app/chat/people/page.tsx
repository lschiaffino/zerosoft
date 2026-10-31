import { getTranslations } from 'next-intl/server';
import { listAccessibleChatWidgets } from '@/lib/chat-access';
import { requireUser } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import PeopleClient from '@/components/chat/PeopleClient';

export const dynamic = 'force-dynamic';

export default async function ChatPeoplePage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });
  const widgets = await listAccessibleChatWidgets(user);

  return (
    <div className="ui-page">
      <PageHeader title={t('people.title')} description={t('people.subtitle')} />
      <PeopleClient widgetIds={widgets.map((w) => w.id)} />
    </div>
  );
}
