import { getTranslations } from 'next-intl/server';

/** Carga de /app/inbox: la lista y la conversación como placas. */
export default async function InboxLoading() {
  const t = await getTranslations('common.appSoon');
  return (
    <div className="ib-app" aria-busy="true">
      <span className="sr-only" role="status">
        {t('loading', { app: 'Inbox' })}
      </span>
      <div className="ib-list-pane">
        <div className="ib-list-head">
          <span className="ui-skeleton ui-skeleton-title" />
          <span className="ui-skeleton ui-skeleton-text" />
        </div>
        <div className="ib-list-msg">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      </div>
      <div className="ib-convo-pane" />
    </div>
  );
}
