import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import CalendarView from '@/components/social/CalendarView';
import { requireUser } from '@/lib/session';
import { listAccounts, listPosts, socialActor } from '@/lib/social';
import { getUserTimeZone } from '@/lib/user-tz';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: t('meta.title') };
}

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Calendario de publicaciones (mes o semana): la entrada de Social. */
export default async function SocialCalendarPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ view?: string; date?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  const actor = socialActor(user);
  const tz = await getUserTimeZone();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const view = sp.view === 'week' ? 'week' : 'month';
  const anchor = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  // Rango con margen (la grilla del mes arranca el lunes anterior y dura 6 semanas).
  const from = addDays(view === 'month' ? `${anchor.slice(0, 7)}-01` : anchor, -8);
  const to = addDays(from, 52);
  const [accounts, posts] = await Promise.all([listAccounts(actor), listPosts(actor, { from: `${from}T00:00:00.000Z`, to: `${to}T00:00:00.000Z`, limit: 500 })]);

  return (
    <div className="ui-page">
      <PageHeader
        title={t('calendar.title')}
        description={t('calendar.description')}
        actions={
          <Link className="btn btn-primary" href={`/app/social/posts/new${anchor !== today ? `?date=${anchor}` : ''}`}>
            {t('sidebar.newPost')}
          </Link>
        }
      />
      {accounts.length === 0 && posts.length === 0 ? (
        <EmptyState
          title={t('calendar.emptyTitle')}
          body={t('calendar.emptyBody')}
          product="social"
          action={{ label: t('calendar.emptyAction'), href: '/app/social/accounts' }}
        />
      ) : (
        <CalendarView posts={posts} view={view} anchor={anchor} tz={tz} today={today} />
      )}
    </div>
  );
}
