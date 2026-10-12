import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getChatVisitorWithStats, getChatWidget } from '@/lib/chat-data';
import VisitorDetailClient from '@/components/chat/VisitorDetailClient';

export const dynamic = 'force-dynamic';

export default async function ChatVisitorPage(
  props: {
    params: Promise<{ locale: string; id: string }>;
  }
) {
  const params = await props.params;

  const {
    locale,
    id
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });

  const visitor = await getChatVisitorWithStats(id);
  if (!visitor) notFound();

  const widget = await getChatWidget(visitor.widget_id);
  if (!widget || (widget.user_id !== user.id && widget.team_id !== user.team?.id)) {
    notFound();
  }

  return (
    <div className="app-page">
      <div className="page-head">
        <div>
          <h1 className="app-title">{visitor.name || visitor.email || visitor.external_id}</h1>
          {visitor.email && visitor.name && <p className="app-sub muted">{visitor.email}</p>}
        </div>
      </div>
      <VisitorDetailClient initialVisitor={visitor} />
    </div>
  );
}
