import { listSequences } from '@/lib/crm-sequences';
import { fieldAccessFor, sessionFieldViewer } from '@/lib/crm-field-perms';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { listsForViewer } from '@/lib/crm-list-access';
import { PAGE_SIZES, parsePageSize } from '@/lib/crm-page-size';
import PageSizeSelect from '@/components/crm/PageSizeSelect';
import { workspaceTeamId } from '@/lib/workspace';
import { sessionScope } from '@/lib/crm-visibility';
import {
  ACTIVITY_DATE_SORTS,
  LEAD_STATUSES,
  LIFECYCLE_STAGES,
  SOURCES,
  listCompanies,
  listContacts,
  parseCustom,
  type ContactFilter,
} from '@/lib/crm';
import { listMembers } from '@/lib/teams';
import { formatDate } from '@/lib/utils';
import ContactsFilters, { type ContactSort } from '@/components/crm/ContactsFilters';
import ContactsTable, { type ContactRow } from '@/components/crm/ContactsTable';
import type { BulkEditField } from '@/components/crm/BulkEditControls';
import { customBulkFields } from '@/components/crm/bulkFields';
import { customCells, customColumns, customFilterTypes, extraSortOptions } from '@/components/crm/customFieldViews';
import { isExtraSort, type ExtraSort } from '@/lib/crm-list-sort';
import { formatActivityDate } from '@/lib/crm-activity-dates';
import AdvancedFilters, { AdvancedFilterChips } from '@/components/crm/AdvancedFilters';
import { contactFilterFields, filterFieldShapes } from '@/components/crm/advancedFilterFields';
import { countFilterRules, serializeFilterModel } from '@/lib/crm-filter-model';
import { listFilterModel } from '@/lib/crm-filter-http';
import { getUserTimeZone } from '@/lib/user-tz';
import { listScores } from '@/lib/crm-scoring';
import { scoreTier, tierFilterValue, tierRanges } from '@/lib/crm-scoring-schema';

import CrmQuickCreate from '@/components/crm/CrmQuickCreate';
import ViewTabs from '@/components/crm/ViewTabs';
import { TableColumnsProvider } from '@/components/crm/EditColumns';
import { loadListViews } from '@/components/crm/viewTabsData';
import CrmPager from '@/components/crm/CrmPager';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { listTags, tagsForRecords } from '@/lib/crm-tags';

export const dynamic = 'force-dynamic';

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

