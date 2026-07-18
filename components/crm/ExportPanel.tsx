import { getTranslations } from 'next-intl/server';

const ENTITIES = ['contacts', 'companies', 'deals', 'activities'] as const;

/** Export directo por entidad: links <a> al endpoint, sin JS. */
export default async function ExportPanel({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'crm' });

  return (
    <div className="exp">
      <p className="muted exp-tagline">{t('settings.exportTagline')}</p>
      {ENTITIES.map((entity) => (
        <div className="exp-row" key={entity}>
          <span className="exp-name">{t(`settings.entities.${entity}`)}</span>
          <span className="exp-actions">
            <a className="btn btn-small" href={`/api/crm/export?entity=${entity}&format=csv`}>
              CSV
            </a>
            <a className="btn btn-small" href={`/api/crm/export?entity=${entity}&format=json`}>
              JSON
            </a>
          </span>
        </div>
      ))}
    </div>
  );
}
