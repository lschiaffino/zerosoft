'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
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

  const savePage = useCallback(
    async (patch: Partial<DocsPage>) => {
      setSaving(true);
      try {
        await fetch(`/api/docs/pages/${page.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
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

  const deletePage = useCallback(async () => {
    const ok = confirm(t('editor.confirmTrash'));
    if (!ok) return;
    const res = await fetch(`/api/docs/pages/${page.id}`, { method: 'DELETE' });
    if (!res.ok) return;
    router.push('/app/docs');
  }, [page.id, router, t]);

  return (
    <div className="docs-editor-wrap">
      <DocsEditor
        page={page}
        ancestors={ancestors}
        onSave={savePage}
        saving={saving}
        onDuplicate={duplicatePage}
        onDelete={deletePage}
        onAddComment={() => setCommentFocus((n) => n + 1)}
      />
      <div className="docs-side">
        <SharePanel
          page={page}
          shares={localShares}
          onUpdate={savePage}
          onShare={handleShare}
          onUnshare={handleUnshare}
        />
        <CommentsPanel
          pageId={page.id}
          pageOwnerId={page.user_id}
          currentUserId={currentUserId}
          initialComments={comments}
          focusSignal={commentFocus}
          labels={commentsLabels}
        />
      </div>
    </div>
  );
}
