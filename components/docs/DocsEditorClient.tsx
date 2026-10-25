'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import {
  type DocsBlock,
  type DocsComment,
  type DocsPage,
  type DocsPageShare,
  type DocsShareRole,
} from '@/lib/docs-types';
import { docsPatchTooLong, reminderContext } from '@/lib/docs-schema';
import { listSuggestions, MARK_ID_RE, type DocsSuggestion } from '@/lib/docs-marks';
import type { DocsSnapshot } from '@/lib/docs-history';
import type { DocsGuestInvite } from '@/lib/docs-guests';
import DocsEditor from './DocsEditor';
import ShareDialog, { type ShareRequest } from './ShareDialog';
import CommentsPanel from './CommentsPanel';
import VersionsPanel from './VersionsPanel';
import SaveTemplateDialog from './SaveTemplateDialog';
import VerifyDialog from './VerifyDialog';
import Icon from '@/components/app/icons';
import DocsGlyph from './DocsGlyphs';
import DocsPageIcon from './DocsPageIcon';
import DocsFavoriteButton from './DocsFavoriteButton';
import { DocsPeerCursors, DocsPresenceAvatars } from './DocsPresence';
import { useDocsLive, type LivePulse } from './useDocsLive';
import type { DocsEditorApi, DocsEditorMode } from './useDocsCollab';

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

/** Acceso de quien edita: miembro con acceso total, invitado con total o edición, o "puede comentar". */
export type DocsEditorAccess = 'owner' | 'full' | 'edit' | 'comment';

const snap = (p: { title: string; content: DocsBlock[] }): DocsSnapshot => ({ title: p.title, blocks: p.content });
const sameSnap = (a: DocsSnapshot, b: DocsSnapshot) => a.title === b.title && JSON.stringify(a.blocks) === JSON.stringify(b.blocks);

