import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { realUserId, requireUser } from '@/lib/session';
import { getUserById } from '@/lib/db';
import {
  getDocPageAncestors,
  listDocComments,
  listDocPages,
  listDocShares,
  listSharedWithMe,
  resolveDocAccess,
  toDocPage,
} from '@/lib/docs';
import { getHelpFeedbackStats } from '@/lib/docs-help';
import { sanitizeBlocks } from '@/lib/docs-sanitize';
import {
  createDocPageAction,
  moveDocPageAction,
  moveDocPageStepAction,
  reorderDocPageAction,
} from '@/lib/docs-actions';
import DocsSidebar from '@/components/docs/DocsSidebar';
import DocsEditorClient from '@/components/docs/DocsEditorClient';
import DocsReadOnlyView from '@/components/docs/DocsReadOnlyView';
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
  const isOwner = access === 'owner';

  const [allPages, trashed, shared, comments] = await Promise.all([
    listDocPages(user.id, { archived: false }),
    listDocPages(user.id, { archived: true }),
    listSharedWithMe(realUserId(user), user.id),
    listDocComments(id),
  ]);
  // A un invitado no se le muestran los ancestros (títulos de otro workspace).
  const ancestors = isOwner ? await getDocPageAncestors(user.id, id) : [];
  const shares = isOwner ? await listDocShares(id) : [];
  const feedback = isOwner && page.published ? await getHelpFeedbackStats(user.id, id) : null;
  const helpBase = isOwner && user.handle ? `/${locale}/h/${user.handle}` : null;
  const t = await getTranslations({ locale, namespace: 'docs' });

  const owner = isOwner ? null : await getUserById(row.user_id);
  const sharedBy = owner ? owner.name || owner.email : null;

  return (
    <div className="docs-layout">
      <DocsSidebar
        pages={allPages}
        currentId={id}
        trashCount={trashed.length}
        shared={shared}
        createAction={createDocPageAction.bind(null, user.id, locale)}
        moveAction={moveDocPageAction.bind(null, user.id)}
        reorderAction={reorderDocPageAction.bind(null, user.id)}
        stepAction={moveDocPageStepAction.bind(null, user.id)}
        labels={{
          newPage: t('sidebar.newPage'),
          newSubpage: t('sidebar.newSubpage'),
          empty: t('sidebar.empty'),
        }}
      />
      <div className="docs-main">
        {access === 'view' ? (
          <DocsReadOnlyView
            page={{ ...page, content: sanitizeBlocks(page.content) }}
            sharedBy={sharedBy}
          />
        ) : (
          <>
            {!isOwner && sharedBy && (
              <p className="docs-shared-banner" role="status">
                {t('share.sharedEditBanner', { name: sharedBy })}
              </p>
            )}
            <DocsEditorClient
              page={page}
              ancestors={ancestors}
              shares={shares}
              comments={comments}
              access={isOwner ? 'owner' : 'edit'}
              helpBase={helpBase}
              feedback={feedback}
              currentUserId={user.actingUser?.id ?? user.id}
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
      </div>
    </div>
  );
}
