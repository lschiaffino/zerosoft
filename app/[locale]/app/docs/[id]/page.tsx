import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { realUserId, requireUser } from '@/lib/session';
import { getUserById } from '@/lib/db';
import {
  DOC_INTERNAL_READ,
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
import { hydrateSyncedBlocks } from '@/lib/docs-synced';
import { listDocFavorites } from '@/lib/docs-favorites';
import { pageLinkHref, resolveBlocksPageLinks } from '@/lib/docs-page-links';
import {
  createDocPageAction,
  moveDocPageAction,
  moveDocPageStepAction,
  reorderDocPageAction,
} from '@/lib/docs-actions';
import DocsSidebar from '@/components/docs/DocsSidebar';
import DocsEditorClient from '@/components/docs/DocsEditorClient';
import DocsReadOnlyView from '@/components/docs/DocsReadOnlyView';
import DocsPageIcon from '@/components/docs/DocsPageIcon';
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
  // Bloques sincronizados: el contenido actual (puede haberse editado en otra página).
  page.content = await hydrateSyncedBlocks(row.user_id, page.content);
  const isOwner = access === 'owner';
  // El historial no se expone a quien solo llega porque la página está publicada.
  const canSeeVersions =
    access !== 'view' || (await getDocAccess(row, user, DOC_INTERNAL_READ)) !== null;

  // El árbol va sin content (solo título, ícono y orden).
  const [allPages, shared, comments, favorites] = await Promise.all([
    listDocPageSummaries(user.id, { archived: false }),
    listSharedWithMe(realUserId(user), user.id),
    listDocComments(id),
    listDocFavorites(realUserId(user), user.id),
  ]);
  // A un invitado no se le muestran los ancestros (títulos de otro workspace).
  const ancestors = isOwner ? await getDocPageAncestors(user.id, id) : [];
  // Propios y heredados de los ancestros (el diálogo dice de dónde viene cada uno).
  const shares = isOwner ? await listEffectiveDocShares(row) : [];
  // Un invitado no tiene el árbol del workspace: navega el subárbol compartido desde acá.
  const subpages = isOwner ? [] : await listAccessibleSubpages(user, id);
  const backlinks = isOwner ? await listDocBacklinks(user.id, id) : [];
  const feedback = isOwner && page.published ? await getHelpFeedbackStats(user.id, id) : null;
  const helpBase = isOwner && user.handle ? `/${locale}/h/${user.handle}` : null;
  const t = await getTranslations({ locale, namespace: 'docs' });

  // Links `[[` con el título actual de la página linkeada (si es del
  // workspace de quien mira; si no, queda el título con que se insertó).
  const titles = new Map(allPages.map((p) => [p.id, p.title || t('untitled')]));
  // El editor recibe el content tal cual (ya se sanitizó al guardar); la lectura se re-sanitiza.
  // Solo lectura: tampoco viaja la URL del storage de imágenes/archivos (se
  // sirven por /api/docs/files, que chequea el acceso).
  const base = access === 'view' ? stripFileUrls(sanitizeBlocks(page.content)) : page.content;
  const content = resolveBlocksPageLinks(base, (pageId) => ({
    href: access === 'view' ? `/${locale}${pageLinkHref(pageId)}` : pageLinkHref(pageId),
    title: titles.get(pageId) ?? null,
  }));

  const owner = isOwner ? null : await getUserById(row.user_id);
  // Lectura: nombres de las personas de las bases (solo si la página tiene una).
  const people =
    access === 'view' && page.content.some((b) => b.type === 'database')
      ? Object.fromEntries((await listPageMentionables(row)).map((m) => [m.id, m.name?.trim() || m.email]))
      : undefined;
  const sharedBy = owner ? owner.name || owner.email : null;

  return (
    <div className="docs-layout">
      <DocsSidebar
        pages={allPages}
        currentId={id}
        shared={shared}
        favorites={favorites}
        createAction={createDocPageAction.bind(null, locale)}
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
            people={people}
          />
        ) : (
          <>
            {!isOwner && sharedBy && (
              <p className="docs-shared-banner" role="status">
                {t('share.sharedEditBanner', { name: sharedBy })}
              </p>
            )}
            <DocsEditorClient
              page={{ ...page, content }}
              ancestors={ancestors}
              shares={shares}
              comments={comments}
              access={isOwner ? 'owner' : 'edit'}
              helpBase={helpBase}
              feedback={feedback}
              backlinks={backlinks}
              currentUserId={user.actingUser?.id ?? user.id}
              favorite={isOwner ? favorites.some((f) => f.id === id) : null}
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
