import { getTranslations } from 'next-intl/server';
import { countChatConversations, listChatWidgets } from '@/lib/chat-data';
import { formatDate, formatNumber } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import PlatformSettingsLink from '@/components/app/PlatformSettingsLink';
import EmptyState from '@/components/ui/EmptyState';
import DataTable from '@/components/ui/DataTable';
import type { ChatWidgetRow } from '@/lib/db';
import NewWidgetButton from './NewWidgetButton';

type WidgetRowView = ChatWidgetRow & { open: number };

/**
 * Lista de widgets de Chat (antes "Ajustes"): cada fila lleva al editor del
 * widget, que tiene el código, la apariencia, el bot, el horario, las reglas,
 * las respuestas guardadas y el SLA. `openNew` abre el modal de crear
 * (/app/chat/widgets/new).
 */
export default async function WidgetsIndex({
  locale,
  userId,
  teamId,
  openNew = false,
}: {
  locale: string;
  userId: string;
  teamId: string | null;
  openNew?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'chat' });
  const widgets = await listChatWidgets(userId, teamId);
  const counts = await Promise.all(widgets.map((w) => countChatConversations([w.id], { status: 'open' })));
  const rows: WidgetRowView[] = widgets.map((w, i) => ({ ...w, open: counts[i] }));
  const createButton = (
    <NewWidgetButton defaultOpen={openNew} closeHref={openNew ? '/app/chat/widgets' : undefined} shortcut={!openNew} />
  );

  return (
    <div className="ui-page">
      <PageHeader
        title={t('widgets.title')}
        description={t('widgets.subtitle')}
        actions={
          <>
            <PlatformSettingsLink locale={locale} />
            {widgets.length > 0 && createButton}
          </>
        }
      />
      {widgets.length === 0 ? (
        <EmptyState title={t('overview.emptyTitle')} body={t('overview.emptySub')} action={createButton} product="chat" />
      ) : (
        <DataTable<WidgetRowView>
          caption={t('widgets.title')}
          rows={rows}
          rowKey={(w) => w.id}
          rowHref={(w) => `/app/chat/widgets/${w.id}`}
          className="chat-stack"
          columns={[
            {
              key: 'name',
              header: t('widgetForm.name'),
              cell: (w) => (
                <span className="chat-widget-name">
                  <span className="chat-swatch-sm" style={{ backgroundColor: w.color }} aria-hidden="true" />
                  {w.name}
                </span>
              ),
            },
            { key: 'open', header: t('widgets.open'), numeric: true, cell: (w) => formatNumber(w.open, locale) },
            {
              key: 'bot',
              header: t('widgetForm.tabs.bot'),
              cell: (w) => (w.bot_enabled === 1 ? t('widgets.on') : <span className="chat-quiet">{t('widgets.off')}</span>),
            },
            {
              key: 'hours',
              header: t('widgetForm.tabs.hours'),
              cell: (w) =>
                w.office_hours ? t('widgets.hoursSet') : <span className="chat-quiet">{t('widgets.alwaysOn')}</span>,
            },
            {
              key: 'created',
              header: t('widgets.created'),
              data: true,
              cell: (w) => <span className="chat-nowrap">{formatDate(w.created_at, locale)}</span>,
            },
          ]}
        />
      )}
    </div>
  );
}
