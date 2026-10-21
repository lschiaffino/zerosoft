import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { listDocPageSummaries, listDocWorkspaceTemplates, listSharedWithMe } from '@/lib/docs';
import {
  createDocPageAction,
  createDocPageFromTemplateAction,
  createDocPageFromWorkspaceTemplateAction,
  deleteDocWorkspaceTemplateAction,
  renameDocWorkspaceTemplateAction,
  moveDocPageAction,
  moveDocPageStepAction,
  reorderDocPageAction,
} from '@/lib/docs-actions';
import { getDocTemplates } from '@/lib/docs-templates';
import { formatDateTime } from '@/lib/utils';
import Icon from '@/components/app/icons';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import DataTable from '@/components/ui/DataTable';
import DocsSidebar from '@/components/docs/DocsSidebar';
import DocsTrashList from '@/components/docs/DocsTrashList';
import DocsAutoCreate from '@/components/docs/DocsAutoCreate';
import WorkspaceTemplateCard from '@/components/docs/WorkspaceTemplateCard';

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
  const [pages, trashed, shared, workspaceTemplates] = await Promise.all([
    listDocPageSummaries(user.id, { archived: false }),
    listDocPageSummaries(user.id, { archived: true }),
    listSharedWithMe(realUserId(user), user.id),
    listDocWorkspaceTemplates(user.id),
  ]);
  const canDeleteAnyTemplate = isWorkspaceAdmin(user);
  const templates = getDocTemplates(locale);
  const t = await getTranslations({ locale, namespace: 'docs' });
  const createAction = createDocPageAction.bind(null, locale);
  const recent = [...pages].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 8);

  const newPageButton = (
    <form action={createAction.bind(null, null)}>
      <button type="submit" className="btn btn-primary" aria-keyshortcuts="C">
        <Icon name="plus" size={15} />
        {t('landing.newPage')}
        <kbd className="kbd">C</kbd>
      </button>
    </form>
  );

  return (
    <div className="docs-layout">
      <DocsSidebar
        pages={pages}
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

      <div className="docs-main docs-landing ui-page">
        {sp.new === '1' && <DocsAutoCreate action={createAction.bind(null, null)} />}
        <PageHeader title={t('landing.title')} actions={newPageButton} />

        {pages.length === 0 ? (
          <EmptyState
            product="docs"
            title={t('landing.emptyTitle')}
            body={t('landing.emptySub')}
            action={
              <form action={createAction.bind(null, null)}>
                <button type="submit" className="btn btn-primary">
                  {t('landing.newPage')}
                </button>
              </form>
            }
            secondary={
              <a href="#templates" className="docs-inline-link">
                {t('templates.use')}
              </a>
            }
          />
        ) : (
          <section className="docs-section" aria-labelledby="docs-recent">
            <h2 className="docs-section-title" id="docs-recent">
              {t('landing.latest')}
            </h2>
            <DataTable
              caption={t('landing.latest')}
              rows={recent}
              rowKey={(p) => p.id}
              rowHref={(p) => `/app/docs/${p.id}`}
              columns={[
                {
                  key: 'title',
                  header: t('landing.colPage'),
                  cell: (p) => (
                    <span className="docs-cell-page">
                      {p.icon && <span aria-hidden="true">{p.icon}</span>}
                      {p.title || t('untitled')}
                    </span>
                  ),
                },
                {
                  key: 'edited',
                  header: t('landing.colEdited'),
                  cell: (p) => formatDateTime(p.updated_at, locale),
                  numeric: true,
                  width: '200px',
                },
              ]}
            />
          </section>
        )}

        <section className="docs-section" id="templates" aria-labelledby="docs-templates">
          <h2 className="docs-section-title" id="docs-templates">
            {t('templates.title')}
          </h2>
          <ul className="docs-templates">
            {templates.map((tpl) => (
              <li key={tpl.key}>
                <form action={createDocPageFromTemplateAction.bind(null, locale, tpl.key)}>
                  <button type="submit" className="docs-template">
                    <span className="docs-template-name">{tpl.title || t('templates.untitled')}</span>
                    <span className="docs-template-desc">{tpl.description}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
          {workspaceTemplates.length > 0 && (
            <>
              <h3 className="docs-templates-subtitle">{t('templates.workspace')}</h3>
              <ul className="docs-templates" data-testid="docs-workspace-templates">
                {workspaceTemplates.map((tpl) => (
                  <WorkspaceTemplateCard
                    key={tpl.id}
                    template={tpl}
                    canEdit={canDeleteAnyTemplate || tpl.created_by === realUserId(user)}
                    createAction={createDocPageFromWorkspaceTemplateAction.bind(null, locale, tpl.id)}
                    renameAction={renameDocWorkspaceTemplateAction.bind(null, tpl.id)}
                    deleteAction={deleteDocWorkspaceTemplateAction.bind(null, tpl.id)}
                  />
                ))}
              </ul>
            </>
          )}
        </section>

        {(trashed.length > 0 || showTrash) && (
          <details className="docs-section docs-trash" id="trash" open={showTrash || undefined}>
            <summary className="docs-section-title docs-trash-summary">
              <Icon name="chevronRight" size={14} />
              {t('trash.title')}
              <span className="docs-trash-count">{t('trash.count', { count: trashed.length })}</span>
            </summary>
            {trashed.length > 0 ? (
              <>
                <p className="docs-trash-help">{t('trash.help')}</p>
                <DocsTrashList
                  pages={trashed}
                  canDelete={isWorkspaceAdmin(user)}
                  labels={{
                    restore: t('trash.restore'),
                    deleteForever: t('trash.deleteForever'),
                    confirmDelete: t('trash.confirmDelete'),
                  }}
                />
              </>
            ) : (
              <EmptyState quiet product="docs" title={t('trash.empty')} />
            )}
          </details>
        )}
      </div>
    </div>
  );
}
