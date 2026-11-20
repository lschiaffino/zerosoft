import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { requireUser } from '@/lib/session';
import PostsFilters from '@/components/social/PostsFilters';
import { isSocialAdmin, listAccounts, listPosts, socialActor, type ListPostsOptions } from '@/lib/social';
import { isSocialNetwork, SOCIAL_NETWORKS } from '@/lib/social-networks';
import { getUserTimeZone } from '@/lib/user-tz';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: t('posts.title') };
}

const TABS = ['all', 'draft', 'needs_approval', 'scheduled_any', 'published', 'failed'] as const;

/** Lista de publicaciones con pestañas por estado, búsqueda y filtros por cuenta y red. */
export default async function SocialPostsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; q?: string; account?: string; network?: string }>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  const actor = socialActor(user);
  const tab = (TABS as readonly string[]).includes(sp.status ?? '') ? (sp.status as (typeof TABS)[number]) : 'all';
  const q = sp.q?.slice(0, 200) ?? '';
  const status: ListPostsOptions['status'] = tab === 'all' ? undefined : tab === 'failed' ? undefined : tab;
  const accounts = await listAccounts(actor);
  // Solo cuentas que la persona ve; un id ajeno o viejo se ignora.
  const account = accounts.some((a) => a.id === sp.account) ? (sp.account as string) : '';
  const network = isSocialNetwork(sp.network) ? sp.network : undefined;
  const networks = SOCIAL_NETWORKS.filter((n) => accounts.some((a) => a.network === n));
  let posts = await listPosts(actor, { status, q: q || undefined, accountId: account || undefined, network, limit: 300 });
  if (tab === 'failed') posts = posts.filter((p) => p.status === 'failed' || p.status === 'partial');
  const tz = await getUserTimeZone();
  const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(iso)) : '');
  const filtered = Boolean(q || account || network);
  const href = (s: string) => {
    const qs = new URLSearchParams();
    if (s !== 'all') qs.set('status', s);
    if (account) qs.set('account', account);
    if (network) qs.set('network', network);
    const str = qs.toString();
    return `/app/social/posts${str ? `?${str}` : ''}`;
  };

  return (
    <div className="ui-page">
      <PageHeader
        title={t('posts.title')}
        description={t('posts.description')}
        actions={
          <>
            <Link className="btn" href="/app/social/posts/import" data-testid="posts-import">
              {t('bulk.open')}
            </Link>
            <Link className="btn btn-primary" href="/app/social/posts/new">
              {t('sidebar.newPost')}
            </Link>
          </>
        }
      />
      <div className="sc-page">
        <nav className="ui-tabs" aria-label={t('posts.title')} data-testid="posts-tabs">
          {TABS.filter((s) => s !== 'needs_approval' || isSocialAdmin(actor) || tab === s).map((s) => (
            <Link key={s} className="ui-tab" href={href(s)} aria-current={tab === s ? 'page' : undefined}>
              {t(`posts.tab_${s}`)}
            </Link>
          ))}
        </nav>
        <div className="sc-row sc-toolbar">
          <PostsFilters
            accounts={accounts.map((a) => ({ id: a.id, name: a.name, network: a.network }))}
            networks={networks}
            account={account}
            network={network ?? ''}
            status={tab}
            q={q}
          />
          <form method="get" role="search" className="sc-row sc-grow">
            {tab !== 'all' && <input type="hidden" name="status" value={tab} />}
            {account && <input type="hidden" name="account" value={account} />}
            {network && <input type="hidden" name="network" value={network} />}
            <input className="input" type="search" name="q" defaultValue={q} placeholder={t('posts.search')} aria-label={t('posts.search')} />
          </form>
        </div>
        {posts.length === 0 ? (
          <EmptyState
            title={filtered ? t('posts.noResults') : t('posts.emptyTitle')}
            body={filtered ? undefined : t('posts.emptyBody')}
            product="social"
            action={
              filtered ? (
                <Link className="btn" href={tab === 'all' ? '/app/social/posts' : `/app/social/posts?status=${tab}`} data-testid="posts-clear-filters">
                  {t('posts.clearFilters')}
                </Link>
              ) : (
                { label: t('sidebar.newPost'), href: '/app/social/posts/new' }
              )
            }
          />
        ) : (
          <div className="sc-list" data-testid="posts-list">
            {posts.map((p) => (
              <Link key={p.id} href={`/app/social/posts/${p.id}`} className="sc-item">
                <div className="sc-item-main">
                  <span className="sc-item-text">{p.text || t('calendar.mediaOnly')}</span>
                  <div className="sc-row">
                    {p.targets.map((x) => (
                      <span key={x.id} className="sc-net" data-net={x.account?.network ?? ''}>
                        {x.account?.name ?? t('post.disconnected')}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="sc-item-side">
                  <span className="sc-status" data-s={p.status}>
                    {t(`status.${p.status}`)}
                  </span>
                  <span className="sc-muted sc-small">{fmt(p.publishedAt ?? p.scheduledAt ?? p.updatedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
