import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { canAccessWidget } from '@/lib/chat-access';
import { requireUser } from '@/lib/session';
import { countChatConversations, getChatWidget } from '@/lib/chat-data';
import { formatNumber } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import SettingsTabs from '@/components/ui/SettingsTabs';
import ClientMessages from '@/components/i18n/ClientMessages';
// La sección Widget lista los tipos de evento de Cal (EventTypesView).
import '@/styles/calendar.css';

export const dynamic = 'force-dynamic';

/**
 * Cabecera y navegación de un widget: Widget (apariencia, formulario, bot,
 * horario), Reglas, Respuestas guardadas, SLA, Mensajes salientes y Email
 * como secciones a la izquierda.
 */
export default async function WidgetLayout(props: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const widget = await getChatWidget(id);
  if (!widget || !canAccessWidget(widget, user)) notFound();

  const t = await getTranslations({ locale, namespace: 'chat' });
  const open = await countChatConversations([widget.id], { status: 'open' });
  const base = `/app/chat/widgets/${widget.id}`;

  return (
    <ClientMessages locale={locale} namespaces={['calendar']}>
      <div className="ui-page">
        <PageHeader
          back={{ href: '/app/chat/widgets', label: t('widgets.title') }}
          title={
            <span className="chat-widget-name">
              <span className="chat-swatch-lg" style={{ backgroundColor: widget.color }} aria-hidden="true" />
              {widget.name}
            </span>
          }
          actions={
            <Link href="/app/chat/inbox" className="btn btn-secondary">
              {t('widgets.openInbox', { count: open, formatted: formatNumber(open, locale) })}
            </Link>
          }
        />
        <SettingsTabs
          mode="route"
          label={widget.name}
          className="chat-widget-sections"
          items={[
            { key: 'settings', href: base, label: t('widgetNav.settings') },
            { key: 'rules', href: `${base}/rules`, label: t('widgetNav.rules') },
            { key: 'canned', href: `${base}/canned`, label: t('widgetNav.canned') },
            { key: 'sla', href: `${base}/sla`, label: t('widgetNav.sla') },
            { key: 'outbound', href: `${base}/outbound`, label: t('widgetNav.outbound') },
            { key: 'email', href: `${base}/email`, label: t('widgetNav.email') },
          ]}
        >
          {props.children}
        </SettingsTabs>
      </div>
    </ClientMessages>
  );
}
