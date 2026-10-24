import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/** Navegación entre reportes estándar, reportes propios y forecast (como Reports en HubSpot). */
export default async function ReportsSubnav({ locale, active }: { locale: string; active: 'standard' | 'custom' | 'forecast' }) {
  const t = await getTranslations({ locale, namespace: 'crm' });
  const items = [
    { key: 'standard', href: '/app/crm/reports', label: t('reportBuilder.nav.standard') },
    { key: 'custom', href: '/app/crm/reports/custom', label: t('reportBuilder.nav.custom') },
    { key: 'forecast', href: '/app/crm/forecast', label: t('reportBuilder.nav.forecast') },
  ] as const;
  return (
    <nav className="report-type-tabs reports-subnav" aria-label={t('reports.title')}>
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          className={`report-type-tab${i.key === active ? ' active' : ''}`}
          aria-current={i.key === active ? 'page' : undefined}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
