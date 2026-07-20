import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { listDocPages } from '@/lib/docs';
import { createDocPageFromTemplateAction } from '@/lib/docs-actions';
import { getDocTemplates } from '@/lib/docs-templates';
import { Link } from '@/i18n/navigation';
import DocsTrashList from '@/components/docs/DocsTrashList';

export const dynamic = 'force-dynamic';

export default async function DocsLandingPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const pages = await listDocPages(user.id, { archived: false });
  const trashed = await listDocPages(user.id, { archived: true });
  const templates = getDocTemplates(locale);
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

      <section className="panel">
        <div className="panel-head">
          <p className="section-label">{t('templates.title')}</p>
        </div>
        <div className="docs-templates">
          {templates.map((tpl) => (
            <form
              key={tpl.key}
              action={createDocPageFromTemplateAction.bind(null, user.id, locale, tpl.key)}
            >
              <button type="submit" className="docs-template-card">
                <span className="docs-template-icon">{tpl.icon}</span>
                <span className="docs-template-name">
                  {tpl.title || t('templates.untitled')}
                </span>
                <span className="docs-template-desc">{tpl.description}</span>
              </button>
            </form>
          ))}
        </div>
      </section>

      {pages.length === 0 ? (
        <div className="empty-state">
          <span className="empty-zeros">000</span>
          <h2>{t('landing.emptyTitle')}</h2>
          <p>{t('landing.emptySub')}</p>
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

      {trashed.length > 0 && (
        <section className="panel docs-trash">
          <div className="panel-head">
            <p className="section-label">
              {t('trash.title')} ({trashed.length})
            </p>
          </div>
          <DocsTrashList
            pages={trashed}
            labels={{
              restore: t('trash.restore'),
              deleteForever: t('trash.deleteForever'),
              confirmDelete: t('trash.confirmDelete'),
            }}
          />
        </section>
      )}
    </div>
  );
}
