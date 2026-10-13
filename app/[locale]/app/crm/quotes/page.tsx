import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listQuotes } from '@/lib/crm-products';
import { QUOTE_STATUSES, type QuoteStatus } from '@/lib/crm-constants';
import { formatMoney } from '@/lib/crm-money';
import { formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface QuotesPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Todos los quotes del workspace. Se crean desde un deal (panel Quotes). */
export default async function QuotesPage(props: QuotesPageProps) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const statusParam = typeof sp.status === 'string' ? sp.status : '';
  const status = (QUOTE_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as QuoteStatus) : undefined;
  const page = Number(typeof sp.page === 'string' ? sp.page : '1') || 1;
  const { rows, total } = await listQuotes(user.id, { status, page, pageSize: 50 });
  const pages = Math.max(Math.ceil(total / 50), 1);

  const fmtDay = (d: string | null) =>
    d
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`))
      : '—';

  return (
    <div className="app-page">
      <div className="page-head">
        <div>
          <h1 className="app-title">{t('quotes.title')}</h1>
          <p className="muted app-sub">{t('quotes.subtitle')}</p>
        </div>
      </div>

      <nav className="quote-filter mono" aria-label={t('quotes.table.status')}>
        <Link href="/app/crm/quotes" className={!status ? 'active' : undefined}>
          {t('common.all')}
        </Link>
        {QUOTE_STATUSES.map((s) => (
          <Link key={s} href={{ pathname: '/app/crm/quotes', query: { status: s } }} className={status === s ? 'active' : undefined}>
            {t(`enums.quoteStatus.${s}`)}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0 0 0 0 0
          </p>
          <h2>{t('quotes.emptyTitle')}</h2>
          <p className="muted">{t('quotes.emptySub')}</p>
          <Link href="/app/crm/deals" className="btn btn-small">
            {t('quotes.goToDeals')}
          </Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table crm-table">
            <thead>
              <tr>
                <th>{t('quotes.table.number')}</th>
                <th>{t('quotes.table.title')}</th>
                <th>{t('quotes.table.deal')}</th>
                <th>{t('quotes.table.status')}</th>
                <th className="num">{t('quotes.table.total')}</th>
                <th>{t('quotes.table.expires')}</th>
                <th>{t('quotes.table.created')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id}>
                  <td className="mono">
                    <Link href={`/app/crm/quotes/${q.id}`} className="cell-name">
                      {q.number}
                    </Link>
                  </td>
                  <td>{q.title}</td>
                  <td>
                    {q.deal_name ? (
                      <Link href={`/app/crm/deals/${q.deal_id}`} className="cell-sub">
                        {q.deal_name}
                      </Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className={`crm-dot-status q-${q.status}`}>{t(`enums.quoteStatus.${q.status}`)}</span>
                  </td>
                  <td className="mono num">{formatMoney(q.total, q.currency, locale, true)}</td>
                  <td className="mono muted cell-date">{fmtDay(q.expires_at)}</td>
                  <td className="mono muted cell-date">{formatDate(q.created_at, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="pager mono">
          {page > 1 ? (
            <Link href={{ pathname: '/app/crm/quotes', query: { ...(status ? { status } : {}), page: String(page - 1) } }} className="pager-btn">
              {t('common.pagePrev')}
            </Link>
          ) : (
            <span className="pager-btn disabled">{t('common.pagePrev')}</span>
          )}
          <span className="pager-info">{t('common.pageOf', { page, pages })}</span>
          {page < pages ? (
            <Link href={{ pathname: '/app/crm/quotes', query: { ...(status ? { status } : {}), page: String(page + 1) } }} className="pager-btn">
              {t('common.pageNext')}
            </Link>
          ) : (
            <span className="pager-btn disabled">{t('common.pageNext')}</span>
          )}
        </nav>
      )}
    </div>
  );
}
