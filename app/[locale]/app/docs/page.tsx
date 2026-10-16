import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { listDocPageSummaries, listSharedWithMe } from '@/lib/docs';
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
import DocsAutoCreate from '@/components/docs/DocsAutoCreate';

export const dynamic = 'force-dynamic';

export default async function DocsLandingPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ new?: string; trash?: string }>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  // ?trash=1 (sidebar › Papelera): la sección se muestra abierta aunque esté vacía.
  const showTrash = sp.trash === '1';

  setRequestLocale(locale);
  const user = await requireUser(locale);
  // Sin content: el sidebar y las listas solo muestran título, ícono y fecha.
  const pages = await listDocPageSummaries(user.id, { archived: false });
  const trashed = await listDocPageSummaries(user.id, { archived: true });
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
        {sp.new === '1' && <DocsAutoCreate action={createAction.bind(null, null)} />}
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

        <section className="docs-section" id="templates">
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

        {(trashed.length > 0 || showTrash) && (
          <details className="docs-section docs-trash" id="trash" open={showTrash || undefined}>
            <summary className="section-label">
              {t('trash.title')} <span className="mono">({trashed.length})</span>
            </summary>
            <p className="docs-trash-help muted">{trashed.length > 0 ? t('trash.help') : t('trash.empty')}</p>
            <DocsTrashList
              pages={trashed}
              canDelete={isWorkspaceAdmin(user)}
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
