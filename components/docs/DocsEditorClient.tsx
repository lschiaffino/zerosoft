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
import Icon from '@/components/app/icons';

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
      // Todo PATCH (contenido, publicar, ancho, tamaño del texto, restaurar)
      // va con la base: si no, uno que no toca el contenido adelantaba la base
      // a la versión ajena y el próximo guardado la pisaba sin 409.
      const guarded = !force;
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
          // Un interruptor optimista que no se guardó vuelve al valor del server.
          if ('published' in patch || 'is_public' in patch) router.refresh();
          return;
        }
        conflictPatch.current = null;
        setSaveError(null);
        const updated = (await res.json().catch(() => null)) as DocsPage | null;
        // Un "Sobrescribir" sin contenido no trae la versión ajena al editor:
        // la base queda vieja y el próximo guardado de contenido vuelve a avisar.
        if (updated?.updated_at && (guarded || 'content' in patch)) baseUpdatedAt.current = updated.updated_at;
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

  // Interruptores de Compartir (publicar, IA): responden al toque; el slug y
  // el estado definitivo llegan con la respuesta del PATCH.
  const updateSharing = useCallback(
    (patch: Partial<DocsPage>) => {
      setCurrent((prev) => ({ ...prev, ...patch }));
      return savePage(patch);
    },
    [savePage],
  );

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
    await savePage({ archived: false });
  }, [savePage]);

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
      {current.published && (
        <span className="badge badge-ok docs-published">{t('editor.published')}</span>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-sm docs-top-btn"
        onClick={() => toggle('comments')}
        aria-pressed={side === 'comments'}
      >
        {t('comments.title')}
        {openComments > 0 && <span className="docs-top-count">{openComments}</span>}
      </button>
      {isOwner && (
        <button
          type="button"
          className="btn btn-secondary btn-sm docs-top-btn"
          onClick={() => setShareOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={shareOpen}
        >
          {t('share.title')}
        </button>
      )}
    </>
  );

  const menuExtra = (close: () => void) => (
    <>
      <button
        type="button"
        role="menuitem"
        className="docs-menu-item"
        onClick={() => {
          close();
          setSide('versions');
        }}
      >
        {t('versions.title')}
      </button>
      <a
        role="menuitem"
        className="docs-menu-item"
        href={`/api/docs/pages/${page.id}/export?format=md`}
        download
        onClick={close}
      >
        {t('export.markdown')}
      </a>
      <button
        type="button"
        role="menuitem"
        className="docs-menu-item"
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
        <div className="docs-banner" role="status">
          <span>{t('editor.inTrash')}</span>
          {isOwner && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={restorePage}>
              {t('trash.restore')}
            </button>
          )}
        </div>
      )}
      {saveError === 'conflict' && (
        <div className="docs-banner docs-banner-bad" role="alert">
          <span>{t('editor.conflict')}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={reloadAfterConflict}>
            {t('editor.conflictReload')}
          </button>
          <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={overwriteAfterConflict}>
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
      <aside
        className="docs-side"
        hidden={!side}
        aria-label={side === 'versions' ? t('versions.title') : t('comments.title')}
      >
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon docs-side-close"
          onClick={() => setSide(null)}
          aria-label={t('editor.closePanel')}
          title={t('editor.closePanel')}
        >
          <Icon name="close" size={16} />
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
      </aside>
      {shareOpen && isOwner && (
        <ShareDialog
          page={current}
          shares={localShares}
          helpBase={helpBase}
          feedback={feedback}
          onUpdate={updateSharing}
          onShare={handleShare}
          onRoleChange={handleRoleChange}
          onUnshare={handleUnshare}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
