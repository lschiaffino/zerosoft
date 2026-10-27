import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { realUserId, requireUser } from '@/lib/session';
import { getUserById } from '@/lib/db';
import {
  DOC_INTERNAL_READ,
  decorateShares,
  getDocAccess,
  getDocPageAncestors,
  listDocBacklinks,
  listDocComments,
  listAccessibleSubpages,
  listDocPageSummaries,
  listEffectiveDocShares,
  listPageMentionables,
  listSharedWithMe,
  resolveDocAccess,
  toDocPage,
} from '@/lib/docs';
import { getHelpFeedbackStats } from '@/lib/docs-help';
import { sanitizeBlocks } from '@/lib/docs-sanitize';
import { stripFileUrls } from '@/lib/docs-files';
import { visibleBlocks } from '@/lib/docs-visible';
import { listDocFavorites } from '@/lib/docs-favorites';
import { pageLinkHref, resolveBlocksPageLinks } from '@/lib/docs-page-links';
import {
  createDocPageAction,
  moveDocPageAction,
  moveDocPageStepAction,
  moveDocPageToTeamspaceAction,
  reorderDocPageAction,
} from '@/lib/docs-actions';
import { canShareAccess, getDocsSettings, getTeamspace, listTeamspaces } from '@/lib/docs-access';
import { canCreateDocPage, docsAllowed, docsHidden, editorBlocks } from '@/lib/docs-guard';
import { listPageInvites } from '@/lib/docs-guests';
import { cleanForReaders } from '@/lib/docs-marks';
import DocsSidebar from '@/components/docs/DocsSidebar';
import DocsEditorClient from '@/components/docs/DocsEditorClient';
import DocsReadOnlyView from '@/components/docs/DocsReadOnlyView';
import DocsPageIcon from '@/components/docs/DocsPageIcon';
import { verifiedSiteHost } from '@/lib/docs-site';
import '@/styles/help.css';

export const dynamic = 'force-dynamic';

