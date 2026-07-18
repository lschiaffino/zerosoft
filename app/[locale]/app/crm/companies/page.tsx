import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { LIFECYCLE_STAGES, listCompanies } from '@/lib/crm';
import { formatDate } from '@/lib/utils';
import CompanyFilters from '@/components/crm/CompanyFilters';
import CompaniesTable, { type CompanyRow } from '@/components/crm/CompaniesTable';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

interface CompaniesPageProps {
  params: { locale: string };
  searchParams: Record<string, string | string[] | undefined>;
}

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export default async function CompaniesPage({ params: { locale }, searchParams }: CompaniesPageProps) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const q = one(searchParams.q) ?? '';
  const industry = one(searchParams.industry) ?? '';
  const lifecycle = one(searchParams.lifecycle) ?? '';
  const sortParam = one(searchParams.sort);
  const sort = sortParam === 'oldest' || sortParam === 'name' ? sortParam : 'newest';
  const page = Number(one(searchParams.page) ?? '1') || 1;

  const { rows, total } = await listCompanies(user.id, {
    q: q || undefined,
    industry: industry || undefined,
    lifecycle: lifecycle || undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });

  // Deals por empresa (deals vinculados a contactos de la empresa), solo para la página actual.
  const dealCounts = new Map<string, number>();
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const ph = ids.map(() => '?').join(',');
    const counts = (await getDb()
      .prepare(
        `SELECT c.company_id AS cid, COUNT(DISTINCT d.id) AS c
         FROM crm_deals d
         JOIN crm_deal_contacts dc ON dc.deal_id = d.id
         JOIN crm_contacts c ON c.id = dc.contact_id
         WHERE c.company_id IN (${ph}) AND d.user_id = ?
         GROUP BY c.company_id`,
      )
      .all(...ids, user.id)) as Array<{ cid: string; c: number }>;
    for (const r of counts) dealCounts.set(r.cid, r.c);
  }

  // Industrias presentes para el filtro (select).
  const industries = (
    (await getDb()
      .prepare(
        `SELECT DISTINCT industry FROM crm_companies
         WHERE user_id = ? AND industry != '' ORDER BY industry COLLATE NOCASE`,
      )
      .all(user.id)) as Array<{ industry: string }>
  ).map((r) => r.industry);

  const lifecycleLabel = (v: string): string =>
    (LIFECYCLE_STAGES as readonly string[]).includes(v) ? t(`enums.lifecycle.${v}`) : v;

  const lifecycles = LIFECYCLE_STAGES.map((value) => ({ value, label: t(`enums.lifecycle.${value}`) }));

  const tableRows: CompanyRow[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    industry: c.industry,
    contacts: c.contact_count,
    deals: dealCounts.get(c.id) ?? 0,
    lifecycle: c.lifecycle_stage,
    lifecycleLabel: lifecycleLabel(c.lifecycle_stage),
    created: formatDate(c.created_at, locale),
  }));

  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const currentPage = Math.min(Math.max(page, 1), pages);
  const query: Record<string, string> = {};
  if (q) query.q = q;
  if (industry) query.industry = industry;
  if (lifecycle) query.lifecycle = lifecycle;
  if (sort !== 'newest') query.sort = sort;

  const hasFilters = !!q || !!industry || !!lifecycle;

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('companies.title')}</h1>
        <Link href="/app/crm/companies/new" className="btn btn-solid btn-small">
          {t('companies.newCta')}
        </Link>
      </div>

      <CompanyFilters
        q={q}
        industry={industry}
        lifecycle={lifecycle}
        sort={sort}
        industries={industries}
        lifecycles={lifecycles}
      />

      {tableRows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0 0 0 0 0
          </p>
          <h2>{t('companies.emptyTitle')}</h2>
          <p className="muted">{t('companies.emptySub')}</p>
          <Link href="/app/crm/companies/new" className="btn btn-solid btn-small">
            {t('companies.emptyCta')}
          </Link>
        </div>
      ) : (
        <>
          <CompaniesTable rows={tableRows} />
          {pages > 1 && (
            <nav className="pager mono">
              {currentPage > 1 ? (
                <Link
                  href={{ pathname: '/app/crm/companies', query: { ...query, page: String(currentPage - 1) } }}
                  className="pager-btn"
                >
                  {t('common.pagePrev')}
                </Link>
              ) : (
                <span className="pager-btn disabled">{t('common.pagePrev')}</span>
              )}
              <span className="pager-info">{t('common.pageOf', { page: currentPage, pages })}</span>
              {currentPage < pages ? (
                <Link
                  href={{ pathname: '/app/crm/companies', query: { ...query, page: String(currentPage + 1) } }}
                  className="pager-btn"
                >
                  {t('common.pageNext')}
                </Link>
              ) : (
                <span className="pager-btn disabled">{t('common.pageNext')}</span>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
