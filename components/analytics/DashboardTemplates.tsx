'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { DASHBOARD_TEMPLATES, type DashboardTemplate } from '@/lib/analytics/dashboard-templates';
import { ApiError, api, apiErrorText, notifyChanged } from './client';

/** Crear un tablero armado: sus insights quedan en el proyecto y se editan como cualquier otro. */
export default function DashboardTemplates({ projectId }: { projectId: string }) {
  const t = useTranslations('analytics.dashboards');
  const tc = useTranslations('analytics.common');
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState<DashboardTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = async (template: DashboardTemplate) => {
    setBusy(template);
    setError(null);
    try {
      const { dashboard } = await api<{ dashboard: { id: string } }>('/api/analytics/dashboards', { body: { projectId, template, locale } });
      notifyChanged();
      router.push(`/app/pulse/dashboards/${dashboard.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? apiErrorText(err, tc) : tc('error'));
      setBusy(null);
    }
  };
  return (
    <section className="an-panel an-templates" aria-label={t('templatesTitle')}>
      <h2 className="an-h3 an-flush">{t('templatesTitle')}</h2>
      <ul className="an-templates-list" role="list">
        {DASHBOARD_TEMPLATES.map((k) => (
          <li key={k} className="an-template">
            <div>
              <strong>{t(`templates.${k}.name`)}</strong>
              <p className="an-note an-flush">{t(`templates.${k}.body`)}</p>
            </div>
            <button type="button" className="btn btn-sm" disabled={busy !== null} aria-busy={busy === k} onClick={() => void create(k)} aria-label={t('useTemplateNamed', { name: t(`templates.${k}.name`) })}>
              {t('useTemplate')}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
