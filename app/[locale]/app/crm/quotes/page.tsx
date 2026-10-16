import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { listQuotes } from '@/lib/crm-products';
import { QUOTE_STATUSES, type QuoteStatus } from '@/lib/crm-constants';
import { formatMoney } from '@/lib/crm-money';
import { formatDate } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { QUOTE_TONE, badgeClass } from '@/lib/crm-ui-tones';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

interface QuotesPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Todas las cotizaciones del workspace. Se crean desde un deal (panel Cotizaciones). */
export default async function QuotesPage(props: QuotesPageProps) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const statusParam = typeof sp.status === 'string' ? sp.status : '';
  const status = (QUOTE_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as QuoteStatus) : undefined;
  const page = Number(typeof sp.page === 'string' ? sp.page : '1') || 1;
  const { rows, total } = await listQuotes(user.id, { status, page, pageSize: PAGE_SIZE, ownerScope: await sessionScope(user) });
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const fmtDay = (d: string | null) =>
    d ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`)) : '';
  const pageHref = (p: number) => ({ pathname: '/app/crm/quotes', query: { ...(status ? { status } : {}), page: String(p) } });

  return (
    <div className="app-page ui-page">
      <PageHeader title={t('quotes.title')} description={t('quotes.subtitle')} />

      <nav className="ui-tabs" aria-label={t('quotes.table.status')}>
        <Link href="/app/crm/quotes" className="ui-tab" aria-current={!status ? 'page' : undefined}>
          {t('common.all')}
        </Link>
        {QUOTE_STATUSES.map((s) => (
          <Link
            key={s}
            href={{ pathname: '/app/crm/quotes', query: { status: s } }}
            className="ui-tab"
            aria-current={status === s ? 'page' : undefined}
          >
            {t(`enums.quoteStatus.${s}`)}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        status ? (
          <EmptyState
            quiet
            title={t('quotes.emptyFilteredTitle', { status: t(`enums.quoteStatus.${status}`) })}
            action={{ label: t('quotes.seeAll'), href: '/app/crm/quotes' }}
          />
        ) : (
          <EmptyState
            title={t('quotes.emptyTitle')}
            body={t('quotes.emptySub')}
            action={{ label: t('quotes.goToDeals'), href: '/app/crm/deals' }}
          />
        )
      ) : (
        <div className="table-wrap">
          <table className="table crm-stack">
            <caption className="sr-only">{t('quotes.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('quotes.table.number')}</th>
                <th scope="col">{t('quotes.table.title')}</th>
                <th scope="col">{t('quotes.table.deal')}</th>
                <th scope="col">{t('quotes.table.status')}</th>
                <th scope="col" className="num">
                  {t('quotes.table.total')}
                </th>
                <th scope="col">{t('quotes.table.expires')}</th>
                <th scope="col">{t('quotes.table.created')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id}>
                  <td className="data crm-stack-main quote-num-cell">
                    <Link href={`/app/crm/quotes/${q.id}`} className="cell-link">
                      {q.number}
                    </Link>
                  </td>
                  <td className="crm-stack-sub">{q.title}</td>
                  <td data-label={t('quotes.table.deal')}>{q.deal_name ? <Link href={`/app/crm/deals/${q.deal_id}`}>{q.deal_name}</Link> : null}</td>
                  <td className="crm-stack-state">
                    <span className={badgeClass(QUOTE_TONE, q.status)}>{t(`enums.quoteStatus.${q.status}`)}</span>
                  </td>
                  <td className="num data" data-label={t('quotes.table.total')}>{formatMoney(q.total, q.currency, locale, true)}</td>
                  <td className="data" data-label={t('quotes.table.expires')}>{fmtDay(q.expires_at)}</td>
                  <td className="data" data-label={t('quotes.table.created')}>{formatDate(q.created_at, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="crm-pager" aria-label={t('quotes.pagination')}>
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="btn btn-secondary btn-sm">
              {t('quotes.prevPage')}
            </Link>
          ) : (
            <span className="btn btn-secondary btn-sm" aria-disabled="true">
              {t('quotes.prevPage')}
            </span>
          )}
          <span className="data">{t('common.pageOf', { page, pages })}</span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className="btn btn-secondary btn-sm">
              {t('quotes.nextPage')}
            </Link>
          ) : (
            <span className="btn btn-secondary btn-sm" aria-disabled="true">
              {t('quotes.nextPage')}
            </span>
          )}
        </nav>
      )}
    </div>
  );
}
