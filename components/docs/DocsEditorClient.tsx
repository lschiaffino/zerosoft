'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import {
  type DocsAccess,
  type DocsComment,
  type DocsPage,
  type DocsPageShare,
  type DocsShareRole,
} from '@/lib/docs-types';
import { docsPatchTooLong } from '@/lib/docs-schema';
import DocsEditor from './DocsEditor';
import ShareDialog, { type ShareRequest } from './ShareDialog';
import CommentsPanel from './CommentsPanel';
import VersionsPanel from './VersionsPanel';

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
  access = 'owner',
  helpBase = null,
  feedback = null,
}: {
  page: DocsPage;
  ancestors: DocsPage[];
  shares: DocsPageShare[];
  comments: DocsComment[];
  currentUserId: string;
  commentsLabels: CommentsLabels;
  /** 'owner' = workspace dueño; 'edit' = invitado con edición (sin compartir/publicar/papelera). */
  access?: Exclude<DocsAccess, 'view'>;
  helpBase?: string | null;
  feedback?: { yes: number; no: number } | null;
}) {
  const router = useRouter();
  const t = useTranslations('docs');
  const isOwner = access === 'owner';
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<'tooLong' | 'failed' | 'conflict' | null>(null);
  // Concurrencia optimista: updated_at de la última versión que este editor
  // vio del server (la carga inicial o su propio último guardado). Si otra
  // persona guarda en el medio, el PATCH vuelve 409 en vez de pisarla.
  const baseUpdatedAt = useRef(page.updated_at);
  /** Guardados en serie: uno en vuelo con la base vieja daría un falso 409. */
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  /** Último cambio de contenido rechazado por conflicto (para "Sobrescribir"). */
  const conflictPatch = useRef<Partial<DocsPage> | null>(null);
  const [current, setCurrent] = useState<DocsPage>(page);
  const [editorKey, setEditorKey] = useState(0);
  const [localShares, setLocalShares] = useState(shares);
  const [shareOpen, setShareOpen] = useState(false);
  const [commentFocus, setCommentFocus] = useState(0);
  // Espejo local de los comentarios (el panel notifica cambios) para los
  // badges por bloque; blockFilter ancla el panel al hilo de un bloque.
  const [allComments, setAllComments] = useState<DocsComment[]>(comments);
  const [blockFilter, setBlockFilter] = useState<string | null>(null);
  // Comments y Versiones viven en un panel lateral que se abre a demanda
  // (como Notion); Compartir es un diálogo.
  const [side, setSide] = useState<'comments' | 'versions' | null>(null);
  const openComments = allComments.filter((c) => !c.resolved).length;

  useEffect(() => {
    setAllComments(comments);
  }, [comments]);

  useEffect(() => {
    setCurrent((prev) => ({ ...prev, ...page, content: prev.content }));
  }, [page]);

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

  const runSave = useCallback(
    async (patch: Partial<DocsPage>, force: boolean) => {
      setSaving(true);
      const guarded = 'content' in patch && !force;
      const body = JSON.stringify(guarded ? { ...patch, base_updated_at: baseUpdatedAt.current } : patch);
      try {
        const res = await fetch(`/api/docs/pages/${page.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body,
          // El guardado pendiente también se manda al cerrar/navegar
          // (keepalive tiene tope de 64KB por request).
          keepalive: body.length < 60_000,
        });
        if (res.status === 409) {
          conflictPatch.current = patch;
          setSaveError('conflict');
          return;
        }
        if (!res.ok) {
          setSaveError('failed');
          return;
        }
        conflictPatch.current = null;
        setSaveError(null);
        const updated = (await res.json().catch(() => null)) as DocsPage | null;
        if (updated?.updated_at) baseUpdatedAt.current = updated.updated_at;
        if (updated && ('published' in patch || 'is_public' in patch)) {
          setCurrent((prev) => ({ ...prev, published: updated.published, slug: updated.slug, is_public: updated.is_public }));
        }
        router.refresh();
      } catch {
        setSaveError('failed');
      } finally {
        setSaving(false);
      }
    },
    [page.id, router],
  );

  const savePage = useCallback(
    async (patch: Partial<DocsPage>) => {
      // El servidor rechaza el PATCH entero si un bloque pasa el tope: avisar en
      // vez de mostrar "Guardado" y perder lo escrito.
      if (docsPatchTooLong(patch)) {
        setSaveError('tooLong');
        return;
      }
      const next = saveChain.current.then(() => runSave(patch, false));
      saveChain.current = next;
      await next;
    },
    [runSave],
  );

  // Conflicto: o se trae la versión del server (descartando lo propio sin
  // guardar) o se sobrescribe a sabiendas con lo que hay en este editor.
  const reloadAfterConflict = useCallback(async () => {
    const res = await fetch(`/api/docs/pages/${page.id}`);
    if (!res.ok) return;
    const fresh = (await res.json()) as DocsPage;
    baseUpdatedAt.current = fresh.updated_at;
    conflictPatch.current = null;
    setSaveError(null);
    setCurrent(fresh);
    setEditorKey((k) => k + 1);
    router.refresh();
  }, [page.id, router]);

  const overwriteAfterConflict = useCallback(async () => {
    const patch = conflictPatch.current;
    if (!patch) return;
    const next = saveChain.current.then(() => runSave(patch, true));
    saveChain.current = next;
    await next;
  }, [runSave]);

  const handleShare = useCallback(
    async (req: ShareRequest): Promise<string | null> => {
      const res = await fetch(`/api/docs/pages/${page.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: req.kind, target_id: req.targetId ?? null, email: req.email, role: req.role }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return data.error ?? 'error';
      }
      const share = (await res.json()) as DocsPageShare;
      setLocalShares((prev) => [share, ...prev.filter((s) => s.id !== share.id)]);
      router.refresh();
      return null;
    },
    [page.id, router],
  );

  const handleRoleChange = useCallback(
    async (shareId: string, role: DocsShareRole) => {
      setLocalShares((prev) => prev.map((s) => (s.id === shareId ? { ...s, role } : s)));
      await fetch(`/api/docs/pages/${page.id}/share/${shareId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      }).catch(() => {});
    },
    [page.id],
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
    if (!res.ok) return;
    const updated = (await res.json().catch(() => null)) as DocsPage | null;
    if (updated?.updated_at) baseUpdatedAt.current = updated.updated_at;
    router.refresh();
  }, [page.id, router]);

  // Tras restaurar una versión el editor se vuelve a montar con el contenido nuevo.
  const onVersionRestored = useCallback(async () => {
    const res = await fetch(`/api/docs/pages/${page.id}`);
    if (res.ok) {
      const fresh = (await res.json()) as DocsPage;
      baseUpdatedAt.current = fresh.updated_at;
      setCurrent(fresh);
      setEditorKey((k) => k + 1);
    }
    router.refresh();
  }, [page.id, router]);

  const toggle = (panel: 'comments' | 'versions') => setSide((cur) => (cur === panel ? null : panel));

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
      {isOwner && (
        <button
          type="button"
          className={`docs-top-btn${shareOpen ? ' on' : ''}`}
          onClick={() => setShareOpen(true)}
          aria-haspopup="dialog"
        >
          {t('share.title')}
          {(current.published || localShares.length > 0) && <span className="docs-top-dot" aria-hidden />}
        </button>
      )}
    </>
  );

  const menuExtra = (close: () => void) => (
    <>
      <button
        type="button"
        className="docs-page-menu-item"
        onClick={() => {
          close();
          setSide('versions');
        }}
      >
        {t('versions.title')}
      </button>
      <a
        className="docs-page-menu-item"
        href={`/api/docs/pages/${page.id}/export?format=md`}
        download
        onClick={close}
      >
        {t('export.markdown')}
      </a>
      <button
        type="button"
        className="docs-page-menu-item"
        onClick={() => {
          close();
          setSide(null);
          // El PDF sale del diálogo de impresión (styles/docs.css → @media print).
          setTimeout(() => window.print(), 50);
        }}
      >
        {t('export.pdf')}
      </button>
    </>
  );

  return (
    <div className={`docs-editor-wrap${side ? ' has-side' : ''}`}>
      {current.archived && (
        <div className="docs-archived-banner" role="status">
          <span>{t('editor.inTrash')}</span>
          {isOwner && (
            <button type="button" className="btn btn-small" onClick={restorePage}>
              {t('trash.restore')}
            </button>
          )}
        </div>
      )}
      {saveError === 'conflict' && (
        <div className="docs-archived-banner" role="alert">
          <span>{t('editor.conflict')}</span>
          <button type="button" className="btn btn-small" onClick={reloadAfterConflict}>
            {t('editor.conflictReload')}
          </button>
          <button type="button" className="btn btn-small" onClick={overwriteAfterConflict}>
            {t('editor.conflictOverwrite')}
          </button>
        </div>
      )}
      <DocsEditor
        key={editorKey}
        page={current}
        ancestors={ancestors}
        onSave={savePage}
        saving={saving}
        saveError={saveError}
        onDuplicate={isOwner ? duplicatePage : undefined}
        onDelete={isOwner ? trashPage : undefined}
        topActions={topActions}
        menuExtra={menuExtra}
        layoutToggles={isOwner}
        onAddComment={handlePageComment}
        commentCounts={commentCounts}
        onBlockComment={handleBlockComment}
      />
      <div className="docs-side" hidden={!side}>
        <button type="button" className="docs-side-close" onClick={() => setSide(null)} aria-label={t('editor.closePanel')}>
          ×
        </button>
        {side === 'versions' && <VersionsPanel pageId={page.id} canEdit onRestored={onVersionRestored} />}
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
      {shareOpen && isOwner && (
        <ShareDialog
          page={current}
          shares={localShares}
          helpBase={helpBase}
          feedback={feedback}
          onUpdate={savePage}
          onShare={handleShare}
          onRoleChange={handleRoleChange}
          onUnshare={handleUnshare}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
