import { getTranslations } from 'next-intl/server';
import { fieldAccessFor, sessionFieldViewer } from '@/lib/crm-field-perms';
import { Link } from '@/i18n/navigation';
import { realUserId, requireUser } from '@/lib/session';
import { workspaceTeamId } from '@/lib/workspace';
import { sessionScope } from '@/lib/crm-visibility';
import { getDb } from '@/lib/db';
import {
  ACTIVITY_DATE_SORTS,
  LIFECYCLE_STAGES,
  listCompanies,
  type CompanyFilter,
  parseCustom,
} from '@/lib/crm';
import type { BulkEditField } from '@/components/crm/BulkEditControls';
import { customBulkFields } from '@/components/crm/bulkFields';
import { customCells, customColumns, customFilterTypes, extraSortOptions } from '@/components/crm/customFieldViews';
import { isExtraSort, type ExtraSort } from '@/lib/crm-list-sort';
import { formatActivityDate } from '@/lib/crm-activity-dates';
import { listMembers } from '@/lib/teams';
import { formatDate } from '@/lib/utils';
import CompanyFilters from '@/components/crm/CompanyFilters';
import CompaniesTable, { type CompanyRow } from '@/components/crm/CompaniesTable';
import { listTags, tagsForRecords } from '@/lib/crm-tags';
import AdvancedFilters, { AdvancedFilterChips } from '@/components/crm/AdvancedFilters';
import { companyFilterFields, filterFieldShapes } from '@/components/crm/advancedFilterFields';
import { countFilterRules, parseFilterModel, sanitizeFilterModel, serializeFilterModel } from '@/lib/crm-filter-model';
import { getUserTimeZone } from '@/lib/user-tz';

