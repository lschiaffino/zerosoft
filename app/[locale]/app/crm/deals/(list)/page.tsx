import { dealScoresFor } from '@/lib/crm-ai';
import ScoreDealsButton from '@/components/crm/ScoreDealsButton';
import { getTranslations } from 'next-intl/server';
import { fieldAccessFor, redactRow, sessionFieldViewer } from '@/lib/crm-field-perms';
import { Link } from '@/i18n/navigation';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { workspaceTeamId } from '@/lib/workspace';
import { countPendingFor } from '@/lib/crm-approvals';
import { scopeAnd, sessionScope } from '@/lib/crm-visibility';
import { getDb } from '@/lib/db';
import {
  ACTIVITY_DATE_SORTS,
  listDeals,
  listDealsForBoard,
  listPipelinesWithStages,
  PRIORITIES,
  SOURCES,
  type BoardStage,
  parseCustom,
} from '@/lib/crm';
import { listMembers } from '@/lib/teams';
import { formatDate, parseDbUtc } from '@/lib/utils';
import DealsBoard from '@/components/crm/DealsBoard';
import DealsFilters from '@/components/crm/DealsFilters';
import DealsTable, { type DealRow } from '@/components/crm/DealsTable';
import { TableColumnsProvider } from '@/components/crm/EditColumns';
import AdvancedFilters, { AdvancedFilterChips } from '@/components/crm/AdvancedFilters';
import { dealFilterFields, filterFieldShapes } from '@/components/crm/advancedFilterFields';
import { countFilterRules, serializeFilterModel } from '@/lib/crm-filter-model';
import { listFilterModel } from '@/lib/crm-filter-http';
import { getUserTimeZone } from '@/lib/user-tz';
import PipelineMenu from '@/components/crm/PipelineMenu';

import CrmQuickCreate from '@/components/crm/CrmQuickCreate';
import ViewTabs from '@/components/crm/ViewTabs';
import { loadListViews } from '@/components/crm/viewTabsData';
import CrmPager from '@/components/crm/CrmPager';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { listTags, tagsForRecords } from '@/lib/crm-tags';
import { getCurrencyContext } from '@/lib/crm-currency';
import { convertAmount, formatMoney } from '@/lib/crm-money';
import { dbTimestamp, dealIdleDays } from '@/lib/crm-rotting';
import { COMMON_CURRENCIES, DEAL_TYPES } from '@/lib/crm-constants';
import { FORECAST_CATEGORIES } from '@/lib/crm-forecast';
import type { BulkEditField } from '@/components/crm/BulkEditControls';
import { customBulkFields } from '@/components/crm/bulkFields';
import { customCells, customColumns, customFilterTypes, extraSortOptions } from '@/components/crm/customFieldViews';
import { isExtraSort, type ExtraSort } from '@/lib/crm-list-sort';
import { formatActivityDate } from '@/lib/crm-activity-dates';
import { redactStagesFor } from '@/lib/crm-stage-move';
import { resolveCardLayout } from '@/lib/crm-layouts';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const DEAL_SORTS = [
  'newest',
  'oldest',
  'amount',
  'amount_asc',
  'close_date',
  'close_date_desc',
  ...ACTIVITY_DATE_SORTS,
] as const;
type DealSort = (typeof DEAL_SORTS)[number] | ExtraSort;

