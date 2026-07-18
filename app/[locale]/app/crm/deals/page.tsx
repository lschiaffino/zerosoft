import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import {
  listDeals,
  listDealsForBoard,
  listPipelinesWithStages,
  PRIORITIES,
  SOURCES,
} from '@/lib/crm';
import { formatDate } from '@/lib/utils';
import DealsBoard from '@/components/crm/DealsBoard';
import DealsFilters from '@/components/crm/DealsFilters';
import DealsTable, { type DealRow } from '@/components/crm/DealsTable';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const DEAL_SORTS = ['newest', 'oldest', 'amount', 'close_date'] as const;
type DealSort = (typeof DEAL_SORTS)[number];

interface DealsPageProps {
  params: { locale: string };
  searchParams: Record<string, string | string[] | undefined>;
}

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
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

export default async function DealsPage({ params: { locale }, searchParams }: DealsPageProps) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const pipelines = await listPipelinesWithStages(user.id);
  const pipelineParam = one(searchParams.pipeline);
  const pipeline = pipelines.find((p) => p.id === pipelineParam) ?? pipelines[0];
  const view = one(searchParams.view) === 'table' ? 'table' : 'board';

  const priorities = PRIORITIES.map((value) => ({ value, label: t(`enums.priority.${value}`) }));
  const sources = SOURCES.map((value) => ({ value, label: t(`enums.source.${value}`) }));

  if (!pipeline) {
    return (
      <div className="app-page">
        <div className="page-head">
          <h1 className="app-title">{t('deals.title')}</h1>
        </div>
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0 0 0 0 0
          </p>
          <h2>{t('deals.title')}</h2>
        </div>
      </div>
    );
  }

  const viewQuery = (p: string, v: 'board' | 'table'): Record<string, string> =>
    v === 'table' ? { pipeline: p, view: 'table' } : { pipeline: p };

  // ---------- Vista tabla (server-side con searchParams) ----------
  let tableContent: React.ReactNode = null;
  if (view === 'table') {
    const q = one(searchParams.q) ?? '';
    const stageParam = one(searchParams.stageId) ?? '';
    const stageId = pipeline.stages.some((s) => s.id === stageParam) ? stageParam : '';
    const priorityParam = one(searchParams.priority) ?? '';
    const priority = (PRIORITIES as readonly string[]).includes(priorityParam) ? priorityParam : '';
    const sortParam = one(searchParams.sort);
    const sort: DealSort = (DEAL_SORTS as readonly string[]).includes(sortParam ?? '')
      ? (sortParam as DealSort)
      : 'newest';
    const page = Number(one(searchParams.page) ?? '1') || 1;

    const { rows, total } = await listDeals(user.id, {
      pipelineId: pipeline.id,
      q: q || undefined,
      stageId: stageId || undefined,
      priority: priority || undefined,
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

    const tableRows: DealRow[] = rows.map((d) => ({
      id: d.id,
      name: d.name,
      amount: formatAmount(d.amount, d.currency, locale),
      stage: d.stage_name ?? '—',
      priority: d.priority,
      priorityLabel: (PRIORITIES as readonly string[]).includes(d.priority)
        ? t(`enums.priority.${d.priority}`)
        : d.priority,
      closeDate: formatCloseDate(d.close_date, locale),
      contacts: contactCounts.get(d.id) ?? 0,
      created: formatDate(d.created_at, locale),
    }));

    const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    const currentPage = Math.min(Math.max(page, 1), pages);
    const query: Record<string, string> = { pipeline: pipeline.id, view: 'table' };
    if (q) query.q = q;
    if (stageId) query.stageId = stageId;
    if (priority) query.priority = priority;
    if (sort !== 'newest') query.sort = sort;

    tableContent = (
      <>
        <DealsFilters
          pipeline={pipeline.id}
          q={q}
          stageId={stageId}
          priority={priority}
          sort={sort}
          stages={pipeline.stages.map((s) => ({ id: s.id, name: s.name }))}
          priorities={priorities}
        />
        {tableRows.length === 0 ? (
          <div className="empty-state">
            <p className="empty-zeros mono" aria-hidden>
              0 0 0 0 0 0 0
            </p>
            <h2>{t('deals.emptyStage')}</h2>
          </div>
        ) : (
          <>
            <DealsTable rows={tableRows} />
            {pages > 1 && (
              <nav className="pager mono">
                {currentPage > 1 ? (
                  <Link
                    href={{ pathname: '/app/crm/deals', query: { ...query, page: String(currentPage - 1) } }}
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
                    href={{ pathname: '/app/crm/deals', query: { ...query, page: String(currentPage + 1) } }}
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
      </>
    );
  }

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('deals.title')}</h1>
        <div className="kb-view-toggle">
          <Link
            href={{ pathname: '/app/crm/deals', query: viewQuery(pipeline.id, 'board') }}
            className={`kb-view-btn${view === 'board' ? ' active' : ''}`}
          >
            {t('deals.board')}
          </Link>
          <Link
            href={{ pathname: '/app/crm/deals', query: viewQuery(pipeline.id, 'table') }}
            className={`kb-view-btn${view === 'table' ? ' active' : ''}`}
          >
            {t('deals.tableView')}
          </Link>
        </div>
      </div>

      <div className="filter-chips" aria-label={t('deals.pipelineLabel')}>
        {pipelines.map((p) => (
          <Link
            key={p.id}
            href={{ pathname: '/app/crm/deals', query: viewQuery(p.id, view) }}
            className={`chip${p.id === pipeline.id ? ' active' : ''}`}
          >
            {p.name}
          </Link>
        ))}
      </div>

      {view === 'board' ? (
        <DealsBoard
          key={pipeline.id}
          pipelineId={pipeline.id}
          stages={await listDealsForBoard(user.id, pipeline.id)}
          locale={locale}
          priorities={priorities}
          sources={sources}
        />
      ) : (
        tableContent
      )}
    </div>
  );
}