export default async function DocsPageEditor(
  props: {
    params: Promise<{ locale: string; id: string }>;
  }
) {
  const params = await props.params;

  const {
    locale,
    id
  } = params;

  setRequestLocale(locale);
  const user = await requireUser(locale);
  // Dueño del workspace o invitado (share de persona/team, o publicada).
  const resolved = await resolveDocAccess(user, id);
  if (!resolved) notFound();
  const { row, access } = resolved;
  const page = toDocPage(row);
  // Bloques sincronizados: el contenido actual (puede haberse editado en otra
  // página); sin acceso a su página de origen, "sin acceso" (como Notion).
  page.content = await visibleBlocks(row, row.content, { actor: user });
  const isOwner = access === 'owner';
  // Miembro del workspace (con cualquier rol): ve el árbol y los ancestros.
  const inWorkspace = row.user_id === user.id;
  // El historial no se expone a quien solo llega porque la página está publicada.
  const canSeeVersions =
    access !== 'view' || (await getDocAccess(row, user, DOC_INTERNAL_READ)) !== null;

  // El árbol va sin content (solo título, ícono y orden); sin las páginas de
  // teamspaces cerrados o privados de los que no es miembro.
  const hide = await docsHidden(user);
  const [allPages, shared, comments, favorites, teamspaces] = await Promise.all([
    listDocPageSummaries(user.id, { archived: false, hide }),
    listSharedWithMe(realUserId(user), user.id),
    listDocComments(id),
    listDocFavorites(realUserId(user), user.id),
    listTeamspaces(user.id, realUserId(user)),
  ]);
  // A un invitado no se le muestran los ancestros (títulos de otro workspace).
  const ancestors = inWorkspace ? await getDocPageAncestors(user.id, id) : [];
  // Propios y heredados de los ancestros (el diálogo dice de dónde viene cada uno).
  const canShare = canShareAccess(access);
  const shares = canShare ? await decorateShares(row.user_id, await listEffectiveDocShares(row)) : [];
  const invites = canShare ? await listPageInvites(id) : [];
  // Un invitado no tiene el árbol del workspace: navega el subárbol compartido desde acá.
  const subpages = inWorkspace ? [] : await listAccessibleSubpages(user, id);
  const backlinks = inWorkspace ? await listDocBacklinks(user.id, id, hide) : [];
  const settings = await getDocsSettings(row.user_id);
  const allowExport = await docsAllowed(user, row.user_id, 'allow_export');
  // Rol que hereda la página si no fija uno: el del teamspace o el de Ajustes.
  const ts = row.teamspace_id ? await getTeamspace(row.teamspace_id) : null;
  const memberRoleDefault = ts?.member_role ?? settings.member_role;
  // Personas del workspace dueño (autores de sugerencias y dueño de la wiki).
  const people = Object.fromEntries((await listPageMentionables(row)).map((m) => [m.id, m.name?.trim() || m.email]));
  const canVerify = isOwner || (row.page_owner_id === realUserId(user) && access !== 'view' && access !== 'comment');
  const feedback = isOwner && page.published ? await getHelpFeedbackStats(user.id, id) : null;
  // Con dominio propio verificado, el link público es el del dominio.
  const siteHost = isOwner && user.handle ? await verifiedSiteHost(user.id) : null;
  const helpBase = isOwner && user.handle ? (siteHost ? `https://${siteHost}` : `/${locale}/h/${user.handle}`) : null;
  const t = await getTranslations({ locale, namespace: 'docs' });

  // Links `[[` con el título actual de la página linkeada (si es del
  // workspace de quien mira; si no, queda el título con que se insertó).
  const titles = new Map(allPages.map((p) => [p.id, p.title || t('untitled')]));
  // El editor recibe el content tal cual (ya se sanitizó al guardar); la lectura se re-sanitiza.
  // Solo lectura: tampoco viaja la URL del storage de imágenes/archivos (se
  // sirven por /api/docs/files, que chequea el acceso).
  // El editor recibe lo mismo que el polling en vivo y la respuesta de guardar
  // (editorBlocks): es la base de la fusión de cambios simultáneos.
  const content =
    access === 'view'
      ? resolveBlocksPageLinks(stripFileUrls(sanitizeBlocks(cleanForReaders(page.content))), (pageId) => ({
          href: `/${locale}${pageLinkHref(pageId)}`,
          title: titles.get(pageId) ?? null,
        }))
      : await editorBlocks(row, user);

  const owner = inWorkspace ? null : await getUserById(row.user_id);
  // Lectura: nombres de las personas de las bases (solo si la página tiene una).
  const dbPeople = access === 'view' && page.content.some((b) => b.type === 'database') ? people : undefined;
  const sharedBy = owner ? owner.name || owner.email : null;

  return (
    <div className="docs-layout">
      <DocsSidebar
        pages={allPages}
        currentId={id}
        shared={shared}
        favorites={favorites}
        teamspaces={teamspaces}
        meId={realUserId(user)}
        moveToTeamspaceAction={moveDocPageToTeamspaceAction}
        createAction={createDocPageAction.bind(null, locale)}
        canCreateRoot={inWorkspace && (await canCreateDocPage(user, {}))}
        moveAction={moveDocPageAction}
        reorderAction={reorderDocPageAction}
        stepAction={moveDocPageStepAction}
        labels={{
          newPage: t('sidebar.newPage'),
          newSubpage: t('sidebar.newSubpage'),
          empty: t('sidebar.empty'),
        }}
      />
      <div className="docs-main">
        {access === 'view' ? (
          <DocsReadOnlyView
            page={{ ...page, content }}
            sharedBy={sharedBy}
            showVersions={canSeeVersions}
            people={dbPeople}
            allowExport={allowExport}
          />
        ) : (
          <>
            {/* Comentar: el aviso va en el banner del editor (uno solo). */}
            {!inWorkspace && sharedBy && access !== 'comment' && (
              <p className="docs-shared-banner" role="status">
                {t('share.sharedEditBanner', { name: sharedBy })}
              </p>
            )}
            <DocsEditorClient
              page={{ ...page, content }}
              ancestors={ancestors}
              shares={shares}
              invites={invites}
              comments={comments}
              access={access}
              helpBase={helpBase}
              feedback={feedback}
              backlinks={backlinks}
              currentUserId={user.actingUser?.id ?? user.id}
              commentNote={!inWorkspace && sharedBy && access === 'comment' ? t('share.sharedCommentBanner', { name: sharedBy }) : undefined}
              favorite={inWorkspace ? favorites.some((f) => f.id === id) : null}
              people={people}
              canVerify={canVerify}
              allowExport={allowExport}
              memberRoleDefault={memberRoleDefault}
              commentsLabels={{
                title: t('comments.title'),
                empty: t('comments.empty'),
                placeholder: t('comments.placeholder'),
                add: t('comments.add'),
                resolve: t('comments.resolve'),
                unresolve: t('comments.unresolve'),
                delete: t('comments.delete'),
                resolved: t('comments.resolved'),
                blockThread: t('comments.blockThread'),
                showAll: t('comments.showAll'),
                blockTag: t('comments.blockTag'),
              }}
            />
          </>
        )}
        {subpages.length > 0 && (
          <nav className="docs-subpages" aria-label={t('share.subpages')}>
            <p className="docs-subpages-label">{t('share.subpages')}</p>
            <ul>
              {subpages.map((p) => (
                <li key={p.id}>
                  <Link href={`/app/docs/${p.id}`} className="docs-subpages-link">
                    <DocsPageIcon icon={p.icon} pageId={p.id} size={14} />
                    <span>{p.title || t('untitled')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}