export default function DocsEditorClient({
  page,
  ancestors,
  shares,
  invites = [],
  comments,
  currentUserId,
  commentsLabels,
  access = 'owner',
  helpBase = null,
  feedback = null,
  backlinks = [],
  favorite = null,
  people = {},
  canVerify = false,
  allowExport = true,
  memberRoleDefault = 'full',
}: {
  page: DocsPage;
  ancestors: DocsPage[];
  shares: DocsPageShare[];
  /** Invitaciones pendientes a personas sin cuenta (quien puede compartir). */
  invites?: DocsGuestInvite[];
  comments: DocsComment[];
  currentUserId: string;
  commentsLabels: CommentsLabels;
  access?: DocsEditorAccess;
  helpBase?: string | null;
  feedback?: { yes: number; no: number } | null;
  /** Páginas con un link `[[` a esta (solo el dueño). */
  backlinks?: Array<{ id: string; title: string; icon: string | null }>;
  /** Está en los favoritos de la persona (null = no se puede marcar: página de otro workspace). */
  favorite?: boolean | null;
  /** Personas del workspace (id → nombre): autores de sugerencias y dueño de la wiki. */
  people?: Record<string, string>;
  /** Puede verificar la página (acceso total o dueño de la página). */
  canVerify?: boolean;
  /** Exportar habilitado (Ajustes › Seguridad) para esta persona. */
  allowExport?: boolean;
  /** Rol que heredan los miembros si la página no fija uno (para el selector de Compartir). */
  memberRoleDefault?: DocsShareRole;
}) {
  const router = useRouter();
  const t = useTranslations('docs');
  const locale = useLocale();
  const isOwner = access === 'owner';
  const canShare = access === 'owner' || access === 'full';
  const canWrite = access !== 'comment';
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<'tooLong' | 'failed' | 'conflict' | null>(null);
  /**
   * Base de la fusión en vivo: la última versión del servidor que este editor
   * incorporó (la carga, su propio guardado o una fusión sin cambios propios).
   * Un guardado viaja con su updated_at; si otra persona guardó en el medio,
   * el servidor devuelve 409 con la versión actual, se fusiona acá
   * (lib/docs-merge.ts) y se reintenta. Ya no hay "cargar o sobrescribir".
   */
  const base = useRef<{ updated_at: string; snap: DocsSnapshot }>({ updated_at: page.updated_at, snap: snap(page) });
  /** Guardados en serie: uno en vuelo con la base vieja daría un 409 de más. */
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);
  /** Último cambio rechazado tras varios reintentos (para "Sobrescribir"). */
  const conflictPatch = useRef<Partial<DocsPage> | null>(null);
  const editorApi = useRef<DocsEditorApi | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [current, setCurrent] = useState<DocsPage>(page);
  const [editorKey, setEditorKey] = useState(0);
  const [localShares, setLocalShares] = useState(shares);
  const [localInvites, setLocalInvites] = useState(invites);
  const [shareOpen, setShareOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [commentFocus, setCommentFocus] = useState(0);
  const [allComments, setAllComments] = useState<DocsComment[]>(comments);
  const [blockFilter, setBlockFilter] = useState<string | null>(null);
  const [side, setSide] = useState<'comments' | 'versions' | null>(null);
  const openComments = allComments.filter((c) => !c.resolved && !c.parent_id).length;
  const [templateOpen, setTemplateOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<DocsSuggestion[]>(() => listSuggestions(page.content));
  const [pendingAnchor, setPendingAnchor] = useState<{ id: string; quote: string; blockId: string } | null>(null);
  const [focusAnchor, setFocusAnchor] = useState<string | null>(null);
  const [commentsSig, setCommentsSig] = useState<string | undefined>(undefined);
  const [lockNote, setLockNote] = useState<string | null>(null);

  const locked = !!current.locked;
  // Bloqueada: solo leer y comentar. "Puede comentar": leer y, si lo elige, sugerir.
  const mode: DocsEditorMode = locked ? 'readonly' : suggesting ? 'suggest' : canWrite ? 'edit' : 'readonly';

  useEffect(() => {
    setAllComments(comments);
  }, [comments]);

  useEffect(() => {
    setCurrent((prev) => ({ ...prev, ...page, content: prev.content }));
  }, [page]);

  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of allComments) {
      // Los comentarios sobre texto se ven en el resaltado, no en el badge del bloque.
      if (c.block_id && !c.anchor_id) counts[c.block_id] = (counts[c.block_id] ?? 0) + 1;
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

  /** Trae la versión de otra persona al editor y, si no había nada propio sin guardar, la toma como base. */
  const absorbRemote = useCallback(async (remote: DocsPage): Promise<DocsSnapshot | null> => {
    const api = editorApi.current;
    if (!api) return null;
    const theirs = snap(remote);
    const { merged } = await api.mergeRemote(base.current.snap, theirs);
    if (sameSnap(merged, theirs)) base.current = { updated_at: remote.updated_at, snap: theirs };
    setSuggestions(listSuggestions(merged.blocks));
    setCurrent((prev) => ({ ...prev, title: merged.title, locked: remote.locked, verified_at: remote.verified_at, verified_until: remote.verified_until }));
    return merged;
  }, []);

  const runSave = useCallback(
    async (patch: Partial<DocsPage>, force: boolean, attempt = 0): Promise<void> => {
      setSaving(true);
      inFlight.current++;
      const guarded = !force;
      let tz: string | undefined;
      try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        tz = undefined;
      }
      const withCtx = { ...patch, ...reminderContext(patch, locale, tz) };
      const body = JSON.stringify(guarded ? { ...withCtx, base_updated_at: base.current.updated_at } : withCtx);
      const prevTitle = base.current.snap.title;
      let retry: Partial<DocsPage> | null = null;
      try {
        const res = await fetch(`/api/docs/pages/${page.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: body.length < 60_000,
        });
        if (res.status === 409) {
          const data = (await res.json().catch(() => null)) as { current?: DocsPage | null } | null;
          const remote = data?.current;
          // Otra persona guardó: se fusiona lo suyo con lo propio y se reintenta.
          if (remote && editorApi.current && attempt < 3) {
            const hasContent = 'content' in patch || 'title' in patch;
            if (hasContent) editorApi.current.cancelPendingSave();
            const merged = await absorbRemote(remote);
            base.current = { updated_at: remote.updated_at, snap: snap(remote) };
            retry = hasContent && merged ? { ...patch, title: merged.title, content: merged.blocks } : patch;
            return;
          }
          conflictPatch.current = patch;
          setSaveError('conflict');
          return;
        }
        if (res.status === 423) {
          // Alguien la bloqueó mientras tanto.
          setCurrent((prev) => ({ ...prev, locked: true }));
          setLockNote(t('lock.lockedMeanwhile'));
          setSaveError(null);
          return;
        }
        if (!res.ok) {
          setSaveError('failed');
          if ('published' in patch || 'is_public' in patch || 'locked' in patch) router.refresh();
          return;
        }
        conflictPatch.current = null;
        setSaveError(null);
        const updated = (await res.json().catch(() => null)) as DocsPage | null;
        if (updated?.updated_at) {
          // Lo guardado es la nueva base (el contenido como lo devuelve el servidor).
          base.current = { updated_at: updated.updated_at, snap: updated.content ? snap(updated) : base.current.snap };
        }
        if (updated && ('published' in patch || 'is_public' in patch || 'locked' in patch || 'member_role' in patch)) {
          setCurrent((prev) => ({
            ...prev,
            published: updated.published,
            slug: updated.slug,
            is_public: updated.is_public,
            locked: updated.locked,
            member_role: updated.member_role,
          }));
        }
        // Renombrar (o cualquier cambio que no es solo contenido): el sidebar y las listas se refrescan.
        if (!('content' in patch) || ('title' in patch && patch.title !== prevTitle)) router.refresh();
      } catch {
        setSaveError('failed');
      } finally {
        inFlight.current--;
        setSaving(false);
        if (retry) await runSave(retry, false, attempt + 1);
      }
    },
    [page.id, router, locale, absorbRemote, t],
  );

  const savePage = useCallback(
    async (patch: Partial<DocsPage>) => {
      if (docsPatchTooLong(patch)) {
        setSaveError('tooLong');
        return;
      }
      if (patch.content) setSuggestions(listSuggestions(patch.content));
      const next = saveChain.current.then(() => runSave(patch, false));
      saveChain.current = next;
      await next;
    },
    [runSave],
  );

  // Último recurso (3 fusiones seguidas fallaron): traer lo del server o pisar a sabiendas.
  const reloadAfterConflict = useCallback(async () => {
    const res = await fetch(`/api/docs/pages/${page.id}`);
    if (!res.ok) return;
    const fresh = (await res.json()) as DocsPage;
    base.current = { updated_at: fresh.updated_at, snap: snap(fresh) };
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

  // ---------- En vivo ----------
  const lastRemote = useRef<string | null>(null);
  const onPulse = useCallback(
    (pulse: LivePulse) => {
      setCommentsSig(pulse.comments);
      if (pulse.locked !== !!current.locked && inFlight.current === 0) {
        setCurrent((prev) => ({ ...prev, locked: pulse.locked }));
        if (pulse.locked) setLockNote(t('lock.lockedMeanwhile'));
      }
      const remote = pulse.page;
      if (!remote || inFlight.current > 0) return;
      if (remote.updated_at <= base.current.updated_at || remote.updated_at === lastRemote.current) return;
      lastRemote.current = remote.updated_at;
      void absorbRemote(remote);
    },
    [absorbRemote, current.locked, t],
  );
  const { peers } = useDocsLive({
    pageId: page.id,
    since: () => base.current.updated_at,
    mode: mode === 'edit' ? 'edit' : mode === 'suggest' ? 'suggest' : canWrite ? 'view' : 'comment',
    rootRef: wrapRef,
    onPulse,
  });

  const jumpToPeer = useCallback((p: { block_id: string | null }) => {
    if (!p.block_id) return;
    wrapRef.current
      ?.querySelector(`[data-block-anchor="${CSS.escape(p.block_id)}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  // ---------- Comentarios sobre texto ----------
  const onInlineComment = useCallback(
    (sel: { blockId: string; start: number; end: number; quote: string }) => {
      const api = editorApi.current;
      if (!api || !sel.quote.trim()) return;
      if (pendingAnchor) api.unwrapComment(pendingAnchor.id);
      const id = crypto.randomUUID();
      if (!api.wrapComment(sel.blockId, sel.start, sel.end, id)) return;
      setPendingAnchor({ id, quote: sel.quote.slice(0, 500), blockId: sel.blockId });
      setBlockFilter(null);
      setSide('comments');
    },
    [pendingAnchor],
  );

  // ⌘⇧M: comentar la selección (como Notion).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.key.toLowerCase() !== 'm') return;
      const sel = editorApi.current?.selection();
      if (!sel) return;
      e.preventDefault();
      onInlineComment(sel);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onInlineComment]);

  // Click en un resaltado: abre su hilo. Click en una sugerencia: el panel.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const mark = target?.closest?.('span[data-comment]');
      const id = mark?.getAttribute('data-comment');
      if (id && MARK_ID_RE.test(id) && allComments.some((c) => c.anchor_id === id)) {
        setFocusAnchor(id);
        setBlockFilter(null);
        setSide('comments');
        return;
      }
      if (target?.closest?.('span[data-sug], [data-sug-block]')) setSide('comments');
    };
    wrap.addEventListener('click', onClick);
    return () => wrap.removeEventListener('click', onClick);
  }, [allComments]);

  const focusThreadText = useCallback((anchorId: string) => {
    setFocusAnchor(anchorId);
    const el = wrapRef.current?.querySelector(`span[data-comment="${CSS.escape(anchorId)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  /** Resaltado de los hilos abiertos (los resueltos no se marcan, como en Notion). */
  const highlightCss = useMemo(() => {
    const open = new Set(allComments.filter((c) => !c.parent_id && !c.resolved && c.anchor_id).map((c) => c.anchor_id!));
    if (pendingAnchor) open.add(pendingAnchor.id);
    const ids = [...open].filter((id) => MARK_ID_RE.test(id));
    if (!ids.length) return '';
    const sel = ids.map((id) => `.docs-editor span[data-comment="${id}"]`).join(',');
    const focus = focusAnchor && MARK_ID_RE.test(focusAnchor) ? `.docs-editor span[data-comment="${focusAnchor}"]{background:var(--docs-comment-hl-strong)}` : '';
    return `${sel}{background:var(--docs-comment-hl);border-bottom:2px solid var(--docs-comment-line);cursor:pointer}${focus}`;
  }, [allComments, pendingAnchor, focusAnchor]);

  const focusSuggestion = useCallback((s: DocsSuggestion) => {
    const el = wrapRef.current?.querySelector(`[data-sug="${CSS.escape(s.id)}"], [data-sug-block="${CSS.escape(s.id)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  // ---------- Compartir ----------
  const refreshShares = useCallback(async () => {
    const res = await fetch(`/api/docs/pages/${page.id}`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { shares?: DocsPageShare[]; invites?: DocsGuestInvite[] };
    if (data.shares) setLocalShares(data.shares);
    if (data.invites) setLocalInvites(data.invites);
  }, [page.id]);

  const updateSharing = useCallback(
    async (patch: Partial<DocsPage>) => {
      setCurrent((prev) => ({ ...prev, ...patch }));
      await savePage(patch);
      if (patch.inherit_shares !== undefined) await refreshShares();
    },
    [savePage, refreshShares],
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
      const data = (await res.json()) as DocsPageShare | { invite: DocsGuestInvite };
      if ('invite' in data) {
        setLocalInvites((prev) => [data.invite, ...prev.filter((i) => i.id !== data.invite.id && i.email !== data.invite.email)]);
        return null;
      }
      setLocalShares((prev) => [data, ...prev.filter((s) => s.id !== data.id && !(s.kind === data.kind && s.target_id === data.target_id))]);
      await refreshShares();
      router.refresh();
      return null;
    },
    [page.id, router, refreshShares],
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
      await refreshShares();
      router.refresh();
    },
    [page.id, router, refreshShares],
  );

  const handleRevokeInvite = useCallback(
    async (inviteId: string) => {
      const res = await fetch(`/api/docs/pages/${page.id}/share/${inviteId}?invite=1`, { method: 'DELETE' });
      if (res.ok) setLocalInvites((prev) => prev.filter((i) => i.id !== inviteId));
    },
    [page.id],
  );

  const duplicatePage = useCallback(async () => {
    const res = await fetch(`/api/docs/pages/${page.id}/duplicate`, { method: 'POST' });
    if (!res.ok) return;
    const duplicated = (await res.json()) as DocsPage;
    router.push(`/app/docs/${duplicated.id}`);
  }, [page.id, router]);

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

  const toggleLock = useCallback(async () => {
    const next = !locked;
    setCurrent((prev) => ({ ...prev, locked: next }));
    setLockNote(null);
    if (next) setSuggesting(false);
    await savePage({ locked: next });
  }, [locked, savePage]);

  const onVersionRestored = useCallback(async () => {
    const res = await fetch(`/api/docs/pages/${page.id}`);
    if (res.ok) {
      const fresh = (await res.json()) as DocsPage;
      base.current = { updated_at: fresh.updated_at, snap: snap(fresh) };
      setCurrent(fresh);
      setSuggestions(listSuggestions(fresh.content));
      setEditorKey((k) => k + 1);
    }
    router.refresh();
  }, [page.id, router]);

  const toggle = (panel: 'comments' | 'versions') => setSide((cur) => (cur === panel ? null : panel));
  const verified = current.verified_at
    ? current.verified_until && Date.parse(current.verified_until) <= Date.now()
      ? 'expired'
      : 'verified'
    : null;
  const peopleList = useMemo(() => Object.entries(people).map(([id, name]) => ({ id, name })), [people]);

  const topActions = (
    <>
      <DocsPresenceAvatars peers={peers} onJump={jumpToPeer} />
      {verified && (
        <button
          type="button"
          className={`docs-verified-badge${verified === 'expired' ? ' is-expired' : ''}`}
          onClick={() => canVerify && setVerifyOpen(true)}
          disabled={!canVerify}
          data-testid="docs-verified-badge"
        >
          <DocsGlyph name={verified === 'expired' ? 'alert' : 'check'} size={13} />
          {verified === 'expired' ? t('verify.expiredBadge') : t('verify.badge')}
        </button>
      )}
      {locked && (
        <span className="docs-locked-badge" data-testid="docs-locked-badge">
          <DocsGlyph name="lock" size={13} />
          {t('lock.badge')}
        </span>
      )}
      {current.published && (
        <span className="docs-published">
          <span className="docs-published-dot" aria-hidden="true" />
          {t('editor.published')}
        </span>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-sm docs-top-btn"
        onClick={() => toggle('comments')}
        aria-pressed={side === 'comments'}
      >
        {t('comments.title')}
        {openComments + suggestions.length > 0 && <span className="docs-top-count">{openComments + suggestions.length}</span>}
      </button>
      {favorite !== null && <DocsFavoriteButton pageId={page.id} initial={favorite} />}
      {canShare && (
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
      {!locked && (
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={suggesting}
          className="docs-menu-item"
          data-testid="docs-suggest-toggle"
          onClick={() => {
            close();
            setSuggesting((v) => !v);
          }}
        >
          {suggesting ? t('suggest.stop') : t('suggest.start')}
        </button>
      )}
      {canWrite && (
        <button type="button" role="menuitemcheckbox" aria-checked={locked} className="docs-menu-item" data-testid="docs-lock-toggle" onClick={() => {
          close();
          void toggleLock();
        }}>
          {locked ? t('lock.unlock') : t('lock.lock')}
        </button>
      )}
      {canVerify && (
        <button type="button" role="menuitem" className="docs-menu-item" data-testid="docs-verify-open" onClick={() => {
          close();
          setVerifyOpen(true);
        }}>
          {current.verified_at ? t('verify.manage') : t('verify.open')}
        </button>
      )}
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
      {allowExport && (
        <a role="menuitem" className="docs-menu-item" href={`/api/docs/pages/${page.id}/export?format=md`} download onClick={close}>
          {t('export.markdown')}
        </a>
      )}
      {isOwner && (
        <button
          type="button"
          role="menuitem"
          className="docs-menu-item"
          onClick={() => {
            close();
            setTemplateOpen(true);
          }}
        >
          {t('templates.saveAs')}
        </button>
      )}
      {allowExport && (
        <button
          type="button"
          role="menuitem"
          className="docs-menu-item"
          onClick={() => {
            close();
            setSide(null);
            setTimeout(() => window.print(), 50);
          }}
        >
          {t('export.pdf')}
        </button>
      )}
    </>
  );

  return (
    <div ref={wrapRef} className={`docs-editor-wrap${side ? ' has-side' : ''}`}>
      {highlightCss && <style>{highlightCss}</style>}
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
      {locked && (
        <div className="docs-banner docs-banner-quiet" role="status" data-testid="docs-locked-banner">
          <DocsGlyph name="lock" size={14} />
          <span>{lockNote ?? t('lock.banner')}</span>
          {canWrite && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void toggleLock()}>
              {t('lock.unlock')}
            </button>
          )}
        </div>
      )}
      {!locked && mode === 'suggest' && (
        <div className="docs-banner docs-banner-quiet docs-banner-suggest" role="status" data-testid="docs-suggest-banner">
          <span>{t('suggest.banner')}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSuggesting(false)}>
            {t('suggest.stop')}
          </button>
        </div>
      )}
      {!locked && access === 'comment' && !suggesting && (
        <div className="docs-banner docs-banner-quiet" role="status">
          <span>{t('suggest.commentOnly')}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSuggesting(true)}>
            {t('suggest.start')}
          </button>
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
        layoutToggles={isOwner && !locked}
        onAddComment={handlePageComment}
        commentCounts={commentCounts}
        onBlockComment={handleBlockComment}
        importUrl={canWrite && !locked ? `/api/docs/pages/${page.id}/import` : undefined}
        mode={mode}
        apiRef={editorApi}
        currentUserId={currentUserId}
        onInlineComment={onInlineComment}
        belowTitle={
          backlinks.length > 0 ? (
            <nav className="docs-backlinks" aria-label={t('mentions.linkedFrom')}>
              <span className="docs-backlinks-label">{t('mentions.linkedFrom')}</span>
              <ul>
                {backlinks.map((b) => (
                  <li key={b.id}>
                    <Link href={`/app/docs/${b.id}`} className="docs-backlink">
                      <DocsPageIcon icon={b.icon} pageId={b.id} size={14} fallback />
                      <span>{b.title || t('untitled')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null
        }
      />
      <DocsPeerCursors peers={peers} containerRef={wrapRef} />
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
        {side === 'versions' && (
          <VersionsPanel
            pageId={page.id}
            canEdit={canWrite && !locked}
            onRestored={onVersionRestored}
            getCurrent={() => editorApi.current?.snapshot().blocks ?? null}
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
            pendingAnchor={pendingAnchor}
            onAnchorCancel={() => {
              if (pendingAnchor) editorApi.current?.unwrapComment(pendingAnchor.id);
              setPendingAnchor(null);
            }}
            onAnchorPosted={() => setPendingAnchor(null)}
            onThreadFocus={focusThreadText}
            focusAnchor={focusAnchor}
            refreshSignal={commentsSig}
            onThreadDeleted={(anchor) => editorApi.current?.unwrapComment(anchor)}
            canModerate={canShare}
            suggestions={suggestions}
            canResolveSuggestions={canWrite && !locked}
            onResolveSuggestion={(id, accept) => editorApi.current?.resolveSuggestion(id, accept)}
            onSuggestionFocus={focusSuggestion}
            peopleNames={people}
          />
        </div>
      </aside>
      {templateOpen && isOwner && (
        <SaveTemplateDialog pageId={page.id} defaultTitle={current.title} onClose={() => setTemplateOpen(false)} />
      )}
      {verifyOpen && canVerify && (
        <VerifyDialog
          page={current}
          people={peopleList}
          onClose={() => setVerifyOpen(false)}
          onChanged={(fresh) => {
            setCurrent((prev) => ({
              ...prev,
              verified_at: fresh.verified_at,
              verified_until: fresh.verified_until,
              verified_by: fresh.verified_by,
              page_owner_id: fresh.page_owner_id,
            }));
            router.refresh();
          }}
        />
      )}
      {shareOpen && canShare && (
        <ShareDialog
          page={current}
          shares={localShares}
          invites={localInvites}
          helpBase={isOwner ? helpBase : null}
          feedback={feedback}
          canManageWorkspace={isOwner}
          memberRoleDefault={memberRoleDefault}
          onUpdate={updateSharing}
          onShare={handleShare}
          onRoleChange={handleRoleChange}
          onUnshare={handleUnshare}
          onRevokeInvite={handleRevokeInvite}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
