import { listSequences } from '@/lib/crm-sequences';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import {
  ACTIVITY_DATE_SORTS,
  LEAD_STATUSES,
  LIFECYCLE_STAGES,
  SOURCES,
  listCompanies,
  listContacts,
  listCustomFields,
  listSavedViews,
  parseCustom,
  parseFilterRules,
  type ContactFilter,
} from '@/lib/crm';
import { listMembers } from '@/lib/teams';
import { formatDate } from '@/lib/utils';
import ContactsFilters, { type ContactSort } from '@/components/crm/ContactsFilters';
import ContactsTable, { type ContactRow } from '@/components/crm/ContactsTable';
import type { BulkEditField } from '@/components/crm/BulkEditControls';
import { customBulkFields } from '@/components/crm/bulkFields';
import { customBuilderFields, customCells, customColumns, customFilterTypes, extraSortOptions } from '@/components/crm/customFieldViews';
import { isExtraSort, type ExtraSort } from '@/lib/crm-list-sort';
import { formatActivityDate } from '@/lib/crm-activity-dates';
import FilterBuilder, { type FilterBuilderField } from '@/components/crm/FilterBuilder';

import CrmQuickCreate from '@/components/crm/CrmQuickCreate';
import CrmPager from '@/components/crm/CrmPager';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { listTags, tagsForRecords } from '@/lib/crm-tags';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const SORTS: readonly ContactSort[] = [
  'newest', 'oldest', 'name', 'name_desc', 'email', 'email_desc', 'score', 'score_asc', ...ACTIVITY_DATE_SORTS,
];

interface ContactsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function parseCustomFilter(
  searchParams: Record<string, string | string[] | undefined>,
  viewQuery: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (key.startsWith('custom_') && typeof value === 'string' && value) {
      out[key.slice(7)] = value;
    }
  }
  if (!Object.keys(out).length) {
    for (const [key, value] of Object.entries(viewQuery)) {
      if (key.startsWith('custom_') && typeof value === 'string' && value) {
        out[key.slice(7)] = value;
      }
    }
  }
  return out;
}

