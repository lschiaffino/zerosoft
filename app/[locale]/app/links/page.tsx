import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { linkStatus, listLinks, parseTags, userTags, type ArchivedFilter } from '@/lib/links';
import { formatDate, shortDomain, shortUrl } from '@/lib/utils';
import { listDomains } from '@/lib/link-domains';
import FilterBar from '@/components/link/FilterBar';
import LinksTable, { type TableRow } from '@/components/link/LinksTable';
import LinksQuickCreate, { NewLinkButton } from '@/components/link/LinksQuickCreate';

export const dynamic = 'force-dynamic';

interface LinksPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export default async function LinksPage(props: LinksPageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });

  const q = one(searchParams.q) ?? '';
  const tag = one(searchParams.tag) ?? null;
  const archivedParam = one(searchParams.archived);
  const archived: ArchivedFilter = archivedParam === '1' || archivedParam === 'all' ? archivedParam : '0';
  const sort = one(searchParams.sort) === 'clicks' ? 'clicks' : 'created';
  const page = Number(one(searchParams.page) ?? '1') || 1;

  const result = await listLinks(user.id, { q: q || undefined, tag: tag ?? undefined, archived, sort, page });
  const tags = await userTags(user.id);
  const customDomains = (await listDomains(user.id))
    .filter((d) => d.verified === 1)
    .map((d) => ({ id: d.id, hostname: d.hostname }));

  const rows: TableRow[] = result.links.map((l) => ({
    id: l.id,
    slug: l.slug,
    short: shortUrl(l.slug, l.domain_hostname ?? null),
    url: l.url,
    title: l.title,
    tags: parseTags(l.tags),
    clicks: l.clicks,
    created: formatDate(l.created_at, locale),
    status: linkStatus(l),
  }));

  const pages = Math.max(Math.ceil(result.total / result.pageSize), 1);
  const query: Record<string, string> = {};
  if (q) query.q = q;
  if (tag) query.tag = tag;
  if (archived !== '0') query.archived = archived;
  if (sort !== 'created') query.sort = sort;

  const hasFilters = !!q || !!tag || archived !== '0';

  return (
    <div className="app-page links-page">
      <div className="page-head">
        <h1 className="app-title">{t('table.title')}</h1>
        <div className="page-head-actions">
          <Link href="/app/links/bulk" className="btn btn-small">
            {t('table.bulkCta')}
          </Link>
          <LinksQuickCreate domain={shortDomain()} customDomains={customDomains} />
        </div>
      </div>

      <FilterBar q={q} tag={tag} archived={archived} sort={sort} tags={tags} />

      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0 0 0 0 0
          </p>
          <h2>{hasFilters ? t('table.emptyTitle') : t('table.emptyAllTitle')}</h2>
          <p className="muted">{hasFilters ? t('table.emptySub') : t('table.emptyAllSub')}</p>
          {hasFilters ? (
            <Link href="/app/links" className="btn btn-small">
              {t('table.clearFilters')}
            </Link>
          ) : (
            <NewLinkButton label={t('table.emptyCta')} />
          )}
        </div>
      ) : (
        <>
          <LinksTable rows={rows} />
          {pages > 1 && (
            <nav className="pager mono">
              {result.page > 1 ? (
                <Link
                  href={{ pathname: '/app/links', query: { ...query, page: String(result.page - 1) } }}
                  className="pager-btn"
                >
                  {t('table.pagePrev')}
                </Link>
              ) : (
                <span className="pager-btn disabled">{t('table.pagePrev')}</span>
              )}
              <span className="pager-info">
                {t('table.pageOf', { page: result.page, pages })}
              </span>
              {result.page < pages ? (
                <Link
                  href={{ pathname: '/app/links', query: { ...query, page: String(result.page + 1) } }}
                  className="pager-btn"
                >
                  {t('table.pageNext')}
                </Link>
              ) : (
                <span className="pager-btn disabled">{t('table.pageNext')}</span>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
