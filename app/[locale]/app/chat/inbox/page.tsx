import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listChatWidgets } from '@/lib/chat-data';
import InboxClient from '@/components/chat/InboxClient';

export const dynamic = 'force-dynamic';

export default async function ChatInboxPage(
  props: {
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });
  const widgets = await listChatWidgets(user.id, user.team?.id ?? null);

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('inbox.title')}</h1>
      </div>
      <InboxClient widgetIds={widgets.map((w) => w.id)} currentUserId={user.id} />
    </div>
  );
}
