import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getChatWidget } from '@/lib/chat-data';
import CannedClient from '@/components/chat/CannedClient';

export const dynamic = 'force-dynamic';

export default async function WidgetCannedPage({
  params: { locale, id },
}: {
  params: { locale: string; id: string };
}) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });
  const widget = await getChatWidget(id);

  if (!widget || (widget.user_id !== user.id && widget.team_id !== user.team?.id)) {
    notFound();
  }

  return (
    <div className="app-page">
      <div className="page-head">
        <div>
          <h1 className="app-title">{t('canned.title')}</h1>
          <p className="app-sub muted">{widget.name}</p>
        </div>
      </div>
      <CannedClient widgetId={widget.id} />
    </div>
  );
}
