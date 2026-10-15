import { getTranslations, setRequestLocale } from 'next-intl/server';
import { realUserId, requireUser } from '@/lib/session';
import { listDocPages, listSharedWithMe } from '@/lib/docs';
import {
  createDocPageAction,
  createDocPageFromTemplateAction,
  moveDocPageAction,
  moveDocPageStepAction,
  reorderDocPageAction,
} from '@/lib/docs-actions';
import { getDocTemplates } from '@/lib/docs-templates';
import { formatDateTime } from '@/lib/utils';
import { Link } from '@/i18n/navigation';
import DocsSidebar from '@/components/docs/DocsSidebar';
import DocsTrashList from '@/components/docs/DocsTrashList';

export const dynamic = 'force-dynamic';

export default async function DocsLandingPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;

  setRequestLocale(locale);
  const user = await requireUser(locale);
  const pages = await listDocPages(user.id, { archived: false });
  const trashed = await listDocPages(user.id, { archived: true });
  const shared = await listSharedWithMe(realUserId(user), user.id);
  const templates = getDocTemplates(locale);
  const t = await getTranslations({ locale, namespace: 'docs' });
  const createAction = createDocPageAction.bind(null, locale);

  return (
    <div className="docs-layout">
      <DocsSidebar
        pages={pages}
        trashCount={trashed.length}
        shared={shared}
        mobileOpenByDefault={false}
        createAction={createAction}
        moveAction={moveDocPageAction}
        reorderAction={reorderDocPageAction}
        stepAction={moveDocPageStepAction}
        labels={{
          newPage: t('sidebar.newPage'),
          newSubpage: t('sidebar.newSubpage'),
          empty: t('sidebar.empty'),
        }}
      />

      <div className="docs-main docs-landing">
        <div className="page-head">
          <div>
            <h1 className="app-title">{t('landing.title')}</h1>
            <p className="app-sub">{t('landing.subtitle')}</p>
          </div>
          <form action={createAction.bind(null, null)}>
            <button type="submit" className="btn btn-solid btn-small" title={`${t('landing.newPage')} (C)`}>
              + {t('landing.newPage')}
              <span className="kbd-hint">C</span>
            </button>
          </form>
        </div>

        {pages.length === 0 ? (
          <div className="empty-state docs-empty">
            <span className="empty-zeros mono" aria-hidden>
              0 0 0
            </span>
            <h2>{t('landing.emptyTitle')}</h2>
            <p className="muted">{t('landing.emptySub')}</p>
            <form action={createAction.bind(null, null)}>
              <button type="submit" className="btn btn-solid btn-small">
                + {t('landing.newPage')}
              </button>
            </form>
          </div>
        ) : (
          <section className="docs-section">
            <p className="section-label">{t('landing.latest')}</p>
            <ul className="docs-list">
              {pages.slice(0, 10).map((page) => (
                <li key={page.id}>
                  <Link href={`/app/docs/${page.id}`} className="docs-list-row">
                    <span className="docs-list-icon">{page.icon ?? '📄'}</span>
                    <span className="docs-list-title">{page.title || t('untitled')}</span>
                    <span className="docs-list-date mono">
                      {t('landing.edited', { date: formatDateTime(page.updated_at, locale) })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="docs-section">
          <p className="section-label">{t('templates.title')}</p>
          <div className="docs-templates">
            {templates.map((tpl) => (
              <form key={tpl.key} action={createDocPageFromTemplateAction.bind(null, locale, tpl.key)}>
                <button type="submit" className="docs-template-card">
                  <span className="docs-template-icon">{tpl.icon}</span>
                  <span className="docs-template-name">{tpl.title || t('templates.untitled')}</span>
                  <span className="docs-template-desc">{tpl.description}</span>
                </button>
              </form>
            ))}
          </div>
        </section>

        {trashed.length > 0 && (
          <details className="docs-section docs-trash" id="trash">
            <summary className="section-label">
              {t('trash.title')} <span className="mono">({trashed.length})</span>
            </summary>
            <p className="docs-trash-help muted">{t('trash.help')}</p>
            <DocsTrashList
              pages={trashed}
              labels={{
                restore: t('trash.restore'),
                deleteForever: t('trash.deleteForever'),
                confirmDelete: t('trash.confirmDelete'),
              }}
            />
          </details>
        )}
      </div>
    </div>
  );
}
