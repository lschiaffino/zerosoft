import { getTranslations } from 'next-intl/server';
import AnalyticsSkeleton from '@/components/analytics-kit/Skeleton';
import LoadingSwitch from '@/components/analytics-kit/LoadingSwitch';
import '@/styles/analytics-kit.css';

/** Carga de /app/calls: la cabecera y las filas como placas. */
export default async function CallsLoading() {
  const [t, tk] = await Promise.all([getTranslations('common.appSoon'), getTranslations('analyticsKit')]);
  const fallback = (
    <div className="app-page ui-page" aria-busy="true">
      <span className="sr-only" role="status">
        {t('loading', { app: 'Calls' })}
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
  // En /analytics, las placas del tablero.
  return <LoadingSwitch analytics={<AnalyticsSkeleton label={tk('loading')} />} fallback={fallback} />;
}
