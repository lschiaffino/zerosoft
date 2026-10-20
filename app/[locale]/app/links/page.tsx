import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { linkCreators, linkStatus, listLinks, parseTags, userTags, type ArchivedFilter } from '@/lib/links';
import { formatDate, formatNumber, shortDomain, shortUrl } from '@/lib/utils';
import { listDomains } from '@/lib/link-domains';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
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
  const { locale } = await props.params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });

  const q = one(searchParams.q) ?? '';
  const tag = one(searchParams.tag) ?? null;
  const archivedParam = one(searchParams.archived);
  const archived: ArchivedFilter = archivedParam === '1' || archivedParam === 'all' ? archivedParam : '0';
  const sort = one(searchParams.sort) === 'clicks' ? 'clicks' : 'created';
  const page = Number(one(searchParams.page) ?? '1') || 1;
  const creator = one(searchParams.creator) ?? null;

  const [result, tags, domains, creators] = await Promise.all([
    listLinks(user.id, { q: q || undefined, tag: tag ?? undefined, archived, sort, creator: creator ?? undefined, page }),
    userTags(user.id),
    listDomains(user.id),
    linkCreators(user.id),
  ]);
  const creatorNames = new Map(creators.map((c) => [c.id, c.name || c.email]));
  const customDomains = domains.filter((d) => d.verified === 1).map((d) => ({ id: d.id, hostname: d.hostname }));

  const rows: TableRow[] = result.links.map((l) => ({
    id: l.id,
    slug: l.slug,
    short: shortUrl(l.slug, l.domain_hostname ?? null),
    url: l.url,
    title: l.title,
    tags: parseTags(l.tags),
    clicks: formatNumber(l.clicks, locale),
    clickCount: l.clicks,
    created: formatDate(l.created_at, locale),
    creator: l.created_by ? (creatorNames.get(l.created_by) ?? null) : null,
    status: linkStatus(l),
  }));

  const pages = Math.max(Math.ceil(result.total / result.pageSize), 1);
  const query: Record<string, string> = {};
  if (q) query.q = q;
  if (tag) query.tag = tag;
  if (archived !== '0') query.archived = archived;
  if (sort !== 'created') query.sort = sort;
  if (creator) query.creator = creator;

  const hasFilters = !!q || !!tag || archived !== '0' || !!creator;
  // Sin filtros y sin filas puede ser que solo haya archivados: eso no es "todavía no hay links".
  const neverCreated =
    rows.length === 0 && !hasFilters && (await listLinks(user.id, { archived: 'all' })).total === 0;

  return (
    <div className="ui-page links-page">
      <PageHeader
        title={t('table.title')}
        description={result.total > 0 ? t('table.count', { n: result.total }) : undefined}
        actions={<LinksQuickCreate domain={shortDomain()} customDomains={customDomains} />}
      />

      {neverCreated ? (
        <EmptyState
          title={t('table.emptyAllTitle')}
          body={t('table.emptyAllSub')}
          action={<NewLinkButton label={t('table.emptyCta')} />}
          secondary={
            <>
              {t('table.emptyOr')} <Link href="/app/links/import">{t('table.emptyImport')}</Link>
            </>
          }
          product="link"
        />
      ) : (
        <>
          <FilterBar
            q={q}
            tag={tag}
            archived={archived}
            sort={sort}
            tags={tags}
            creator={creator}
            creators={creators.map((c) => ({ id: c.id, name: c.name || c.email }))}
          />
          {rows.length === 0 ? (
            <EmptyState
              title={t('table.emptyTitle')}
              body={t('table.emptySub')}
              action={{ label: t('table.clearFilters'), href: '/app/links' }}
              product="link"
            />
          ) : (
            <>
              <LinksTable rows={rows} />
              {pages > 1 && (
                <nav className="lk-pager" aria-label={t('table.pagination')}>
                  {result.page > 1 ? (
                    <Link
                      href={{ pathname: '/app/links', query: { ...query, page: String(result.page - 1) } }}
                      className="btn btn-sm"
                    >
                      {t('table.pagePrev')}
                    </Link>
                  ) : (
                    <span className="btn btn-sm" aria-disabled="true">
                      {t('table.pagePrev')}
                    </span>
                  )}
                  <span className="lk-pager-info data">{t('table.pageOf', { page: result.page, pages })}</span>
                  {result.page < pages ? (
                    <Link
                      href={{ pathname: '/app/links', query: { ...query, page: String(result.page + 1) } }}
                      className="btn btn-sm"
                    >
                      {t('table.pageNext')}
                    </Link>
                  ) : (
                    <span className="btn btn-sm" aria-disabled="true">
                      {t('table.pageNext')}
                    </span>
                  )}
                </nav>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
