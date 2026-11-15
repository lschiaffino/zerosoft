import { getTranslations } from 'next-intl/server';
import { FLEET_NAME } from '@/lib/fleet/name';

/** Carga de /app/fleet: la cabecera, las cifras y las tarjetas como placas. */
export default async function FleetLoading() {
  const t = await getTranslations('common.appSoon');
  return (
    <div className="app-page ui-page" aria-busy="true">
      <span className="sr-only" role="status">
        {t('loading', { app: FLEET_NAME })}
      </span>
      <div className="ui-page-header">
        <div className="ui-page-header-text">
          <span className="ui-skeleton ui-skeleton-title" />
          <span className="ui-skeleton ui-skeleton-text" />
        </div>
      </div>
      <div className="ui-loading-stack">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="ui-skeleton ui-skeleton-row" />
        ))}
      </div>
    </div>
  );
}