import CrmQuickCreate from '@/components/crm/CrmQuickCreate';
import CrmPager from '@/components/crm/CrmPager';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';

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
  const scope = await sessionScope(user);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const q = one(searchParams.q) ?? '';
  const industry = one(searchParams.industry) ?? '';
  const lifecycle = one(searchParams.lifecycle) ?? '';
  const owner = one(searchParams.owner) ?? '';
  const createdFrom = one(searchParams.createdFrom) ?? '';
  const createdTo = one(searchParams.createdTo) ?? '';
  const tag = one(searchParams.tag) ?? '';
  const custom = parseCustomFilter(searchParams);
  const page = Number(one(searchParams.page) ?? '1') || 1;
  const rawFilters = one(searchParams.filters) ?? '';

  // Permisos por campo: sin los ocultos; los de solo lectura no se editan en masa.
  const customFieldDefs = (await fieldAccessFor(sessionFieldViewer(user), 'companies')).visible;
  const customTypes = customFilterTypes(customFieldDefs);
  const sortParam = one(searchParams.sort);
  const COMPANY_SORTS: readonly string[] = ['oldest', 'name', 'name_desc', ...ACTIVITY_DATE_SORTS];
  const sort: NonNullable<CompanyFilter['sort']> =
    COMPANY_SORTS.includes(sortParam ?? '') || isExtraSort(sortParam, customTypes)
      ? (sortParam as NonNullable<CompanyFilter['sort']>)
      : 'newest';

  // Industrias presentes para el filtro (select).
  const industries = (
    (await getDb()
      .prepare(
        `SELECT DISTINCT industry FROM crm_companies
         WHERE user_id = ? AND industry != '' ORDER BY industry COLLATE NOCASE`,
      )
      .all(user.id)) as Array<{ industry: string }>
  ).map((r) => r.industry);

  const lifecycles = LIFECYCLE_STAGES.map((value) => ({ value, label: t(`enums.lifecycle.${value}`) }));

  const teamMembers = workspaceTeamId(user)
    ? await listMembers(workspaceTeamId(user)!)
    : [{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }];
  const owners = teamMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));

  const allTags = await listTags(user.id);
  const tagOptions = allTags.map((x) => ({ id: x.id, name: x.name }));

  // Las propiedades del panel de filtros avanzados se arman antes de consultar: el filtro de la URL
  // se valida contra ellas (una regla que el panel no ofrece ni se aplica ni aparece como chip).
  const filterFields = companyFilterFields({
    t: (k) => t(k),
    owners,
    tags: allTags.map((x) => ({ value: x.id, label: x.name })),
    customDefs: customFieldDefs,
    industries: industries.map((ind) => ({ value: ind, label: ind })),
    lifecycles,
  });
  const filterModel = sanitizeFilterModel(parseFilterModel(rawFilters), filterFieldShapes(filterFields));
  const advancedCount = countFilterRules(filterModel);
  const filtersParam = serializeFilterModel(filterModel);

  const { rows, total } = await listCompanies(user.id, {
    ownerScope: scope,
    q: q || undefined,
    industry: industry || undefined,
    lifecycle: lifecycle || undefined,
    owner: owner || undefined,
    createdFrom: createdFrom || undefined,
    createdTo: createdTo || undefined,
    tag: tag || undefined,
    custom: Object.keys(custom).length
      ? Object.fromEntries(Object.entries(custom).filter(([k]) => customFieldDefs.some((d) => d.name === k)))
      : undefined,
    filters: advancedCount ? filterModel : undefined,
    filterEnv: { viewerId: realUserId(user), timeZone: await getUserTimeZone(), strictCustom: true },
    customTypes,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });

  // Deals por empresa (asociaciones deal ↔ company), solo para la página actual.
  const dealCounts = new Map<string, number>();
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const ph = ids.map(() => '?').join(',');
    const counts = (await getDb()
      .prepare(
        `SELECT dc.company_id AS cid, COUNT(DISTINCT d.id) AS c
         FROM crm_deal_companies dc
         JOIN crm_deals d ON d.id = dc.deal_id
         WHERE dc.company_id IN (${ph}) AND d.user_id = ?
         GROUP BY dc.company_id`,
      )
      .all(...ids, user.id)) as Array<{ cid: string; c: number }>;
    for (const r of counts) dealCounts.set(r.cid, r.c);
  }
  const rowTags = await tagsForRecords(user.id, 'company', rows.map((r) => r.id));
  // Nombre de la empresa madre de cada fila (columna "Parent company").
  const parentIds = [...new Set(rows.map((r) => r.parent_company_id).filter((v): v is string => !!v))];
  const parentNames = new Map<string, string>();
  if (parentIds.length) {
    const prows = (await getDb()
      .prepare(`SELECT id, name FROM crm_companies WHERE user_id = ? AND id IN (${parentIds.map(() => '?').join(',')})`)
      .all(user.id, ...parentIds)) as Array<{ id: string; name: string }>;
    for (const r of prows) parentNames.set(r.id, r.name);
  }

  const lifecycleLabel = (v: string): string =>
    (LIFECYCLE_STAGES as readonly string[]).includes(v) ? t(`enums.lifecycle.${v}`) : v;

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

  const cellCtx = { locale, yes: t('common.yes'), no: t('common.no'), users: new Map(owners.map((o) => [o.value, o.label])) };
  const tableRows: CompanyRow[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    ownerId: c.owner_id,
    industry: c.industry,
    phone: c.phone,
    location: [c.city, c.country].filter(Boolean).join(', '),
    contacts: c.contact_count,
    deals: dealCounts.get(c.id) ?? 0,
    lifecycle: c.lifecycle_stage,
    lifecycleLabel: lifecycleLabel(c.lifecycle_stage),
    created: formatDate(c.created_at, locale),
    lastActivity: formatActivityDate(c.last_activity_at, locale),
    lastContacted: formatActivityDate(c.last_contacted_at, locale),
    nextActivity: formatActivityDate(c.next_activity_at, locale),
    tags: rowTags.get(c.id) ?? [],
    custom: customCells(customFieldDefs, parseCustom(c.custom), cellCtx),
    parentName: c.parent_company_id ? parentNames.get(c.parent_company_id) ?? null : null,
  }));

  // Propiedades de la edición en masa (owner primero: es la acción más común).
  const bulkFields: BulkEditField[] = [
    { key: 'ownerId', label: t('companies.form.owner'), type: 'select', options: owners, nullable: true },
    { key: 'lifecycleStage', label: t('companies.form.lifecycle'), type: 'select', options: lifecycles },
    { key: 'industry', label: t('companies.form.industry'), type: 'text' },
    { key: 'employees', label: t('companies.form.employees'), type: 'number', nullable: true },
    { key: 'city', label: t('companies.form.city'), type: 'text' },
    { key: 'country', label: t('companies.form.country'), type: 'text' },
    ...customBulkFields(customFieldDefs.filter((d) => d.access === 'edit'), { yes: t('common.yes'), no: t('common.no') }, owners),
  ];

  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const currentPage = Math.min(Math.max(page, 1), pages);
  const query: Record<string, string> = {};
  if (q) query.q = q;
  if (industry) query.industry = industry;
  if (lifecycle) query.lifecycle = lifecycle;
  if (owner) query.owner = owner;
  if (tag) query.tag = tag;
  if (createdFrom) query.createdFrom = createdFrom;
  if (createdTo) query.createdTo = createdTo;
  Object.entries(custom).forEach(([k, v]) => {
    if (v) query[`custom_${k}`] = v;
  });
  if (filtersParam) query.filters = filtersParam;
  if (sort !== 'newest') query.sort = sort;

  const hasFilters =
    !!q ||
    !!industry ||
    !!lifecycle ||
    !!owner ||
    !!tag ||
    !!createdFrom ||
    !!createdTo ||
    Object.keys(custom).length > 0;

  return (
    <div className="ui-page crm-list-page">
      <PageHeader
        title={t('companies.title')}
        actions={
          <>
            <Link href="/app/crm/companies/duplicates" className="btn btn-secondary btn-sm">
              {t('companies.dupes.find')}
            </Link>
            <CrmQuickCreate kind="company" buttonClassName="btn btn-primary btn-sm" label={t('record.createCompany')} />
          </>
        }
      />

      <CompanyFilters
        q={q}
        industry={industry}
        lifecycle={lifecycle}
        owner={owner}
        tag={tag}
        tags={tagOptions}
        createdFrom={createdFrom}
        createdTo={createdTo}
        custom={custom}
        advanced={filtersParam || undefined}
        sort={sort}
        industries={industries}
        lifecycles={lifecycles}
        owners={owners}
        customFields={customFields}
        extraSorts={extraSortOptions(customFieldDefs, {
            ownerAsc: t('listSort.ownerAsc'),
            ownerDesc: t('listSort.ownerDesc'),
            asc: (label) => t('listSort.fieldAsc', { label }),
            desc: (label) => t('listSort.fieldDesc', { label }),
          })}
      >
        <AdvancedFilters fields={filterFields} model={filterModel} baseQuery={query} />
      </CompanyFilters>
      <AdvancedFilterChips fields={filterFields} model={filterModel} baseQuery={query} />

      {tableRows.length === 0 ? (
        hasFilters || advancedCount > 0 ? (
          <EmptyState
            title={t('record.empty.noMatchTitle')}
            body={t('record.empty.noMatchBody')}
            action={{ label: t('common.clear'), href: '/app/crm/companies' }}
          />
        ) : (
          <EmptyState
            title={t('record.empty.companiesTitle')}
            body={t('record.empty.companiesBody')}
            action={<CrmQuickCreate kind="company" variant="empty" buttonClassName="btn btn-primary" label={t('record.createCompany')} />}
            secondary={
              <>
                <Link href="/app/crm/settings?tab=import&from=hubspot">{t('record.empty.bringFromHubspot')}</Link>
                {' · '}
                <Link href="/app/crm/settings?tab=import">{t('record.empty.importCsv')}</Link>
              </>
            }
          />
        )
      ) : (
        <>
          <CompaniesTable
            rows={tableRows}
            customColumns={customColumns(customFieldDefs)}
            sort={sort}
            lifecycles={[...LIFECYCLE_STAGES]}
            locale={locale}
            allTags={tagOptions}
            bulkFields={bulkFields}
            owners={owners}
          />
          <CrmPager pathname="/app/crm/companies" query={query} page={currentPage} pages={pages} total={total} locale={locale} />
        </>
      )}
    </div>
  );
}