/** Filtros por custom field del estado del listado (`custom_<name>`). */
function customFromState(state: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(state)) {
    if (key.startsWith('custom_') && value) out[key.slice(7)] = value;
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
  // Las lecturas que no dependen de la lista de contactos arrancan juntas (en Turso cada query
  // es una ida y vuelta); se esperan donde se usan.
  const scopeP = sessionScope(user);
  const fieldAccessP = fieldAccessFor(sessionFieldViewer(user), 'contacts');
  const tagsP = listTags(user.id);
  const scoresP = listScores(user.id);
  const companiesP = scopeP.then((scope) => listCompanies(user.id, { pageSize: 200, sort: 'name', ownerScope: scope }));
  const membersP = workspaceTeamId(user) ? listMembers(workspaceTeamId(user)!) : null;
  const sequencesP = listSequences(user.id);
  // "Agregar a lista": las estáticas que la persona ve.
  const listsP = scopeP.then((scope) => listsForViewer(sessionFieldViewer(user), scope));
  for (const p of [scopeP, fieldAccessP, tagsP, scoresP, companiesP, membersP, sequencesP, listsP]) p?.catch(() => {});
  const scope = await scopeP;
  const t = await getTranslations({ locale, namespace: 'crm' });

  // Permisos por campo: sin los ocultos; los de solo lectura no se editan en masa.
  const fieldAccess = await fieldAccessP;
  const customFieldDefs = fieldAccess.visible;

  // Vista activa (pestaña): sus filtros, orden y columnas sirven de default y los params
  // explícitos ganan. Lo que toca campos ocultos para esta persona ya viene quitado.
  const views = await loadListViews(user, 'contacts', searchParams, fieldAccess.hidden, (k) => t(k));
  const { state } = views;
  const q = state.q ?? '';
  const lifecycle = state.lifecycle ?? '';
  const leadStatus = state.leadStatus ?? '';
  const source = state.source ?? '';
  const owner = state.owner ?? '';
  const createdFrom = state.createdFrom ?? '';
  const createdTo = state.createdTo ?? '';
  const activityFrom = state.activityFrom ?? '';
  const activityTo = state.activityTo ?? '';
  const noActivity = state.noActivity === '1';
  const qf = state.qf ?? '';
  const tag = state.tag ?? '';
  const custom = customFromState(state);
  const rawFilters = state.filters ?? '';
  const sortParam = state.sort ?? 'newest';
  const page = Number(one(searchParams.page) ?? '1') || 1;
  const pageSize = parsePageSize(one(searchParams.per));
  const timeZone = await getUserTimeZone();
  const customTypes = customFilterTypes(customFieldDefs);
  const sort: ContactSort =
    SORTS.includes(sortParam as ContactSort) || isExtraSort(sortParam, customTypes)
      ? (sortParam as ContactSort)
      : 'newest';

  // Las propiedades del panel de filtros avanzados se arman antes de consultar: el filtro de la URL
  // se valida contra ellas (una regla que el panel no ofrece ni se aplica ni aparece como chip).
  const [allTags, scores, companyRows] = await Promise.all([tagsP, scoresP, companiesP]);
  const primaryScore = scores.find((s) => s.isPrimary);
  const tagOptions = allTags.map((x) => ({ id: x.id, name: x.name }));
  const companies = companyRows.rows.map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const teamMembers = membersP
    ? await membersP
    : [{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }];
  const owners = teamMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));
  const filterFields = contactFilterFields({
    t: (k) => t(k),
    owners,
    tags: allTags.map((x) => ({ value: x.id, label: x.name })),
    customDefs: customFieldDefs,
    companies,
    lifecycles: LIFECYCLE_STAGES.map((v) => ({ value: v, label: t(`enums.lifecycle.${v}`) })),
    leadStatuses: LEAD_STATUSES.map((v) => ({ value: v, label: t(`enums.leadStatus.${v}`) })),
    sources: SOURCES.map((v) => ({ value: v as string, label: t(`enums.source.${v}`) })),
    scores: [
      { key: 'score', label: primaryScore?.name ?? t('scoring.column') },
      // Los otros scores por puntos y cada score con umbrales por tramo (Hot, Warm…).
      ...scores.filter((s) => !s.isPrimary).map((s) => ({ key: `score:${s.id}`, label: s.name })),
      ...scores
        .filter((s) => s.thresholds.length > 0)
        .map((s) => ({
          key: `scoreTier:${s.id}`,
          label: t('scoring.tierOf', { name: s.name }),
          tiers: tierRanges(s.thresholds).map((r) => ({ value: tierFilterValue(r), label: r.label })),
        })),
    ],
  });
  // El mismo filtro que aplican "Seleccionar todos" y "Exportar la vista" (lib/crm-filter-http.ts).
  const filterModel = listFilterModel(rawFilters, 'contacts', {
    customTypes,
    env: { viewerId: realUserId(user), timeZone, strictCustom: true },
    shapes: filterFieldShapes(filterFields),
  });
  const advancedCount = countFilterRules(filterModel);
  const filtersParam = serializeFilterModel(filterModel);

  const { rows, total } = await listContacts(user.id, {
    ownerScope: scope,
    q: q || undefined,
    lifecycle: lifecycle || undefined,
    leadStatus: leadStatus || undefined,
    source: source || undefined,
    owner: owner || undefined,
    // Días en la zona horaria de la persona (filterEnv.timeZone; lib/crm.ts appendDayRange).
    createdFrom: createdFrom || undefined,
    createdTo: createdTo || undefined,
    activityFrom: activityFrom || undefined,
    activityTo: activityTo || undefined,
    activityNone: noActivity || undefined,
    tag: tag || undefined,
    custom: Object.keys(custom).length
      ? Object.fromEntries(Object.entries(custom).filter(([k]) => customFieldDefs.some((d) => d.name === k)))
      : undefined,
    filters: advancedCount ? filterModel : undefined,
    filterEnv: { viewerId: realUserId(user), timeZone, strictCustom: true },
    customTypes,
    sort: sort as ContactFilter['sort'],
    page,
    pageSize,
  });
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const rowTags = await tagsForRecords(user.id, 'contact', rows.map((r) => r.id));

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
  const tableRows: ContactRow[] = rows.map((c) => ({
    id: c.id,
    name: `${c.first_name} ${c.last_name}`.trim() || c.email || '—',
    email: c.email,
    ownerId: c.owner_id,
    phone: c.phone,
    companyName: c.company_name,
    companyId: c.company_id,
    companyPrivate: !!c.company_private,
    lifecycle: c.lifecycle_stage,
    leadStatus: c.lead_status,
    source: c.source,
    score: c.score ?? 0,
    scoreTier: primaryScore ? scoreTier(c.score ?? 0, primaryScore.thresholds) ?? undefined : undefined,
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
    ...customBulkFields(customFieldDefs.filter((d) => d.access === 'edit'), { yes: t('common.yes'), no: t('common.no') }, owners),
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
  if (activityFrom) query.activityFrom = activityFrom;
  if (activityTo) query.activityTo = activityTo;
  if (noActivity) query.noActivity = '1';
  Object.entries(custom).forEach(([k, v]) => {
    if (v) query[`custom_${k}`] = v;
  });
  if (filtersParam) query.filters = filtersParam;
  if (sort !== 'newest') query.sort = sort;
  // Estado de la vista (para guardarla) y params que conservan los links del listado.
  const viewState = { ...query };
  if (qf) {
    viewState.qf = qf;
    query.qf = qf;
  }
  if (state.cols) viewState.cols = state.cols;
  if (state.freeze) viewState.freeze = state.freeze;
  if (state.widths) viewState.widths = state.widths;
  Object.assign(query, views.keep);
  // El tamaño de página es de la URL (no de la vista): lo conservan los links del listado.
  if (pageSize !== PAGE_SIZES[0]) query.per = String(pageSize);
  const keep = pageSize !== PAGE_SIZES[0] ? { ...views.keep, per: String(pageSize) } : views.keep;

  const hasFilters =
    !!q ||
    !!lifecycle ||
    !!leadStatus ||
    !!source ||
    !!owner ||
    !!tag ||
    !!createdFrom ||
    !!createdTo ||
    !!activityFrom ||
    !!activityTo ||
    noActivity ||
    Object.keys(custom).length > 0;
  const admin = isWorkspaceAdmin(user);

  return (
    <div className="ui-page crm-list-page">
      <PageHeader
        title={t('contacts.title')}
        actions={
          <>
            <Link href="/app/crm/contacts/duplicates" className="btn btn-secondary btn-sm" data-testid="contacts-find-duplicates">
              {t('contacts.dupes.find')}
            </Link>
            <CrmQuickCreate kind="contact" buttonClassName="btn btn-primary btn-sm" label={t('record.createContact')} />
          </>
        }
      />

      <ViewTabs
        entity="contacts"
        pathname="/app/crm/contacts"
        tabs={views.tabs}
        activeKey={views.activeKey}
        defaultKey={views.defaultKey}
        activeExtra={views.activeExtra}
        modified={views.modified}
        state={viewState}
        teams={views.teams}
      />

      {/* Columnas (orden, fija, anchos) para "Editar columnas" de la barra y para la tabla. */}
      <TableColumnsProvider
        entity="contacts"
        customColumns={customColumns(customFieldDefs)}
        viewCols={state.cols}
        viewFreeze={state.freeze === '1' ? true : state.freeze === '0' ? false : undefined}
        viewWidths={state.widths}
        filters={{ fields: filterFields, model: filterModel, baseQuery: query, quick: [lifecycle && 'lifecycle', leadStatus && 'leadStatus', source && 'source', owner && 'owner', tag && 'tag', (createdFrom || createdTo) && 'created', (activityFrom || activityTo || noActivity) && 'lastActivity'].filter((k): k is string => !!k) }}
      >
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
        activityFrom={activityFrom}
        activityTo={activityTo}
        noActivity={noActivity}
        qf={qf}
        canExport={admin}
        custom={custom}
        advanced={filtersParam || undefined}
        sort={sort}
        lifecycles={[...LIFECYCLE_STAGES]}
        leadStatuses={[...LEAD_STATUSES]}
        sources={[...SOURCES]}
        owners={owners}
        customFields={customFields}
        keep={keep}
        extraSorts={extraSortOptions(customFieldDefs, {
            ownerAsc: t('listSort.ownerAsc'),
            ownerDesc: t('listSort.ownerDesc'),
            asc: (label) => t('listSort.fieldAsc', { label }),
            desc: (label) => t('listSort.fieldDesc', { label }),
          })}
      >
        <AdvancedFilters fields={filterFields} model={filterModel} baseQuery={query} />
      </ContactsFilters>
      <AdvancedFilterChips fields={filterFields} model={filterModel} baseQuery={query} />

      {tableRows.length === 0 ? (
        hasFilters || advancedCount > 0 || views.activeKey !== 'all' ? (
          <EmptyState
            title={t('record.empty.noMatchTitle')}
            body={t('record.empty.noMatchBody')}
            action={{ label: t('common.clear'), href: '/app/crm/contacts?sv=all' }}
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
            sequences={(await sequencesP).map((sq) => ({ id: sq.id, name: sq.name }))}
            allTags={tagOptions}
            bulkFields={bulkFields}
            owners={owners}
            lists={(await listsP).filter((l) => l.kind === 'static').map((l) => ({ id: l.id, name: l.name }))}
            canDelete={admin}
            canExport={admin}
            total={total}
          />
          <div className="hs-pager-row">
            <CrmPager pathname="/app/crm/contacts" query={query} page={page} pages={pages} total={total} locale={locale} />
            <PageSizeSelect value={pageSize} />
          </div>
        </>
      )}
      </TableColumnsProvider>
    </div>
  );
}
