import { useTranslations } from 'next-intl';

/** Carga de cualquier pestaña de Ajustes: la forma de una sección, sin spinner. */
export default function SettingsLoading() {
  const t = useTranslations('settings.states');
  return (
    <div className="st-stack" role="status" aria-label={t('loading')}>
      <div className="ui-section">
        <div className="ui-section-body">
          <span className="ui-skeleton ui-skeleton-title" />
          <span className="ui-skeleton ui-skeleton-text" />
          <div className="ui-loading-stack">
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} className="ui-skeleton ui-skeleton-row" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
