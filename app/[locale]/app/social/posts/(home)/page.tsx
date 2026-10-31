import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { requireUser } from '@/lib/session';
import { isSocialAdmin, listPosts, socialActor, type ListPostsOptions } from '@/lib/social';
import { getUserTimeZone } from '@/lib/user-tz';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: t('posts.title') };
}

const TABS = ['all', 'draft', 'needs_approval', 'scheduled_any', 'published', 'failed'] as const;

/** Lista de publicaciones con pestañas por estado y búsqueda. */
export default async function SocialPostsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string; q?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  const actor = socialActor(user);
  const tab = (TABS as readonly string[]).includes(sp.status ?? '') ? (sp.status as (typeof TABS)[number]) : 'all';
  const q = sp.q?.slice(0, 200) ?? '';
  const status: ListPostsOptions['status'] = tab === 'all' ? undefined : tab === 'failed' ? undefined : tab;
  let posts = await listPosts(actor, { status, q: q || undefined, limit: 300 });
  if (tab === 'failed') posts = posts.filter((p) => p.status === 'failed' || p.status === 'partial');
  const tz = await getUserTimeZone();
  const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(iso)) : '');
  const href = (s: string) => `/app/social/posts${s === 'all' ? '' : `?status=${s}`}`;

  return (
    <div className="ui-page">
      <PageHeader
        title={t('posts.title')}
        description={t('posts.description')}
        actions={
          <Link className="btn btn-primary" href="/app/social/posts/new">
            {t('sidebar.newPost')}
          </Link>
        }
      />
      <div className="sc-page">
        <div className="sc-row">
          <nav className="ui-tabs sc-grow" aria-label={t('posts.title')}>
            {TABS.filter((s) => s !== 'needs_approval' || isSocialAdmin(actor) || tab === s).map((s) => (
              <Link key={s} className="ui-tab" href={href(s)} aria-current={tab === s ? 'page' : undefined}>
                {t(`posts.tab_${s}`)}
              </Link>
            ))}
          </nav>
          <form method="get" role="search" className="sc-row">
            {tab !== 'all' && <input type="hidden" name="status" value={tab} />}
            <input className="input" type="search" name="q" defaultValue={q} placeholder={t('posts.search')} aria-label={t('posts.search')} />
          </form>
        </div>
        {posts.length === 0 ? (
          <EmptyState
            title={q ? t('posts.noResults') : t('posts.emptyTitle')}
            body={q ? undefined : t('posts.emptyBody')}
            product="social"
            action={q ? undefined : { label: t('sidebar.newPost'), href: '/app/social/posts/new' }}
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
