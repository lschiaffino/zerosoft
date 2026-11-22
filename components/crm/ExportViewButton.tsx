'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import CrmIcon from './CrmIcon';

/**
 * "Exportar la vista" (solo admins, como el export de siempre): baja en CSV
 * todo lo que el listado muestra con sus filtros, no solo la página. Manda el
 * estado del listado (la URL) y el server lo vuelve a evaluar con el alcance
 * y los permisos de quien exporta.
 */
export default function ExportViewButton({ entity }: { entity: 'contacts' | 'companies' | 'deals' }) {
  const t = useTranslations('crm.listBar');
  const params = useSearchParams();
  const list = new URLSearchParams(params.toString());
  list.delete('page');
  list.delete('per');
  const href = `/api/crm/export?${new URLSearchParams({ entity, format: 'csv', list: list.toString() }).toString()}`;
  return (
    <a className="column-toggle-btn export-view-btn" href={href} download data-testid="export-view" title={t('exportViewHint')}>
      <CrmIcon name="download" size={13} />
      <span>{t('exportView')}</span>
    </a>
  );
}
