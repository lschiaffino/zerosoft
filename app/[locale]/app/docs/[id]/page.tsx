import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import type { Metadata } from 'next';
import { getCurrentUser, realUserId, requireUser } from '@/lib/session';
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
import { ICON_IMAGE_PREFIX, stripFileUrls } from '@/lib/docs-files';
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
import { canShareAccess, coeditEnvOverride, getDocsSettings, getTeamspace, listTeamspaces } from '@/lib/docs-access';
import { canCreateDocPage, docsAdmin, docsHidden, editorBlocks } from '@/lib/docs-guard';
import { listPageInvites } from '@/lib/docs-guests';
import { cleanForReaders } from '@/lib/docs-marks';
import DocsSidebar from '@/components/docs/DocsSidebar';
import DocsEditorClient from '@/components/docs/DocsEditorClient';
import DocsReadOnlyView from '@/components/docs/DocsReadOnlyView';
import DocsPageIcon from '@/components/docs/DocsPageIcon';
import { verifiedSiteHost } from '@/lib/docs-site';
import '@/styles/help.css';

export const dynamic = 'force-dynamic';

/** La pestaña lleva el título de la página (con su emoji si tiene), como en Notion. */
export async function generateMetadata(props: { params: Promise<{ locale: string; id: string }> }): Promise<Metadata> {
  const { locale, id } = await props.params;
  const t = await getTranslations({ locale, namespace: 'docs' });
  const user = await getCurrentUser();
  const resolved = user ? await resolveDocAccess(user, id).catch(() => null) : null;
  if (!resolved) return { title: 'Docs' };
  const { row } = resolved;
  const icon = row.icon && !row.icon.startsWith(ICON_IMAGE_PREFIX) ? `${row.icon} ` : '';
  return { title: `${icon}${row.title?.trim() || t('untitled')}` };
}

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
  const isOwner = access === 'owner';
  // Miembro del workspace (con cualquier rol): ve el árbol y los ancestros.
  const inWorkspace = row.user_id === user.id;
  const canShare = canShareAccess(access);

  // Cada consulta es un viaje a la base (Turso): lo que no depende entre sí va
  // en paralelo, en dos tandas (la segunda necesita los teamspaces ocultos).
  const [hide, settings, ts, mentionables, canSeeVersions, blocksNow, ancestors, shares, invites, subpages, feedback, siteHost, owner, canCreateRoot] =
    await Promise.all([
      // El árbol va sin las páginas de teamspaces cerrados o privados de los que no es miembro.
      docsHidden(user),
      getDocsSettings(row.user_id),
      row.teamspace_id ? getTeamspace(row.teamspace_id) : Promise.resolve(null),
      listPageMentionables(row),
      // El historial no se expone a quien solo llega porque la página está publicada.
      access !== 'view' ? Promise.resolve(true) : getDocAccess(row, user, DOC_INTERNAL_READ).then((a) => a !== null),
      // Lectura: sincronizados con su contenido actual ("sin acceso" si no ve el origen). Edición:
      // lo mismo que el polling en vivo y la respuesta de guardar (editorBlocks), base de la fusión.
      access === 'view' ? visibleBlocks(row, row.content, { actor: user }) : editorBlocks(row, user),
      // A un invitado no se le muestran los ancestros (títulos de otro workspace).
      inWorkspace ? getDocPageAncestors(user.id, id) : Promise.resolve([]),
      // Propios y heredados de los ancestros (el diálogo dice de dónde viene cada uno).
      canShare ? listEffectiveDocShares(row).then((list) => decorateShares(row.user_id, list)) : Promise.resolve([]),
      canShare ? listPageInvites(id) : Promise.resolve([]),
      // Un invitado no tiene el árbol del workspace: navega el subárbol compartido desde acá.
      inWorkspace ? Promise.resolve([]) : listAccessibleSubpages(user, id),
      isOwner && page.published ? getHelpFeedbackStats(user.id, id) : Promise.resolve(null),
      // Con dominio propio verificado, el link público es el del dominio.
      isOwner && user.handle ? verifiedSiteHost(user.id) : Promise.resolve(null),
      inWorkspace ? Promise.resolve(null) : getUserById(row.user_id),
      inWorkspace ? canCreateDocPage(user, {}) : Promise.resolve(false),
    ]);
  const [allPages, shared, comments, favorites, teamspaces, backlinks] = await Promise.all([
    // El árbol va sin content (solo título, ícono y orden).
    listDocPageSummaries(user.id, { archived: false, hide }),
    listSharedWithMe(realUserId(user), user.id),
    listDocComments(id),
    listDocFavorites(realUserId(user), user.id),
    listTeamspaces(user.id, realUserId(user)),
    inWorkspace ? listDocBacklinks(user.id, id, hide) : Promise.resolve([]),
  ]);
  if (access === 'view') page.content = blocksNow;
  // Edición simultánea (beta): DOCS_COEDIT manda; si no está, el ajuste del workspace (apagada: guardar y fusionar como antes).
  const coedit = coeditEnvOverride() ?? settings.coedit;
  // Exportar: como docsAllowed, con los ajustes ya leídos (sin otra consulta).
  const allowExport = settings.allow_export || (user.id === row.user_id && docsAdmin(user));
  // Rol que hereda la página si no fija uno: el del teamspace o el de Ajustes.
  const memberRoleDefault = ts?.member_role ?? settings.member_role;
  // Personas del workspace dueño (autores de sugerencias y dueño de la wiki).
  const people = Object.fromEntries(mentionables.map((m) => [m.id, m.name?.trim() || m.email]));
  const canVerify = isOwner || (row.page_owner_id === realUserId(user) && access !== 'view' && access !== 'comment');
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
      : blocksNow;

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
        canCreateRoot={inWorkspace && canCreateRoot}
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
            coedit={coedit}
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
              offlineOwner={`${user.actingUser?.id ?? user.id}:${user.id}`}
              coedit={coedit}
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
