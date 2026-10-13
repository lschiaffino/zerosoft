'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { type DocsComment, type DocsPage, type DocsPageShare } from '@/lib/docs-types';
import DocsEditor from './DocsEditor';
import SharePanel from './SharePanel';
import CommentsPanel from './CommentsPanel';

interface CommentsLabels {
  title: string;
  empty: string;
  placeholder: string;
  add: string;
  resolve: string;
  unresolve: string;
  delete: string;
  resolved: string;
  blockThread: string;
  showAll: string;
  blockTag: string;
}

export default function DocsEditorClient({
  page,
  ancestors,
  shares,
  comments,
  currentUserId,
  commentsLabels,
}: {
  page: DocsPage;
  ancestors: DocsPage[];
  shares: DocsPageShare[];
  comments: DocsComment[];
  currentUserId: string;
  commentsLabels: CommentsLabels;
}) {
  const router = useRouter();
  const t = useTranslations('docs');
  const [saving, setSaving] = useState(false);
  const [localShares, setLocalShares] = useState(shares);
  const [commentFocus, setCommentFocus] = useState(0);
  // Espejo local de los comentarios (el panel notifica cambios) para los
  // badges por bloque; blockFilter ancla el panel al hilo de un bloque.
  const [allComments, setAllComments] = useState<DocsComment[]>(comments);
  const [blockFilter, setBlockFilter] = useState<string | null>(null);
  // Share y Comments viven en un panel lateral que se abre a demanda (como
  // Notion): el editor usa todo el ancho por defecto.
  const [side, setSide] = useState<'share' | 'comments' | null>(null);
  const openComments = allComments.filter((c) => !c.resolved).length;

  useEffect(() => {
    setAllComments(comments);
  }, [comments]);

  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of allComments) {
      if (c.block_id) counts[c.block_id] = (counts[c.block_id] ?? 0) + 1;
    }
    return counts;
  }, [allComments]);

  const handleBlockComment = useCallback((blockId: string) => {
    setBlockFilter(blockId);
    setSide('comments');
    setCommentFocus((n) => n + 1);
  }, []);

  const handlePageComment = useCallback(() => {
    setBlockFilter(null);
    setSide('comments');
    setCommentFocus((n) => n + 1);
  }, []);

  const savePage = useCallback(
    async (patch: Partial<DocsPage>) => {
      setSaving(true);
      const body = JSON.stringify(patch);
      try {
        await fetch(`/api/docs/pages/${page.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body,
          // El guardado pendiente también se manda al cerrar/navegar
          // (keepalive tiene tope de 64KB por request).
          keepalive: body.length < 60_000,
        });
        router.refresh();
      } finally {
        setSaving(false);
      }
    },
    [page.id, router],
  );

  const handleShare = useCallback(
    async (kind: 'public' | 'team' | 'user', targetId?: string | null) => {
      const res = await fetch(`/api/docs/pages/${page.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, target_id: targetId }),
      });
      if (!res.ok) return;
      const share = (await res.json()) as DocsPageShare;
      setLocalShares((prev) => [share, ...prev]);
      router.refresh();
    },
    [page.id, router],
  );

  const handleUnshare = useCallback(
    async (shareId: string) => {
      const res = await fetch(`/api/docs/pages/${page.id}/share/${shareId}`, { method: 'DELETE' });
      if (!res.ok) return;
      setLocalShares((prev) => prev.filter((s) => s.id !== shareId));
      router.refresh();
    },
    [page.id, router],
  );

  const duplicatePage = useCallback(async () => {
    const res = await fetch(`/api/docs/pages/${page.id}/duplicate`, { method: 'POST' });
    if (!res.ok) return;
    const duplicated = (await res.json()) as DocsPage;
    router.push(`/app/docs/${duplicated.id}`);
  }, [page.id, router]);

  // "Mover a la papelera" archiva (recuperable desde la papelera); el borrado
  // definitivo vive en la papelera. Antes borraba para siempre sin pasar por ahí.
  const trashPage = useCallback(async () => {
    const res = await fetch(`/api/docs/pages/${page.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    if (!res.ok) return;
    router.push('/app/docs');
    router.refresh();
  }, [page.id, router]);

  const restorePage = useCallback(async () => {
    const res = await fetch(`/api/docs/pages/${page.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: false }),
    });
    if (res.ok) router.refresh();
  }, [page.id, router]);

  const toggle = (panel: 'share' | 'comments') => setSide((cur) => (cur === panel ? null : panel));

  const topActions = (
    <>
      <button
        type="button"
        className={`docs-top-btn${side === 'comments' ? ' on' : ''}`}
        onClick={() => toggle('comments')}
        aria-pressed={side === 'comments'}
      >
        {t('comments.title')}
        {openComments > 0 && <span className="docs-top-count mono">{openComments}</span>}
      </button>
      <button
        type="button"
        className={`docs-top-btn${side === 'share' ? ' on' : ''}`}
        onClick={() => toggle('share')}
        aria-pressed={side === 'share'}
      >
        {t('share.title')}
        {(page.is_public || localShares.length > 0) && <span className="docs-top-dot" aria-hidden />}
      </button>
    </>
  );

  return (
    <div className={`docs-editor-wrap${side ? ' has-side' : ''}`}>
      {page.archived && (
        <div className="docs-archived-banner" role="status">
          <span>{t('editor.inTrash')}</span>
          <button type="button" className="btn btn-small" onClick={restorePage}>
            {t('trash.restore')}
          </button>
        </div>
      )}
      <DocsEditor
        page={page}
        ancestors={ancestors}
        onSave={savePage}
        saving={saving}
        onDuplicate={duplicatePage}
        onDelete={trashPage}
        topActions={topActions}
        onAddComment={handlePageComment}
        commentCounts={commentCounts}
        onBlockComment={handleBlockComment}
      />
      <div className="docs-side" hidden={!side}>
        <button type="button" className="docs-side-close" onClick={() => setSide(null)} aria-label={t('editor.closePanel')}>
          ×
        </button>
        {side === 'share' && (
        <SharePanel
          page={page}
          shares={localShares}
          onUpdate={savePage}
          onShare={handleShare}
          onUnshare={handleUnshare}
        />
        )}
        <div hidden={side !== 'comments'}>
        <CommentsPanel
          pageId={page.id}
          pageOwnerId={page.user_id}
          currentUserId={currentUserId}
          initialComments={comments}
          focusSignal={commentFocus}
          blockFilter={blockFilter}
          onClearBlockFilter={() => setBlockFilter(null)}
          onCommentsChange={setAllComments}
          labels={commentsLabels}
        />
        </div>
      </div>
    </div>
  );
}
