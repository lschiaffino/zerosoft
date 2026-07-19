import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { listDocPages } from '@/lib/docs';
import { Link } from '@/i18n/navigation';

export const dynamic = 'force-dynamic';

export default async function DocsLandingPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const pages = await listDocPages(user.id, { archived: false });
  const t = await getTranslations({ locale, namespace: 'docs' });

  return (
    <div className="docs-landing app-page">
      <div className="page-head">
        <div>
          <h1 className="app-title">{t('landing.title')}</h1>
          <p className="app-sub">{t('landing.subtitle')}</p>
        </div>
        <form
          action={async () => {
            'use server';
            const { createDocPage } = await import('@/lib/docs');
            const page = await createDocPage(user.id, { title: '' });
            redirect(`/${locale}/app/docs/${page.id}`);
          }}
        >
          <button type="submit" className="btn btn-solid">
            {t('landing.newPage')}
          </button>
        </form>
      </div>

      {pages.length === 0 ? (
        <div className="empty-state">
          <span className="empty-zeros">000</span>
          <h2>{t('landing.emptyTitle')}</h2>
          <p>{t('landing.emptySub')}</p>
          <form
            action={async () => {
              'use server';
              const { createDocPage } = await import('@/lib/docs');
              const page = await createDocPage(user.id, { title: '' });
              redirect(`/${locale}/app/docs/${page.id}`);
            }}
          >
            <button type="submit" className="btn btn-small">
              {t('landing.newPage')}
            </button>
          </form>
        </div>
      ) : (
        <section className="panel">
          <div className="panel-head">
            <p className="section-label">{t('landing.latest')}</p>
          </div>
          <ul className="docs-list">
            {pages.slice(0, 10).map((page) => (
              <li key={page.id}>
                <Link href={`/app/docs/${page.id}`} className="docs-list-row">
                  <span className="docs-list-icon">{page.icon ?? '📄'}</span>
                  <span className="docs-list-title">{page.title || 'Untitled'}</span>
                  <span className="docs-list-date mono">{page.updated_at}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
