import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { listDocPageSummaries, listDocWorkspaceTemplates, listSharedWithMe } from '@/lib/docs';
import { listDocFavorites } from '@/lib/docs-favorites';
import { listTeamspaces } from '@/lib/docs-access';
import { canCreateDocPage, docsHidden } from '@/lib/docs-guard';
import { listWikiPages } from '@/lib/docs-verify';
import DocsPageIcon from '@/components/docs/DocsPageIcon';
import {
  createDocPageAction,
  createDocPageFromTemplateAction,
  createDocPageFromWorkspaceTemplateAction,
  deleteDocWorkspaceTemplateAction,
  renameDocWorkspaceTemplateAction,
  moveDocPageAction,
  moveDocPageStepAction,
  moveDocPageToTeamspaceAction,
  reorderDocPageAction,
} from '@/lib/docs-actions';
import { getDocTemplates } from '@/lib/docs-templates';
import { formatDateTime } from '@/lib/utils';
import Icon from '@/components/app/icons';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import DataTable from '@/components/ui/DataTable';
import DocsSidebar from '@/components/docs/DocsSidebar';
import DocsTrashList from '@/components/docs/DocsTrashList';
import DocsAutoCreate from '@/components/docs/DocsAutoCreate';
import WorkspaceTemplateCard from '@/components/docs/WorkspaceTemplateCard';
import DocsTemplateGalleryButton from '@/components/docs/DocsTemplateGalleryButton';

export const dynamic = 'force-dynamic';

export default async function DocsLandingPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ new?: string; trash?: string; denied?: string }>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  // ?trash=1 (sidebar › Papelera): la sección se muestra abierta aunque esté vacía.
  const showTrash = sp.trash === '1';

  setRequestLocale(locale);
  const user = await requireUser(locale);
  // Sin content: el sidebar y las listas solo muestran título, ícono y fecha.
  // Sin las páginas de teamspaces cerrados o privados de los que no es miembro.
  const hide = await docsHidden(user);
  const [pages, trashed, shared, workspaceTemplates, favorites, teamspaces, wiki] = await Promise.all([
    listDocPageSummaries(user.id, { archived: false, hide }),
    listDocPageSummaries(user.id, { archived: true, hide }),
    listSharedWithMe(realUserId(user), user.id),
    listDocWorkspaceTemplates(user.id),
    listDocFavorites(realUserId(user), user.id),
    listTeamspaces(user.id, realUserId(user)),
    listWikiPages(user.id, hide),
  ]);
  // Miembros de solo lectura (o comentario): el inicio no ofrece crear, importar ni plantillas.
  const canCreate = await canCreateDocPage(user, {});
  const now = Date.now();
  const canDeleteAnyTemplate = isWorkspaceAdmin(user);
  const templates = getDocTemplates(locale);
  const t = await getTranslations({ locale, namespace: 'docs' });
  const createAction = createDocPageAction.bind(null, locale);
  const recent = [...pages].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 8);

  const newPageButton = !canCreate ? null : (
    <div className="docs-landing-actions">
      <Link href="/app/docs/import" className="btn" data-testid="docs-import-link">
        {t('notionImport.link')}
      </Link>
      <DocsTemplateGalleryButton
        createFromTemplate={createDocPageFromTemplateAction.bind(null, locale)}
        createFromWorkspace={createDocPageFromWorkspaceTemplateAction.bind(null, locale)}
        workspaceTemplates={workspaceTemplates}
      />
    <form action={createAction.bind(null, null)}>
      <button type="submit" className="btn btn-primary" aria-keyshortcuts="C">
        <Icon name="plus" size={15} />
        {t('landing.newPage')}
        <kbd className="kbd">C</kbd>
      </button>
    </form>
    </div>
  );

  return (
    <div className="docs-layout">
      <DocsSidebar
        pages={pages}
        shared={shared}
        favorites={favorites}
        teamspaces={teamspaces}
        meId={realUserId(user)}
        moveToTeamspaceAction={moveDocPageToTeamspaceAction}
        mobileOpenByDefault={false}
        createAction={createAction}
        canCreateRoot={canCreate}
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
        {sp.new === '1' && canCreate && <DocsAutoCreate action={createAction.bind(null, null)} />}
        <PageHeader title={t('landing.title')} actions={newPageButton} />
        {sp.denied === '1' && (
          <p className="ui-notice docs-denied" role="alert">
            {t('access.createDenied')}
          </p>
        )}

        {pages.length === 0 ? (
          <EmptyState
            product="docs"
            title={t('landing.emptyTitle')}
            body={canCreate ? t('landing.emptySub') : t('landing.emptyReadOnly')}
            action={
              canCreate ? (
                <form action={createAction.bind(null, null)}>
                  <button type="submit" className="btn btn-primary">
                    {t('landing.newPage')}
                  </button>
                </form>
              ) : undefined
            }
            secondary={
              canCreate ? (
                <a href="#templates" className="docs-inline-link">
                  {t('templates.use')}
                </a>
              ) : undefined
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
                      <DocsPageIcon icon={p.icon} pageId={p.id} size={16} />
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

        {wiki.length > 0 && (
          <section className="docs-section" id="wiki" aria-labelledby="docs-wiki">
            <h2 className="docs-section-title" id="docs-wiki">
              {t('verify.wikiTitle')}
            </h2>
            <DataTable
              caption={t('verify.wikiTitle')}
              rows={wiki}
              rowKey={(p) => p.id}
              rowHref={(p) => `/app/docs/${p.id}`}
              columns={[
                {
                  key: 'title',
                  header: t('landing.colPage'),
                  cell: (p) => (
                    <span className="docs-cell-page">
                      <DocsPageIcon icon={p.icon} pageId={p.id} size={16} />
                      {p.title || t('untitled')}
                    </span>
                  ),
                },
                {
                  key: 'state',
                  header: t('verify.colState'),
                  cell: (p) => {
                    const expired = !!p.verified_until && Date.parse(p.verified_until) <= now;
                    if (!p.verified_at) return <span className="docs-wiki-state">{t('verify.unverified')}</span>;
                    return (
                      <span className={`docs-wiki-state${expired ? ' is-expired' : ' is-ok'}`}>
                        {expired ? t('verify.expiredBadge') : p.verified_until ? t('verify.until', { date: formatDateTime(p.verified_until, locale) }) : t('verify.forever')}
                      </span>
                    );
                  },
                },
                { key: 'owner', header: t('verify.owner'), cell: (p) => p.owner_name || t('verify.noOwner') },
              ]}
            />
          </section>
        )}

        {canCreate && (
        <section className="docs-section" id="templates" aria-labelledby="docs-templates">
          <h2 className="docs-section-title" id="docs-templates">
            {t('templates.title')}
          </h2>
          <ul className="docs-templates">
            {templates.slice(0, 8).map((tpl) => (
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
        )}

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
