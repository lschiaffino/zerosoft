import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { LIFECYCLE_STAGES, listCompanies, listCustomFields, parseFilterRules, type FilterFieldType } from '@/lib/crm';
import { listMembers } from '@/lib/teams';
import { formatDate } from '@/lib/utils';
import CompanyFilters from '@/components/crm/CompanyFilters';
import CompaniesTable, { type CompanyRow } from '@/components/crm/CompaniesTable';
import FilterBuilder, { type FilterBuilderField } from '@/components/crm/FilterBuilder';

import CrmQuickCreate from '@/components/crm/CrmQuickCreate';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

interface CompaniesPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function parseCustomFilter(
  searchParams: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (key.startsWith('custom_') && typeof value === 'string' && value) {
      out[key.slice(7)] = value;
    }
  }
  return out;
}

export default async function CompaniesPage(props: CompaniesPageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const q = one(searchParams.q) ?? '';
  const industry = one(searchParams.industry) ?? '';
  const lifecycle = one(searchParams.lifecycle) ?? '';
  const owner = one(searchParams.owner) ?? '';
  const createdFrom = one(searchParams.createdFrom) ?? '';
  const createdTo = one(searchParams.createdTo) ?? '';
  const custom = parseCustomFilter(searchParams);
  const sortParam = one(searchParams.sort);
  const sort =
    sortParam === 'oldest' || sortParam === 'name' || sortParam === 'name_desc'
      ? sortParam
      : 'newest';
  const page = Number(one(searchParams.page) ?? '1') || 1;
  const rawFilters = one(searchParams.filters) ?? '';
  const advancedRules = parseFilterRules(rawFilters);

  const customFieldDefs = await listCustomFields(user.id, 'companies');
  const customTypes: Record<string, FilterFieldType> = Object.fromEntries(
    customFieldDefs.map((cf) => [cf.name, cf.type]),
  );

  const { rows, total } = await listCompanies(user.id, {
    q: q || undefined,
    industry: industry || undefined,
    lifecycle: lifecycle || undefined,
    owner: owner || undefined,
    createdFrom: createdFrom || undefined,
    createdTo: createdTo || undefined,
    custom: Object.keys(custom).length ? custom : undefined,
    filters: advancedRules.length ? advancedRules : undefined,
    customTypes,
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

  const teamMembers = user.team?.id
    ? await listMembers(user.team.id)
    : [{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }];
  const owners = teamMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));

  const customFields = customFieldDefs
    .filter((cf) => cf.type === 'select')
    .map((cf) => {
      let options: string[] = [];
      try {
        const parsed: unknown = JSON.parse(cf.options);
        if (Array.isArray(parsed)) options = parsed.filter((o): o is string => typeof o === 'string');
      } catch {
        options = [];
      }
      return { name: cf.name, label: cf.label, options };
    })
    .filter((cf) => cf.options.length > 0);

  // Campos del constructor avanzado: estándar + custom fields de la entidad.
  const builderFields: FilterBuilderField[] = [
    { key: 'name', label: t('filters.field.name'), type: 'text' },
    { key: 'domain', label: t('filters.field.domain'), type: 'text' },
    {
      key: 'industry',
      label: t('filters.field.industry'),
      type: 'select',
      options: industries.map((ind) => ({ value: ind, label: ind })),
    },
    { key: 'lifecycle', label: t('filters.field.lifecycle'), type: 'select', options: lifecycles },
    { key: 'owner', label: t('filters.field.owner'), type: 'select', options: owners },
    { key: 'created', label: t('filters.field.created'), type: 'date' },
    ...customFieldDefs.map((cf): FilterBuilderField => {
      if (cf.type === 'boolean') {
        return {
          key: `custom:${cf.name}`,
          label: cf.label,
          type: 'select',
          options: [
            { value: '1', label: t('common.yes') },
            { value: '0', label: t('common.no') },
          ],
        };
      }
      if (cf.type === 'select') {
        let options: Array<{ value: string; label: string }> = [];
        try {
          const parsed: unknown = JSON.parse(cf.options);
          if (Array.isArray(parsed)) {
            options = parsed
              .filter((o): o is string => typeof o === 'string')
              .map((o) => ({ value: o, label: o }));
          }
        } catch {
          options = [];
        }
        return { key: `custom:${cf.name}`, label: cf.label, type: 'select', options };
      }
      return {
        key: `custom:${cf.name}`,
        label: cf.label,
        type: cf.type === 'number' ? 'number' : cf.type === 'date' ? 'date' : 'text',
      };
    }),
  ];

  const tableRows: CompanyRow[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    industry: c.industry,
    phone: c.phone,
    location: [c.city, c.country].filter(Boolean).join(', '),
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
  if (owner) query.owner = owner;
  if (createdFrom) query.createdFrom = createdFrom;
  if (createdTo) query.createdTo = createdTo;
  Object.entries(custom).forEach(([k, v]) => {
    if (v) query[`custom_${k}`] = v;
  });
  if (rawFilters) query.filters = rawFilters;
  if (sort !== 'newest') query.sort = sort;

  const hasFilters =
    !!q ||
    !!industry ||
    !!lifecycle ||
    !!owner ||
    !!createdFrom ||
    !!createdTo ||
    Object.keys(custom).length > 0;

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('companies.title')}</h1>
        <CrmQuickCreate kind="company" />
      </div>

      <CompanyFilters
        q={q}
        industry={industry}
        lifecycle={lifecycle}
        owner={owner}
        createdFrom={createdFrom}
        createdTo={createdTo}
        custom={custom}
        advanced={rawFilters || undefined}
        sort={sort}
        industries={industries}
        lifecycles={lifecycles}
        owners={owners}
        customFields={customFields}
      />

      <FilterBuilder fields={builderFields} initial={advancedRules} baseQuery={query} />

      {tableRows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0 0 0 0 0
          </p>
          <h2>{t('companies.emptyTitle')}</h2>
          <p className="muted">{t('companies.emptySub')}</p>
          {hasFilters ? (
            <Link href="/app/crm/companies" className="btn btn-small">
              {t('common.clear')}
            </Link>
          ) : (
            <CrmQuickCreate kind="company" variant="empty" label={t('companies.emptyCta')} />
          )}
        </div>
      ) : (
        <>
          <CompaniesTable rows={tableRows} sort={sort} lifecycles={[...LIFECYCLE_STAGES]} locale={locale} />
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