export default async function ContactsPage(props: ContactsPageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const scope = await sessionScope(user);
  const t = await getTranslations({ locale, namespace: 'crm' });

  // Vista guardada activa: sus filtros sirven de default; los params explícitos ganan.
  const views = await listSavedViews(user.id, 'contacts');
  const activeView = views.find((v) => v.id === one(searchParams.view)) ?? null;
  const viewQuery = activeView ? parseCustom(activeView.query) : {};

  const q = one(searchParams.q) ?? str(viewQuery.q) ?? '';
  const lifecycle = one(searchParams.lifecycle) ?? str(viewQuery.lifecycle) ?? '';
  const leadStatus = one(searchParams.leadStatus) ?? str(viewQuery.leadStatus) ?? '';
  const source = one(searchParams.source) ?? str(viewQuery.source) ?? '';
  const owner = one(searchParams.owner) ?? str(viewQuery.owner) ?? '';
  const createdFrom = one(searchParams.createdFrom) ?? str(viewQuery.createdFrom) ?? '';
  const createdTo = one(searchParams.createdTo) ?? str(viewQuery.createdTo) ?? '';
  const tag = one(searchParams.tag) ?? str(viewQuery.tag) ?? '';
  const custom = parseCustomFilter(searchParams, viewQuery);
  const rawFilters = one(searchParams.filters) ?? str(viewQuery.filters) ?? '';
  const advancedRules = parseFilterRules(rawFilters);
  const sortParam = one(searchParams.sort) ?? str(viewQuery.sort) ?? 'newest';
  const page = Number(one(searchParams.page) ?? '1') || 1;

  const customFieldDefs = await listCustomFields(user.id, 'contacts');
  const customTypes = customFilterTypes(customFieldDefs);
  const sort: ContactSort =
    SORTS.includes(sortParam as ContactSort) || isExtraSort(sortParam, customTypes)
      ? (sortParam as ContactSort)
      : 'newest';

  const { rows, total } = await listContacts(user.id, {
    ownerScope: scope,
    q: q || undefined,
    lifecycle: lifecycle || undefined,
    leadStatus: leadStatus || undefined,
    source: source || undefined,
    owner: owner || undefined,
    createdFrom: createdFrom || undefined,
    createdTo: createdTo || undefined,
    tag: tag || undefined,
    custom: Object.keys(custom).length ? custom : undefined,
    filters: advancedRules.length ? advancedRules : undefined,
    customTypes,
    sort: sort as ContactFilter['sort'],
    page,
  });
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const [allTags, rowTags] = await Promise.all([
    listTags(user.id),
    tagsForRecords(user.id, 'contact', rows.map((r) => r.id)),
  ]);
  const tagOptions = allTags.map((x) => ({ id: x.id, name: x.name }));

  const companies = (await listCompanies(user.id, { pageSize: 200, sort: 'name', ownerScope: scope })).rows.map((c) => ({
    value: c.id,
    label: c.name,
  }));

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
    { key: 'email', label: t('filters.field.email'), type: 'text' },
    { key: 'company', label: t('filters.field.company'), type: 'select', options: companies },
    {
      key: 'lifecycle',
      label: t('filters.field.lifecycle'),
      type: 'select',
      options: LIFECYCLE_STAGES.map((v) => ({ value: v, label: t(`enums.lifecycle.${v}`) })),
    },
    {
      key: 'leadStatus',
      label: t('filters.field.leadStatus'),
      type: 'select',
      options: LEAD_STATUSES.map((v) => ({ value: v, label: t(`enums.leadStatus.${v}`) })),
    },
    { key: 'owner', label: t('filters.field.owner'), type: 'select', options: owners },
    {
      key: 'source',
      label: t('filters.field.source'),
      type: 'select',
      options: SOURCES.map((v) => ({ value: v as string, label: t(`enums.source.${v}`) })),
    },
    { key: 'score', label: t('scoring.column'), type: 'number' },
    { key: 'created', label: t('filters.field.created'), type: 'date' },
    { key: 'lastActivity', label: t('activityDates.lastActivity'), type: 'date' },
    { key: 'lastContacted', label: t('activityDates.lastContacted'), type: 'date' },
    { key: 'nextActivity', label: t('activityDates.nextActivity'), type: 'date' },
    {
      key: 'tag',
      label: t('filters.field.tag'),
      type: 'select',
      options: allTags.map((x) => ({ value: x.id, label: x.name })),
    },
    ...customBuilderFields(customFieldDefs, { yes: t('common.yes'), no: t('common.no') }, owners),
  ];

  const cellCtx = { locale, yes: t('common.yes'), no: t('common.no'), users: new Map(owners.map((o) => [o.value, o.label])) };
  const tableRows: ContactRow[] = rows.map((c) => ({
    id: c.id,
    name: `${c.first_name} ${c.last_name}`.trim() || c.email || '—',
    email: c.email,
    ownerId: c.owner_id,
    phone: c.phone,
    companyName: c.company_name,
    companyId: c.company_id,
    lifecycle: c.lifecycle_stage,
    leadStatus: c.lead_status,
    source: c.source,
    score: c.score ?? 0,
    created: formatDate(c.created_at, locale),
    lastActivity: formatActivityDate(c.last_activity_at, locale),
    lastContacted: formatActivityDate(c.last_contacted_at, locale),
    nextActivity: formatActivityDate(c.next_activity_at, locale),
    tags: rowTags.get(c.id) ?? [],
    custom: customCells(customFieldDefs, parseCustom(c.custom), cellCtx),
  }));

  // Propiedades de la edición en masa (owner primero: es la acción más común).
  const bulkFields: BulkEditField[] = [
    { key: 'ownerId', label: t('contacts.form.owner'), type: 'select', options: owners, nullable: true },
    {
      key: 'lifecycleStage',
      label: t('contacts.form.lifecycle'),
      type: 'select',
      options: LIFECYCLE_STAGES.map((v) => ({ value: v, label: t(`enums.lifecycle.${v}`) })),
    },
    {
      key: 'leadStatus',
      label: t('contacts.form.leadStatus'),
      type: 'select',
      options: LEAD_STATUSES.map((v) => ({ value: v, label: t(`enums.leadStatus.${v}`) })),
    },
    {
      key: 'source',
      label: t('contacts.form.source'),
      type: 'select',
      options: SOURCES.map((v) => ({ value: v as string, label: t(`enums.source.${v}`) })),
    },
    { key: 'companyId', label: t('contacts.form.company'), type: 'select', options: companies, nullable: true },
    { key: 'jobTitle', label: t('contacts.form.jobTitle'), type: 'text' },
    { key: 'city', label: t('contacts.form.city'), type: 'text' },
    { key: 'country', label: t('contacts.form.country'), type: 'text' },
    ...customBulkFields(customFieldDefs, { yes: t('common.yes'), no: t('common.no') }, owners),
  ];

  const query: Record<string, string> = {};
  if (q) query.q = q;
  if (lifecycle) query.lifecycle = lifecycle;
  if (leadStatus) query.leadStatus = leadStatus;
  if (source) query.source = source;
  if (owner) query.owner = owner;
  if (tag) query.tag = tag;
  if (createdFrom) query.createdFrom = createdFrom;
  if (createdTo) query.createdTo = createdTo;
  Object.entries(custom).forEach(([k, v]) => {
    if (v) query[`custom_${k}`] = v;
  });
  if (rawFilters) query.filters = rawFilters;
  if (sort !== 'newest') query.sort = sort;
  if (activeView) query.view = activeView.id;

  const hasFilters =
    !!q ||
    !!lifecycle ||
    !!leadStatus ||
    !!source ||
    !!owner ||
    !!tag ||
    !!createdFrom ||
    !!createdTo ||
    Object.keys(custom).length > 0;

  return (
    <div className="ui-page crm-list-page">
      <PageHeader
        title={t('contacts.title')}
        actions={<CrmQuickCreate kind="contact" buttonClassName="btn btn-primary btn-sm" label={t('record.createContact')} />}
      />

      <ContactsFilters
        q={q}
        lifecycle={lifecycle}
        leadStatus={leadStatus}
        source={source}
        owner={owner}
        tag={tag}
        tags={tagOptions}
        createdFrom={createdFrom}
        createdTo={createdTo}
        custom={custom}
        advanced={rawFilters || undefined}
        sort={sort}
        lifecycles={[...LIFECYCLE_STAGES]}
        leadStatuses={[...LEAD_STATUSES]}
        sources={[...SOURCES]}
        owners={owners}
        customFields={customFields}
        views={views.map((v) => ({ id: v.id, name: v.name }))}
        activeViewId={activeView?.id ?? null}
        extraSorts={extraSortOptions(customFieldDefs, {
            ownerAsc: t('listSort.ownerAsc'),
            ownerDesc: t('listSort.ownerDesc'),
            asc: (label) => t('listSort.fieldAsc', { label }),
            desc: (label) => t('listSort.fieldDesc', { label }),
          })}
      >
        <FilterBuilder fields={builderFields} initial={advancedRules} baseQuery={query} />
      </ContactsFilters>

      {tableRows.length === 0 ? (
        hasFilters || advancedRules.length > 0 || activeView ? (
          <EmptyState
            title={t('record.empty.noMatchTitle')}
            body={t('record.empty.noMatchBody')}
            action={{ label: t('common.clear'), href: '/app/crm/contacts' }}
          />
        ) : (
          <EmptyState
            title={t('record.empty.contactsTitle')}
            body={t('record.empty.contactsBody')}
            action={<CrmQuickCreate kind="contact" variant="empty" buttonClassName="btn btn-primary" label={t('record.createContact')} />}
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
          <ContactsTable
            rows={tableRows}
            customColumns={customColumns(customFieldDefs)}
            lifecycles={[...LIFECYCLE_STAGES]}
            leadStatuses={[...LEAD_STATUSES]}
            sources={[...SOURCES]}
            sort={sort}
            companies={companies}
            locale={locale}
            sequences={(await listSequences(user.id)).map((sq) => ({ id: sq.id, name: sq.name }))}
            allTags={tagOptions}
            bulkFields={bulkFields}
            owners={owners}
          />
          <CrmPager pathname="/app/crm/contacts" query={query} page={page} pages={pages} total={total} locale={locale} />
        </>
      )}
    </div>
  );
}
