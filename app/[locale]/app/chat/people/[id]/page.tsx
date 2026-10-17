import { notFound } from 'next/navigation';
import { canAccessWidget } from '@/lib/chat-access';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getChatVisitorWithStats, getChatWidget } from '@/lib/chat-data';
import PageHeader from '@/components/ui/PageHeader';
import VisitorDetailClient from '@/components/chat/VisitorDetailClient';

export const dynamic = 'force-dynamic';

export default async function ChatVisitorPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });

  const visitor = await getChatVisitorWithStats(id);
  if (!visitor) notFound();

  const widget = await getChatWidget(visitor.widget_id);
  if (!widget || !canAccessWidget(widget, user)) notFound();

  return (
    <div className="ui-page">
      <PageHeader
        back={{ href: '/app/chat/people', label: t('people.title') }}
        title={visitor.name || visitor.email || t('conversation.anonymous')}
        description={visitor.name && visitor.email ? visitor.email : undefined}
      />
      <VisitorDetailClient initialVisitor={visitor} />
    </div>
  );
}
