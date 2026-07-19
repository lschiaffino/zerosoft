'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { type DocsPage, type DocsPageShare } from '@/lib/docs-types';
import DocsEditor from './DocsEditor';
import SharePanel from './SharePanel';

export default function DocsEditorClient({
  page,
  shares,
}: {
  page: DocsPage;
  shares: DocsPageShare[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [localShares, setLocalShares] = useState(shares);

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

  return (
    <div className="docs-editor-wrap">
      <DocsEditor page={page} onSave={savePage} saving={saving} />
      <SharePanel
        page={page}
        shares={localShares}
        onUpdate={savePage}
        onShare={handleShare}
        onUnshare={handleUnshare}
      />
    </div>
  );
}
