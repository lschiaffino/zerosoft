import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listChatWidgets } from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

export default async function ChatPeoplePage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('sidebar.people')}</h1>
      </div>
      <section className="panel empty-inline">
        <p className="empty-zeros mono" aria-hidden>0 0 0</p>
        <p className="muted">{t('common.empty')}</p>
      </section>
    </div>
  );
}
