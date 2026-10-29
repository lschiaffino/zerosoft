'use client';

import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { notifyChanged, setProjectCookie } from './client';

/**
 * Proyecto que se mira (arriba de cada página de Analytics, como el selector
 * de proyecto de PostHog). Cambiarlo guarda la cookie y recarga los datos.
 */
export default function ProjectBar({ projects, currentId }: { projects: Array<{ id: string; name: string }>; currentId: string | null }) {
  const t = useTranslations('analytics.projectBar');
  const router = useRouter();
  if (!projects.length) return null;
  return (
    <div className="an-projectbar">
      <label className="an-projectbar-field">
        <span className="an-projectbar-label">{t('project')}</span>
        <select
          className="select select-sm"
          value={currentId ?? ''}
          onChange={(e) => {
            setProjectCookie(e.target.value);
            notifyChanged();
            router.refresh();
          }}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <Link href="/app/analytics/settings" className="an-link an-projectbar-setup">
        {t('setup')}
      </Link>
    </div>
  );
}
