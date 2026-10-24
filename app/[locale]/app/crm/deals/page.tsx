import { dealScoresFor } from '@/lib/crm-ai';
import ScoreDealsButton from '@/components/crm/ScoreDealsButton';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { getDb } from '@/lib/db';
import {
  ACTIVITY_DATE_SORTS,
  listCustomFields,
  listDeals,
  listDealsForBoard,
  listPipelinesWithStages,
  parseFilterRules,
  PRIORITIES,
  SOURCES,
  type BoardStage,
  parseCustom,
} from '@/lib/crm';
import { listMembers } from '@/lib/teams';
import { formatDate } from '@/lib/utils';
import DealsBoard from '@/components/crm/DealsBoard';
import DealsFilters from '@/components/crm/DealsFilters';
import DealsTable, { type DealRow } from '@/components/crm/DealsTable';
import FilterBuilder, { type FilterBuilderField } from '@/components/crm/FilterBuilder';
import { AddPipelineChip } from '@/components/crm/AddPipelineStage';

import CrmQuickCreate from '@/components/crm/CrmQuickCreate';
import CrmPager from '@/components/crm/CrmPager';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { listTags, tagsForRecords } from '@/lib/crm-tags';
import { getCurrencyContext } from '@/lib/crm-currency';
import { convertAmount, formatMoney } from '@/lib/crm-money';
import { dbTimestamp, dealIdleDays } from '@/lib/crm-rotting';
import { COMMON_CURRENCIES } from '@/lib/crm-constants';
import type { BulkEditField } from '@/components/crm/BulkEditControls';
import { customBulkFields } from '@/components/crm/bulkFields';
import { customBuilderFields, customCells, customColumns, customFilterTypes, extraSortOptions } from '@/components/crm/customFieldViews';
import { isExtraSort, type ExtraSort } from '@/lib/crm-list-sort';
import { formatActivityDate } from '@/lib/crm-activity-dates';

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
  const scope = await sessionScope(user);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const pipelines = await listPipelinesWithStages(user.id);
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

  const teamMembers = user.team?.id
    ? await listMembers(user.team.id)
    : [{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }];
  const owners = teamMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));

  const customFieldDefs = await listCustomFields(user.id, 'deals');
  const [allTags, currencyCtx] = await Promise.all([listTags(user.id), getCurrencyContext(user.id)]);
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

  // Campos del constructor avanzado: estándar + custom fields de la entidad.
  const builderFields: FilterBuilderField[] = [
    { key: 'name', label: t('filters.field.name'), type: 'text' },
    { key: 'amount', label: t('filters.field.amount'), type: 'number' },
    {
      key: 'stage',
      label: t('filters.field.stage'),
      type: 'select',
      options: pipeline.stages.map((s) => ({ value: s.id, label: s.name })),
    },
    { key: 'priority', label: t('filters.field.priority'), type: 'select', options: priorities },
    { key: 'source', label: t('filters.field.source'), type: 'select', options: sources },
    {
      key: 'tag',
      label: t('filters.field.tag'),
      type: 'select',
      options: allTags.map((x) => ({ value: x.id, label: x.name })),
    },
    { key: 'owner', label: t('filters.field.owner'), type: 'select', options: owners },
    { key: 'closeDate', label: t('filters.field.closeDate'), type: 'date' },
    { key: 'created', label: t('filters.field.created'), type: 'date' },
    { key: 'lastActivity', label: t('activityDates.lastActivity'), type: 'date' },
    { key: 'lastContacted', label: t('activityDates.lastContacted'), type: 'date' },
    { key: 'nextActivity', label: t('activityDates.nextActivity'), type: 'date' },
    ...customBuilderFields(customFieldDefs, { yes: t('common.yes'), no: t('common.no') }, owners),
  ];

  // ---------- Vista tabla (server-side con searchParams) ----------
  let tableContent: React.ReactNode = null;
  if (view === 'table') {
    const q = one(searchParams.q) ?? '';
    const stageParam = one(searchParams.stageId) ?? '';
    const stageId = pipeline.stages.some((s) => s.id === stageParam) ? stageParam : '';
    const priorityParam = one(searchParams.priority) ?? '';
    const priority = (PRIORITIES as readonly string[]).includes(priorityParam) ? priorityParam : '';
    const sourceParam = one(searchParams.source) ?? '';
    const source = (SOURCES as readonly string[]).includes(sourceParam) ? sourceParam : '';
    const owner = one(searchParams.owner) ?? '';
    const createdFrom = one(searchParams.createdFrom) ?? '';
    const createdTo = one(searchParams.createdTo) ?? '';
    const custom = parseCustomFilter(searchParams);
    const tag = one(searchParams.tag) ?? '';
    const rawFilters = one(searchParams.filters) ?? '';
    const advancedRules = parseFilterRules(rawFilters);
    const sortParam = one(searchParams.sort);
    const sort: DealSort =
      (DEAL_SORTS as readonly string[]).includes(sortParam ?? '') || isExtraSort(sortParam, customTypes)
        ? (sortParam as DealSort)
      : 'newest';
    const page = Number(one(searchParams.page) ?? '1') || 1;

    const { rows, total } = await listDeals(user.id, {
      ownerScope: scope,
      pipelineId: pipeline.id,
      q: q || undefined,
      stageId: stageId || undefined,
      priority: priority || undefined,
      source: source || undefined,
      owner: owner || undefined,
      createdFrom: createdFrom || undefined,
      createdTo: createdTo || undefined,
      tag: tag || undefined,
      custom: Object.keys(custom).length ? custom : undefined,
      filters: advancedRules.length ? advancedRules : undefined,
      customTypes,
      sort,
      page,
      pageSize: PAGE_SIZE,
    });

    const contactCounts = new Map<string, number>();
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      const ph = ids.map(() => '?').join(',');
      const counts = (await getDb()
        .prepare(
          `SELECT deal_id, COUNT(*) AS c FROM crm_deal_contacts
           WHERE deal_id IN (${ph}) GROUP BY deal_id`,
        )
        .all(...ids)) as Array<{ deal_id: string; c: number }>;
      for (const r of counts) contactCounts.set(r.deal_id, r.c);
    }

    const rowTags = await tagsForRecords(user.id, 'deal', rows.map((r) => r.id));
    const dayMs = 86_400_000;
    const cellCtx = { locale, yes: t('common.yes'), no: t('common.no'), users: new Map(owners.map((o) => [o.value, o.label])) };
    const tableRows: DealRow[] = rows.map((d) => {
      const start = new Date(d.created_at.replace(' ', 'T') + 'Z').getTime();
      const stop = d.closed_at
        ? new Date(d.closed_at.replace(' ', 'T') + 'Z').getTime()
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
      ...customBulkFields(customFieldDefs, { yes: t('common.yes'), no: t('common.no') }, owners),
    ];

    const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    const currentPage = Math.min(Math.max(page, 1), pages);
    const query: Record<string, string> = { pipeline: pipeline.id, view: 'table' };
    if (q) query.q = q;
    if (stageId) query.stageId = stageId;
    if (priority) query.priority = priority;
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

    tableContent = (
      <>
        <DealsFilters
          pipeline={pipeline.id}
          q={q}
          stageId={stageId}
          priority={priority}
          source={source}
          owner={owner}
          tag={tag}
          tags={tagOptions}
          createdFrom={createdFrom}
          createdTo={createdTo}
          custom={custom}
          advanced={rawFilters || undefined}
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
          <FilterBuilder fields={builderFields} initial={advancedRules} baseQuery={query} />
        </DealsFilters>
        {tableRows.length === 0 ? (
          Object.keys(query).length > 2 ? (
            <EmptyState
              title={t('record.empty.noMatchTitle')}
              body={t('record.empty.noMatchBody')}
              action={{ label: t('common.clear'), href: `/app/crm/deals?pipeline=${pipeline.id}&view=table` }}
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
            />
            <CrmPager pathname="/app/crm/deals" query={query} page={currentPage} pages={pages} total={total} locale={locale} />
          </>
        )}
      </>
    );
  }

  // ---------- Vista board (con totales del pipeline) ----------
  const rawBoard = view === 'board' ? withAges(await listDealsForBoard(user.id, pipeline.id, scope)) : null;
  // Score con IA guardado de cada deal (badge en la tarjeta).
  const aiScores = rawBoard ? await dealScoresFor(user.id, rawBoard.flatMap((c) => c.deals.map((d) => d.id))) : null;
  const boardStages = rawBoard
    ? rawBoard.map((col) => ({
        ...col,
        deals: col.deals.map((d) => ({ ...d, ai_score: aiScores?.get(d.id)?.score ?? null, ai_reason: aiScores?.get(d.id)?.reason ?? '' })),
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
            <nav className="btn-group" aria-label={t('record.viewLabel')}>
              <Link
                href={{ pathname: '/app/crm/deals', query: viewQuery(pipeline.id, 'board') }}
                className="btn btn-secondary btn-sm"
                aria-current={view === 'board' ? 'page' : undefined}
              >
                {t('deals.board')}
              </Link>
              <Link
                href={{ pathname: '/app/crm/deals', query: viewQuery(pipeline.id, 'table') }}
                className="btn btn-secondary btn-sm"
                aria-current={view === 'table' ? 'page' : undefined}
              >
                {t('deals.tableView')}
              </Link>
            </nav>
            <CrmQuickCreate kind="deal" defaultPipelineId={pipeline.id} buttonClassName="btn btn-primary btn-sm" label={t('record.createDeal')} />
          </>
        }
      />

      <div className="deals-pipelines">
        <nav className="btn-group" aria-label={t('deals.pipelineLabel')}>
          {pipelines.map((p) => (
            <Link
              key={p.id}
              href={{ pathname: '/app/crm/deals', query: viewQuery(p.id, view) }}
              className="btn btn-secondary btn-sm"
              aria-current={p.id === pipeline.id ? 'page' : undefined}
            >
              {p.name}
            </Link>
          ))}
        </nav>
        <AddPipelineChip />
      </div>

      {view === 'board' && boardStages && totals ? (
        <>
          <div className="kb-totals">
            <span>
              {t('deals.totals.open')}: <strong>{totals.openCount}</strong>
            </span>
            <span>
              {t('deals.totals.openAmount')}:{' '}
              <strong>{formatMoney(totals.openAmount, currencyCtx.base, locale)}</strong>
            </span>
            <span>
              {t('deals.totals.forecast')}:{' '}
              <strong>{formatMoney(totals.forecast, currencyCtx.base, locale)}</strong>
            </span>
            <ScoreDealsButton pipelineId={pipeline.id} locale={locale} />
          </div>
          <DealsBoard
            key={pipeline.id}
            pipelineId={pipeline.id}
            stages={boardStages}
            locale={locale}
            baseCurrency={currencyCtx.base}
            priorities={priorities}
            sources={sources}
          />
        </>
      ) : (
        tableContent
      )}
    </div>
  );
}