interface DealsPageProps {
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

function formatAmount(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatCloseDate(cd: string | null, locale: string): string {
  if (!cd) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${cd.slice(0, 10)}T00:00:00Z`),
  );
}

/**
 * Anota cada deal del board con age_days (desde created_at) e idle_days
 * (desde la última actividad o email con sus contactos, o el último update).
 */
function withAges(stages: BoardStage[]): BoardStage[] {
  const nowMs = Date.now();
  return stages.map((col) => ({
    ...col,
    deals: col.deals.map((d) => ({
      ...d,
      age_days: Math.max(0, Math.floor((nowMs - dbTimestamp(d.created_at)) / 86_400_000)),
      idle_days: dealIdleDays(d, nowMs),
    })),
  }));
}

export default async function DealsPage(props: DealsPageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  // Lecturas independientes, juntas (en Turso cada query es una ida y vuelta); se esperan donde se usan.
  const membersP = workspaceTeamId(user) ? listMembers(workspaceTeamId(user)!) : null;
  const fieldAccessP = fieldAccessFor(sessionFieldViewer(user), 'deals');
  const tagsCurrencyP = Promise.all([listTags(user.id), getCurrencyContext(user.id)]);
  for (const p of [membersP, fieldAccessP, tagsCurrencyP]) p?.catch(() => {});
  const [pendingApprovals, scope, pipelines] = await Promise.all([
    countPendingFor(user.id, realUserId(user)),
    sessionScope(user),
    listPipelinesWithStages(user.id),
  ]);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const pipelineParam = one(searchParams.pipeline);
  const pipeline = pipelines.find((p) => p.id === pipelineParam) ?? pipelines[0];
  const view = one(searchParams.view) === 'table' ? 'table' : 'board';

  const priorities = PRIORITIES.map((value) => ({ value, label: t(`enums.priority.${value}`) }));
  const sources = SOURCES.map((value) => ({ value, label: t(`enums.source.${value}`) }));

  if (!pipeline) {
    return (
      <div className="ui-page crm-list-page">
        <PageHeader title={t('deals.title')} />
        <EmptyState
          title={t('record.empty.noPipelineTitle')}
          body={t('record.empty.noPipelineBody')}
          action={{ label: t('record.empty.noPipelineCta'), href: '/app/crm/settings' }}
        />
      </div>
    );
  }

  const viewQuery = (p: string, v: 'board' | 'table'): Record<string, string> =>
    v === 'table' ? { pipeline: p, view: 'table' } : { pipeline: p };

  const teamMembers = membersP
    ? await membersP
    : [{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }];
  const owners = teamMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));

  // Permisos por campo: sin los ocultos; los de solo lectura no se editan en masa.
  const fieldAccess = await fieldAccessP;
  const customFieldDefs = fieldAccess.visible;
  const [allTags, currencyCtx] = await tagsCurrencyP;
  const tagOptions = allTags.map((x) => ({ id: x.id, name: x.name }));
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

  const customTypes = customFilterTypes(customFieldDefs);

  // Propiedades del panel de filtros avanzados: propiedades del deal + las propias.
  const filterFields = dealFilterFields({
    t: (k) => t(k),
    owners,
    tags: allTags.map((x) => ({ value: x.id, label: x.name })),
    customDefs: customFieldDefs,
    stages: pipeline.stages.map((s) => ({ value: s.id, label: s.name })),
    priorities,
    sources,
    currencies: COMMON_CURRENCIES.map((c) => ({ value: c, label: c })),
    forecastCategories: FORECAST_CATEGORIES.map((c) => ({ value: c as string, label: t(`forecast.category.${c}`) })),
  });

  // ---------- Vista activa (pestaña): la usan la tabla y el board ----------
  // Sus filtros, orden y columnas sirven de default y los params explícitos ganan. Lo que toca
  // campos ocultos para esta persona ya viene quitado; cada persona ve sus propios resultados.
  const views = await loadListViews(user, 'deals', searchParams, fieldAccess.hidden, (k) => t(k));
  const { state } = views;
  const q = state.q ?? '';
  const stageParam = state.stageId ?? '';
  // La etapa de la vista se conserva en el board (para guardarla), pero solo filtra la tabla.
  const viewStageId = pipeline.stages.some((s) => s.id === stageParam) ? stageParam : '';
  const stageId = view === 'table' ? viewStageId : '';
  const priorityParam = state.priority ?? '';
  const priority = (PRIORITIES as readonly string[]).includes(priorityParam) ? priorityParam : '';
  const sourceParam = state.source ?? '';
  const source = (SOURCES as readonly string[]).includes(sourceParam) ? sourceParam : '';
  const owner = state.owner ?? '';
  const createdFrom = state.createdFrom ?? '';
  const createdTo = state.createdTo ?? '';
  // Filtros rápidos de fecha (días YYYY-MM-DD; lo demás no se aplica).
  const dayParam = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const closeFrom = dayParam(state.closeFrom);
  const closeTo = dayParam(state.closeTo);
  const activityFrom = dayParam(state.activityFrom);
  const activityTo = dayParam(state.activityTo);
  const noActivity = state.noActivity === '1';
  const qf = state.qf ?? '';
  const custom = customFromState(state);
  const tag = state.tag ?? '';
  const stalled = state.stalled === '1';
  const rawFilters = state.filters ?? '';
  // El filtro de la URL se valida contra lo que el panel ofrece: lo demás ni se aplica ni aparece como chip.
  // El mismo filtro que aplican "Seleccionar todos" y "Exportar la vista" (lib/crm-filter-http.ts).
  const filterModel = listFilterModel(rawFilters, 'deals', {
    customTypes,
    env: { viewerId: realUserId(user), timeZone: await getUserTimeZone(), strictCustom: true },
    shapes: filterFieldShapes(filterFields),
  });
  const advancedCount = countFilterRules(filterModel);
  const filtersParam = serializeFilterModel(filterModel);
  const sortParam = state.sort;
  const sort: DealSort =
    (DEAL_SORTS as readonly string[]).includes(sortParam ?? '') || isExtraSort(sortParam, customTypes)
      ? (sortParam as DealSort)
      : 'newest';
  const page = Number(one(searchParams.page) ?? '1') || 1;
  const dealFilter = {
    q: q || undefined,
    priority: priority || undefined,
    source: source || undefined,
    owner: owner || undefined,
    createdFrom: createdFrom || undefined,
    createdTo: createdTo || undefined,
    closeFrom: closeFrom || undefined,
    closeTo: closeTo || undefined,
    activityFrom: activityFrom || undefined,
    activityTo: activityTo || undefined,
    activityNone: noActivity || undefined,
    tag: tag || undefined,
    stalled: stalled || undefined,
    custom: Object.keys(custom).length
      ? Object.fromEntries(Object.entries(custom).filter(([k]) => customFieldDefs.some((d) => d.name === k)))
      : undefined,
    filters: advancedCount ? filterModel : undefined,
    filterEnv: { viewerId: realUserId(user), timeZone: await getUserTimeZone(), strictCustom: true },
    customTypes,
  };

  // Lo que conservan los links del listado (tabla o board) y lo que guarda la vista.
  const query: Record<string, string> = viewQuery(pipeline.id, view);
  const viewState: Record<string, string> = {};
  if (q) viewState.q = q;
  if (viewStageId) viewState.stageId = viewStageId;
  if (priority) viewState.priority = priority;
  if (source) viewState.source = source;
  if (owner) viewState.owner = owner;
  if (tag) viewState.tag = tag;
  if (stalled) viewState.stalled = '1';
  if (createdFrom) viewState.createdFrom = createdFrom;
  if (createdTo) viewState.createdTo = createdTo;
  if (closeFrom) viewState.closeFrom = closeFrom;
  if (closeTo) viewState.closeTo = closeTo;
  if (activityFrom) viewState.activityFrom = activityFrom;
  if (activityTo) viewState.activityTo = activityTo;
  if (noActivity) viewState.noActivity = '1';
  Object.entries(custom).forEach(([k, v]) => {
    if (v) viewState[`custom_${k}`] = v;
  });
  if (filtersParam) viewState.filters = filtersParam;
  if (sort !== 'newest') viewState.sort = sort;
  if (qf) viewState.qf = qf;
  Object.assign(query, viewState, views.keep);
  if (state.cols) viewState.cols = state.cols;
  if (state.freeze) viewState.freeze = state.freeze;
  if (state.widths) viewState.widths = state.widths;
  const hasViewFilters = Object.keys(viewState).some((k) => k !== 'sort' && k !== 'cols' && k !== 'freeze' && k !== 'widths' && k !== 'qf');

  // Pasar de board a tabla, o de pipeline, mantiene la vista activa.
  const activeViewQ: Record<string, string> = views.keep.sv ? { sv: views.keep.sv } : {};

  // Como en HubSpot: el pipeline y el cambio board/tabla, a la derecha de la búsqueda.
  const trailing = (
    <>
      <PipelineMenu
        current={pipeline.name}
        currentId={pipeline.id}
        pipelines={pipelines.map((p) => ({
          id: p.id,
          name: p.name,
          href: { pathname: '/app/crm/deals', query: { ...viewQuery(p.id, view), ...activeViewQ } },
        }))}
      />
      <nav className="seg-toggle" aria-label={t('record.viewLabel')}>
        <Link
          href={{ pathname: '/app/crm/deals', query: { ...viewQuery(pipeline.id, 'board'), ...activeViewQ } }}
          className="seg-toggle-item"
          aria-current={view === 'board' ? 'page' : undefined}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="4" width="5" height="16" rx="1" />
            <rect x="10" y="4" width="5" height="10" rx="1" />
            <rect x="17" y="4" width="4" height="13" rx="1" />
          </svg>
          <span>{t('deals.board')}</span>
        </Link>
        <Link
          href={{ pathname: '/app/crm/deals', query: { ...viewQuery(pipeline.id, 'table'), ...activeViewQ } }}
          className="seg-toggle-item"
          aria-current={view === 'table' ? 'page' : undefined}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="1" />
            <path d="M3 10h18M3 15h18M9 4v16" />
          </svg>
          <span>{t('deals.tableView')}</span>
        </Link>
      </nav>
    </>
  );

  const filterBar = (
    <>
      <ViewTabs
        entity="deals"
        pathname="/app/crm/deals"
        baseQuery={viewQuery(pipeline.id, view)}
        tabs={views.tabs}
        activeKey={views.activeKey}
        defaultKey={views.defaultKey}
        activeExtra={views.activeExtra}
        modified={views.modified}
        state={viewState}
        teams={views.teams}
      />
      <DealsFilters
        keep={views.keep}
        layout={view}
        pipeline={pipeline.id}
        q={q}
        stageId={viewStageId}
        priority={priority}
        source={source}
        owner={owner}
        tag={tag}
        stalled={stalled}
        tags={tagOptions}
        createdFrom={createdFrom}
        createdTo={createdTo}
        closeFrom={closeFrom}
        closeTo={closeTo}
        activityFrom={activityFrom}
        activityTo={activityTo}
        noActivity={noActivity}
        qf={qf}
        canExport={isWorkspaceAdmin(user)}
        locale={locale}
        trailing={trailing}
        custom={custom}
        advanced={filtersParam || undefined}
        sort={sort}
        stages={pipeline.stages.map((s) => ({ id: s.id, name: s.name }))}
        priorities={priorities}
        sources={sources}
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
      </DealsFilters>
      <AdvancedFilterChips fields={filterFields} model={filterModel} baseQuery={query} />
    </>
  );

  // ---------- Vista tabla (server-side con searchParams) ----------
  let tableContent: React.ReactNode = null;
  if (view === 'table') {
    const { rows, total } = await listDeals(user.id, {
      ...dealFilter,
      ownerScope: scope,
      pipelineId: pipeline.id,
      stageId: stageId || undefined,
      sort,
      page,
      pageSize: PAGE_SIZE,
    });

    const contactCounts = new Map<string, number>();
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      const ph = ids.map(() => '?').join(',');
      // Solo cuenta los contactos que la persona ve.
      const cScope = scopeAnd('c', scope);
      const counts = (await getDb()
        .prepare(
          `SELECT dc.deal_id, COUNT(*) AS c FROM crm_deal_contacts dc JOIN crm_contacts c ON c.id = dc.contact_id
           WHERE dc.deal_id IN (${ph})${cScope.sql} GROUP BY dc.deal_id`,
        )
        .all(...ids, ...cScope.args)) as Array<{ deal_id: string; c: number }>;
      for (const r of counts) contactCounts.set(r.deal_id, r.c);
    }

    const rowTags = await tagsForRecords(user.id, 'deal', rows.map((r) => r.id));
    const dayMs = 86_400_000;
    const cellCtx = { locale, yes: t('common.yes'), no: t('common.no'), users: new Map(owners.map((o) => [o.value, o.label])) };
    const tableRows: DealRow[] = rows.map((d) => {
      const start = parseDbUtc(d.created_at).getTime();
      const stop = d.closed_at
        ? parseDbUtc(d.closed_at).getTime()
        : Date.now();
      return {
        id: d.id,
        name: d.name,
        ownerId: d.owner_id,
        amount: formatAmount(d.amount, d.currency, locale),
        amountValue: d.amount,
        currency: d.currency,
        stageId: d.stage_id,
        stage: d.stage_name ?? '—',
        priority: d.priority,
        priorityLabel: (PRIORITIES as readonly string[]).includes(d.priority)
          ? t(`enums.priority.${d.priority}`)
          : d.priority,
        source: d.source,
        closeDate: formatCloseDate(d.close_date, locale),
        closeDateIso: d.close_date ?? '',
        age: Math.max(0, Math.floor((stop - start) / dayMs)),
        contacts: contactCounts.get(d.id) ?? 0,
        created: formatDate(d.created_at, locale),
        lastActivity: formatActivityDate(d.last_activity_at, locale),
        lastContacted: formatActivityDate(d.last_contacted_at, locale),
        nextActivity: formatActivityDate(d.next_activity_at, locale),
        tags: rowTags.get(d.id) ?? [],
        custom: customCells(customFieldDefs, parseCustom(d.custom), cellCtx),
        companyName: d.company_name,
        companyPrivate: !!d.company_private,
        amountBase: (() => {
          if (d.currency.toUpperCase() === currencyCtx.base) return null;
          const v = convertAmount(d.amount, d.currency, currencyCtx.base, currencyCtx);
          return v === null ? null : formatMoney(v, currencyCtx.base, locale);
        })(),
      };
    });

    // Propiedades de la edición en masa (owner primero: es la acción más común).
    const bulkFields: BulkEditField[] = [
      { key: 'ownerId', label: t('deals.form.owner'), type: 'select', options: owners, nullable: true },
      {
        key: 'stageId',
        label: t('deals.form.stage'),
        type: 'select',
        options: pipeline.stages.map((s) => ({ value: s.id, label: s.name })),
      },
      { key: 'priority', label: t('deals.form.priority'), type: 'select', options: priorities },
      { key: 'source', label: t('deals.form.source'), type: 'select', options: sources },
      { key: 'closeDate', label: t('deals.form.closeDate'), type: 'date', nullable: true },
      {
        key: 'currency',
        label: t('deals.form.currency'),
        type: 'select',
        options: COMMON_CURRENCIES.map((c) => ({ value: c, label: c })),
      },
      {
        key: 'dealType',
        label: t('deals.form.dealType'),
        type: 'select',
        options: DEAL_TYPES.map((v) => ({ value: v as string, label: t(`enums.dealType.${v}`) })),
        nullable: true,
      },
      { key: 'nextStep', label: t('deals.form.nextStep'), type: 'text', nullable: true },
      { key: 'wonReason', label: t('deals.form.wonReason'), type: 'text', nullable: true },
      ...customBulkFields(customFieldDefs.filter((d) => d.access === 'edit'), { yes: t('common.yes'), no: t('common.no') }, owners),
    ];

    const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    const currentPage = Math.min(Math.max(page, 1), pages);
    tableContent = (
      <>
        {tableRows.length === 0 ? (
          hasViewFilters || views.activeKey !== 'all' ? (
            <EmptyState
              title={t('record.empty.noMatchTitle')}
              body={t('record.empty.noMatchBody')}
              action={{ label: t('common.clear'), href: `/app/crm/deals?pipeline=${pipeline.id}&view=table&sv=all` }}
            />
          ) : (
            <EmptyState
              title={t('record.empty.dealsTitle')}
              body={t('record.empty.dealsBody')}
              action={
                <CrmQuickCreate
                  kind="deal"
                  variant="empty"
                  defaultPipelineId={pipeline.id}
                  buttonClassName="btn btn-primary"
                  label={t('record.createDeal')}
                />
              }
            />
          )
        ) : (
          <>
            <DealsTable
              rows={tableRows}
              customColumns={customColumns(customFieldDefs)}
              sort={sort}
              stages={pipeline.stages.map((s) => ({
                id: s.id,
                name: s.name,
                is_won: s.is_won,
                is_lost: s.is_lost,
              }))}
              priorities={priorities}
              sources={sources}
              locale={locale}
              allTags={tagOptions}
              bulkFields={bulkFields}
              owners={owners}
              canDelete={isWorkspaceAdmin(user)}
              canExport={isWorkspaceAdmin(user)}
              total={total}
            />
            <CrmPager pathname="/app/crm/deals" query={query} page={currentPage} pages={pages} total={total} locale={locale} />
          </>
        )}
      </>
    );
  }

  // ---------- Vista board (con totales del pipeline) ----------
  const rawBoard = view === 'board' ? withAges(await listDealsForBoard(user.id, pipeline.id, scope, dealFilter)) : null;
  // Score con IA guardado de cada deal (badge en la tarjeta).
  const aiScores = rawBoard ? await dealScoresFor(user.id, rawBoard.flatMap((c) => c.deals.map((d) => d.id))) : null;
  // Las tarjetas son filas enteras que llegan al cliente: sin los campos ocultos para la persona.
  const hiddenDealFields = (await fieldAccessP).hidden;
  // Tarjetas de este pipeline ("Editar tarjetas"): sin las personalizadas que la persona tiene ocultas.
  const cardLayout = view === 'board' ? await resolveCardLayout(sessionFieldViewer(user), pipeline.id) : null;
  const cardCustomDefs = customFieldDefs
    .filter((d) => cardLayout?.properties.includes(`custom.${d.name}`))
    .map((d) => ({ name: d.name, label: d.label, type: d.type, options: d.options }));
  const boardStages = rawBoard
    ? rawBoard.map((col) => ({
        ...col,
        // Lo que pide la etapa, sin nombrar campos que la persona tiene ocultos.
        stage: redactStagesFor([col.stage], hiddenDealFields)[0],
        deals: col.deals.map((d) => ({ ...redactRow(d, hiddenDealFields), ai_score: aiScores?.get(d.id)?.score ?? null, ai_reason: aiScores?.get(d.id)?.reason ?? '' })),
      }))
    : null;
  const openStages = boardStages?.filter((c) => !c.stage.is_won && !c.stage.is_lost) ?? [];
  const totals = boardStages
    ? {
        openCount: openStages.reduce((s, c) => s + c.count, 0),
        openAmount: openStages.reduce((s, c) => s + c.amount, 0),
        forecast: openStages.reduce((s, c) => s + (c.amount * c.stage.probability) / 100, 0),
      }
    : null;

  return (
    <div className="ui-page crm-list-page">
      <PageHeader
        title={t('deals.title')}
        actions={
          <>
            <Link href="/app/crm/approvals" className="btn btn-secondary btn-sm" data-testid="deals-approvals">
              {pendingApprovals > 0 ? t('approvals.navCount', { count: pendingApprovals }) : t('approvals.nav')}
            </Link>
            <CrmQuickCreate kind="deal" defaultPipelineId={pipeline.id} buttonClassName="btn btn-primary btn-sm" label={t('record.createDeal')} />
          </>
        }
      />

      {/* Columnas (orden, fija, anchos) para "Editar columnas" de la barra y para la tabla. */}
      <TableColumnsProvider
        entity="deals"
        customColumns={customColumns(customFieldDefs)}
        viewCols={state.cols}
        viewFreeze={state.freeze === '1' ? true : searchParams.freeze === '0' ? false : undefined}
        viewWidths={state.widths}
      >
      {filterBar}

      {view === 'board' && boardStages && totals ? (
        <>
          <div className="kb-totals" data-testid="deals-summary">
            <dl className="kb-totals-list">
              <div>
                <dt>{t('deals.totals.open')}</dt>
                <dd className="num">{totals.openCount}</dd>
              </div>
              <div>
                <dt>{t('deals.totals.openAmount')}</dt>
                <dd className="num">{formatMoney(totals.openAmount, currencyCtx.base, locale)}</dd>
              </div>
              <div>
                <dt>{t('deals.totals.forecast')}</dt>
                <dd className="num">{formatMoney(totals.forecast, currencyCtx.base, locale)}</dd>
              </div>
            </dl>
            <span className="kb-totals-tools">
              {isWorkspaceAdmin(user) && (
                <Link
                  href={`/app/crm/settings?tab=sales&pipeline=${encodeURIComponent(pipeline.id)}#board-cards`}
                  className="btn btn-secondary btn-sm"
                  data-testid="deals-edit-cards"
                >
                  {t('layouts.editCards')}
                </Link>
              )}
              <ScoreDealsButton pipelineId={pipeline.id} locale={locale} />
            </span>
          </div>
          <DealsBoard
            key={pipeline.id}
            pipelineId={pipeline.id}
            stages={boardStages}
            locale={locale}
            baseCurrency={currencyCtx.base}
            priorities={priorities}
            sources={sources}
            owners={owners}
            cardKeys={cardLayout?.properties}
            cardCustomDefs={cardCustomDefs}
          />
        </>
      ) : (
        tableContent
      )}
      </TableColumnsProvider>
    </div>
  );
}
