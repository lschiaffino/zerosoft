import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/**
 * Paginador de las tablas del CRM: anterior / "página X de Y" / siguiente,
 * conservando filtros y orden. Muestra cuántos registros hay en total.
 */
export default async function CrmPager({
  pathname,
  query,
  page,
  pages,
  total,
  locale,
}: {
  pathname: string;
  query: Record<string, string>;
  page: number;
  pages: number;
  total: number;
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: 'crm.record.pager' });
  return (
    <nav className="crm-pager" aria-label={t('label')}>
      <span className="crm-pager-total">{t('total', { count: total })}</span>
      {pages > 1 && (
        <span className="crm-pager-nav">
          {page > 1 ? (
            <Link href={{ pathname, query: { ...query, page: String(page - 1) } }} className="btn btn-secondary btn-sm" rel="prev">
              {t('prev')}
            </Link>
          ) : (
            <span className="btn btn-secondary btn-sm" aria-disabled="true">
              {t('prev')}
            </span>
          )}
          <span className="crm-pager-info" aria-current="page">
            {t('of', { page, pages })}
          </span>
          {page < pages ? (
            <Link href={{ pathname, query: { ...query, page: String(page + 1) } }} className="btn btn-secondary btn-sm" rel="next">
              {t('next')}
            </Link>
          ) : (
            <span className="btn btn-secondary btn-sm" aria-disabled="true">
              {t('next')}
            </span>
          )}
        </span>
      )}
    </nav>
  );
}
