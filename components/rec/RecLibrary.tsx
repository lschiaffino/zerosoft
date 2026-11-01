'use client';

import LocalText from '@/components/ui/LocalText';
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { fmtClock, trimmedDuration } from '@/lib/rec-schema';
import { parseDbUtc } from '@/lib/utils';
import type { RecListItem } from '@/lib/rec';
import { copyToClipboard } from './RecCopy';
import { uploadAsset, uploadWhole } from './liveUpload';
import RecPending from './RecPending';
import { canvasToBlob, snapshot } from './recorder-media';
import { isRecVideoType, recMoveNotice } from '@/lib/rec-schema';
import { RecMoveDialog, RecNameDialog, notifyRecChanged, type MoveTarget, type RecFolder, type RecSpaceItem } from './RecDialogs';
import RecSpaceMembers from './RecSpaceMembers';

type Scope =
  | { kind: 'mine' }
  | { kind: 'workspace' }
  | { kind: 'folder'; folder: RecFolder }
  | { kind: 'space'; space: RecSpaceItem }
  | { kind: 'archived' }
  | { kind: 'later' };

/**
 * Biblioteca de Rec (como la de Loom): Mis videos, los del workspace y
 * carpetas. Grilla con miniatura (el GIF al pasar el mouse o con el foco),
 * duración, vistas y comentarios; buscar (también en la transcripción),
 * copiar link, renombrar, mover y borrar sin recargar.
 */
export default function RecLibrary({
  scope,
  initialVideos,
  initialFolders,
  initialSpaces = [],
  baseUrl,
}: {
  scope: Scope;
  initialVideos: RecListItem[];
  initialFolders: RecFolder[];
  initialSpaces?: RecSpaceItem[];
  baseUrl: string;
}) {
  const t = useTranslations('rec.library');
  const tc = useTranslations('rec.common');
  const locale = useLocale();
  const router = useRouter();
  const [videos, setVideos] = useState(initialVideos);
  const [folders, setFolders] = useState(initialFolders);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<RecListItem | null>(null);
  const [moving, setMoving] = useState<RecListItem | null>(null);
  const [deleting, setDeleting] = useState<RecListItem | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [newFolderSpace, setNewFolderSpace] = useState<'personal' | 'workspace'>(scope.kind === 'workspace' ? 'workspace' : 'personal');
  const [folderRename, setFolderRename] = useState(false);
  const [folderDelete, setFolderDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newSpace, setNewSpace] = useState(false);
  const [spaceRename, setSpaceRename] = useState(false);
  const [spaceDelete, setSpaceDelete] = useState(false);
  const [spaceMembers, setSpaceMembers] = useState(false);
  const first = useRef(true);
  // Avisa al sidebar y vacía la caché del router: volver atrás no muestra la lista vieja.
  const changed = () => {
    notifyRecChanged();
    router.refresh();
  };
  // Después de un refresh (o al volver con datos nuevos) la lista sigue a lo del servidor.
  const qRef = useRef(q);
  qRef.current = q;
  useEffect(() => {
    if (!qRef.current) setVideos(initialVideos);
  }, [initialVideos]);
  useEffect(() => setFolders(initialFolders), [initialFolders]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<number | null>(null);

  const scopeQuery =
    scope.kind === 'folder' ? `folder=${encodeURIComponent(scope.folder.id)}` : scope.kind === 'space' ? `space=${encodeURIComponent(scope.space.id)}` : `scope=${scope.kind}`;
  const listOnly = scope.kind === 'archived' || scope.kind === 'later';
  const spaceIdHere = scope.kind === 'space' ? scope.space.id : scope.kind === 'folder' ? (scope.folder.space_id ?? null) : null;

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = window.setTimeout(async () => {
      setLoading(true);
      const res = await fetch(`/api/rec/videos?${scopeQuery}&q=${encodeURIComponent(q)}`).catch(() => null);
      setLoading(false);
      if (!res?.ok) {
        setError(tc('errors.generic'));
        return;
      }
      const data = (await res.json()) as { videos: RecListItem[]; folders: RecFolder[] };
      setVideos(data.videos);
      setFolders(data.folders);
    }, 250);
    return () => window.clearTimeout(id);
  }, [q, scopeQuery, tc]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.rec-card-menu')) setMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', key);
    };
  }, [menu]);

  const fail = async (res: Response | null) => {
    const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'generic';
    setError(tc.has(`errors.${code}`) ? tc(`errors.${code}`) : tc('errors.generic'));
  };

  /** Duración, tamaño y un cuadro (miniatura) del archivo, leídos en el navegador. */
  function probe(file: File): Promise<{ duration: number; width: number; height: number; thumb: Blob | null }> {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      const url = URL.createObjectURL(file);
      const done = async (thumb: Blob | null) => {
        resolve({ duration: Number.isFinite(v.duration) ? v.duration : 0, width: v.videoWidth, height: v.videoHeight, thumb });
        URL.revokeObjectURL(url);
      };
      v.preload = 'metadata';
      v.muted = true;
      v.playsInline = true;
      v.onloadedmetadata = () => {
        v.currentTime = Number.isFinite(v.duration) ? Math.min(1, v.duration / 2) : 0;
      };
      v.onseeked = async () => {
        const shot = snapshot(v, 960);
        void done(shot ? await canvasToBlob(shot, 'image/jpeg', 0.82) : null);
      };
      v.onerror = () => void done(null);
      v.src = url;
    });
  }

  /** Subir un video que ya tenés (como en Loom): mismo camino por partes que la grabación. */
  async function onUpload(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    const type = (file.type || '').toLowerCase();
    if (!isRecVideoType(type)) {
      setError(tc('errors.invalid_type'));
      return;
    }
    setError(null);
    setUploading(0);
    try {
      const meta = await probe(file);
      const res = await fetch('/api/rec/videos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 200),
          mode: 'screen',
          contentType: type,
          folderId: scope.kind === 'folder' ? scope.folder.id : null,
          space: scope.kind === 'workspace' || scope.kind === 'space' ? 'workspace' : 'personal',
          spaceId: scope.kind === 'space' ? scope.space.id : null,
          // El nombre del archivo es un título elegido: la IA no lo reemplaza.
          titleSource: 'user',
        }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'upload_failed');
      const data = (await res.json()) as { video: { id: string }; upload: { mode: 'blob' | 'local'; partBytes: number } };
      await uploadWhole(data.video.id, 'video', file, data.upload.mode, data.upload.partBytes, {}, setUploading);
      if (meta.thumb) await uploadAsset(data.video.id, 'thumb', meta.thumb, { forTrim: '0:', atSec: Number.isFinite(meta.duration) ? Math.min(1, meta.duration / 2) : 0 }).catch(() => undefined);
      const fin = await fetch(`/api/rec/videos/${data.video.id}/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ durationSec: Math.round(meta.duration * 10) / 10, width: meta.width, height: meta.height }),
      });
      if (!fin.ok) throw new Error('upload_failed');
      changed();
      router.push(`/app/rec/${data.video.id}`);
    } catch (err) {
      const code = err instanceof Error ? err.message : 'upload_failed';
      setError(tc.has(`errors.${code}`) ? tc(`errors.${code}`) : tc('errors.upload_failed'));
      setUploading(null);
    }
  }

  async function patchVideo(v: RecListItem, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/rec/videos/${v.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      await fail(res);
      return false;
    }
    changed();
    return true;
  }

  async function rename(name: string) {
    if (!renaming) return;
    if (await patchVideo(renaming, { title: name })) {
      setVideos((prev) => prev.map((x) => (x.id === renaming.id ? { ...x, title: name } : x)));
      setRenaming(null);
    }
  }

  async function move(target: MoveTarget) {
    if (!moving) return;
    if (await patchVideo(moving, { folderId: target.folderId, space: target.space, spaceId: target.spaceId ?? null })) {
      const stays =
        scope.kind === 'folder'
          ? target.folderId === scope.folder.id
          : scope.kind === 'space'
            ? !target.folderId && target.spaceId === scope.space.id
            : scope.kind === 'archived' || scope.kind === 'later'
              ? true
              : !target.folderId && !target.spaceId && target.space === (scope.kind === 'workspace' ? 'workspace' : 'personal');
      setVideos((prev) => (stays ? prev.map((x) => (x.id === moving.id ? { ...x, folderId: target.folderId, space: target.space, spaceId: target.spaceId ?? null, privacy: recMoveNotice(x, target) === 'becomes_people' ? 'people' : x.privacy } : x)) : prev.filter((x) => x.id !== moving.id)));
      setMoving(null);
      setToast(t('moved'));
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const res = await fetch(`/api/rec/videos/${deleting.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res?.status !== 204) {
      await fail(res);
      return;
    }
    setVideos((prev) => prev.filter((x) => x.id !== deleting.id));
    setDeleting(null);
    changed();
  }

  /** Archivar o restaurar: sale de esta lista y queda en la otra. El link sigue andando. */
  async function setArchived(v: RecListItem, archived: boolean) {
    if (await patchVideo(v, { archived })) {
      setVideos((prev) => prev.filter((x) => x.id !== v.id));
      setToast(archived ? t('archived') : t('restored'));
    }
  }

  async function setLater(v: RecListItem, on: boolean) {
    setError(null);
    const res = await fetch(`/api/rec/videos/${v.id}/later`, { method: on ? 'POST' : 'DELETE' }).catch(() => null);
    if (!res?.ok) return fail(res);
    setVideos((prev) => (scope.kind === 'later' && !on ? prev.filter((x) => x.id !== v.id) : prev.map((x) => (x.id === v.id ? { ...x, watchLater: on } : x))));
    setToast(on ? t('laterAdded') : t('laterRemoved'));
    changed();
  }

  async function createSpace(name: string) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/rec/spaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return fail(res);
    const { space } = (await res.json()) as { space: RecSpaceItem };
    setNewSpace(false);
    changed();
    router.push(`/app/rec/s/${space.id}`);
  }

  async function renameSpace(name: string) {
    if (scope.kind !== 'space') return;
    setBusy(true);
    const res = await fetch(`/api/rec/spaces/${scope.space.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return fail(res);
    setSpaceRename(false);
    changed();
  }

  async function deleteSpace() {
    if (scope.kind !== 'space') return;
    setBusy(true);
    const res = await fetch(`/api/rec/spaces/${scope.space.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res?.status !== 204) return fail(res);
    setSpaceDelete(false);
    changed();
    router.push('/app/rec');
  }

  async function createFolder(name: string) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/rec/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, space: scope.kind === 'space' ? 'workspace' : newFolderSpace, spaceId: scope.kind === 'space' ? scope.space.id : null }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return fail(res);
    const { folder } = (await res.json()) as { folder: RecFolder };
    setFolders((prev) => [...prev, folder].sort((a, b) => a.name.localeCompare(b.name)));
    setNewFolder(false);
    changed();
    router.push(`/app/rec/f/${folder.id}`);
  }

  async function renameFolder(name: string) {
    if (scope.kind !== 'folder') return;
    setBusy(true);
    const res = await fetch(`/api/rec/folders/${scope.folder.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return fail(res);
    setFolderRename(false);
    changed();
    router.refresh();
  }

  async function deleteFolder() {
    if (scope.kind !== 'folder') return;
    setBusy(true);
    const res = await fetch(`/api/rec/folders/${scope.folder.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res?.status !== 204) return fail(res);
    setFolderDelete(false);
    changed();
    router.push(scope.folder.space === 'workspace' ? '/app/rec/workspace' : '/app/rec');
  }

  const shareUrl = (v: RecListItem) => `${baseUrl}/${locale}/v/${v.shareId}`;
  const date = (d: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parseDbUtc(d));
  const title =
    scope.kind === 'folder' ? scope.folder.name : scope.kind === 'space' ? scope.space.name : scope.kind === 'workspace' ? t('workspace') : scope.kind === 'archived' ? t('archive') : scope.kind === 'later' ? t('later') : t('mine');
  const desc =
    scope.kind === 'folder'
      ? scope.folder.space_id
        ? t('folderSpaceDesc')
        : scope.folder.space === 'workspace'
          ? t('folderWorkspaceDesc')
          : t('folderPersonalDesc')
      : scope.kind === 'space'
        ? t('spaceDesc', { n: scope.space.members })
        : scope.kind === 'workspace'
          ? t('workspaceDesc')
          : scope.kind === 'archived'
            ? t('archiveDesc')
            : scope.kind === 'later'
              ? t('laterDesc')
              : t('mineDesc');
  const recordHref =
    scope.kind === 'folder'
      ? `/app/rec/new?folder=${scope.folder.id}`
      : scope.kind === 'space'
        ? `/app/rec/new?spaceId=${scope.space.id}`
        : scope.kind === 'workspace'
          ? '/app/rec/new?space=workspace'
          : '/app/rec/new';
  const subFolders =
    scope.kind === 'folder' || listOnly
      ? []
      : scope.kind === 'space'
        ? folders.filter((f) => f.space_id === scope.space.id)
        : folders.filter((f) => !f.space_id && f.space === (scope.kind === 'workspace' ? 'workspace' : 'personal'));
  // Buscando: también las carpetas (de los dos espacios) cuyo nombre coincide.
  const needle = q.trim().toLowerCase();
  const shownFolders = needle ? folders.filter((f) => f.name.toLowerCase().includes(needle)) : subFolders;

  return (
    <div className="app-page ui-page rec-library" data-testid="rec-library">
      <PageHeader
        title={title}
        description={desc}
        back={
          scope.kind === 'folder'
            ? spaceIdHere
              ? { href: `/app/rec/s/${spaceIdHere}`, label: t('spaces') }
              : { href: scope.folder.space === 'workspace' ? '/app/rec/workspace' : '/app/rec', label: scope.folder.space === 'workspace' ? t('workspace') : t('mine') }
            : undefined
        }
        actions={
          listOnly ? undefined : (
          <>
            {scope.kind === 'mine' && (
              <button type="button" className="btn btn-secondary" onClick={() => setNewSpace(true)} data-testid="rec-new-space">
                {t('newSpace')}
              </button>
            )}
            {scope.kind === 'space' && (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSpaceMembers(true)} data-testid="rec-space-members">
                  {t('spaceMembers')}
                </button>
                {scope.space.canManage && (
                  <>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSpaceRename(true)} data-testid="rec-space-rename">
                      {t('renameSpace')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setSpaceDelete(true)} data-testid="rec-space-delete">
                      {t('deleteSpace')}
                    </button>
                  </>
                )}
              </>
            )}
            {scope.kind === 'folder' ? (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFolderRename(true)}>
                  {t('renameFolder')}
                </button>
                <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setFolderDelete(true)}>
                  {t('deleteFolder')}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => setNewFolder(true)} data-testid="rec-new-folder">
                {t('newFolder')}
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => fileRef.current?.click()}
              disabled={uploading !== null}
              aria-busy={uploading !== null || undefined}
              data-testid="rec-upload"
            >
              {uploading !== null ? t('uploadingPct', { pct: uploading }) : t('upload')}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="video/webm,video/mp4,video/quicktime"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="rec-upload-file"
              onChange={(e) => void onUpload(e.target.files?.[0])}
            />
            <Link href={recordHref} className="btn btn-primary" data-testid="rec-record">
              {t('record')}
            </Link>
          </>
          )
        }
      />
      {scope.kind !== 'folder' && !listOnly && <RecPending />}
      <div className="rec-toolbar">
        <input
          type="search"
          className="input rec-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          aria-busy={loading || undefined}
        />
      </div>
      {error && !moving && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {scope.kind === 'mine' && !needle && initialSpaces.length > 0 && (
        <ul className="rec-folders" aria-label={t('spaces')} data-testid="rec-spaces">
          {initialSpaces.map((s) => (
            <li key={s.id}>
              <Link href={`/app/rec/s/${s.id}`} className="rec-folder">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M4 5h16v14H4zM4 10h16M9 10v9" />
                </svg>
                <span>{s.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {shownFolders.length > 0 && (
        <ul className="rec-folders" aria-label={t('folders')}>
          {shownFolders.map((f) => (
            <li key={f.id}>
              <Link href={`/app/rec/f/${f.id}`} className="rec-folder">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M3 6h6l2 2h10v11H3z" />
                </svg>
                <span>{f.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {videos.length === 0 ? (
        q ? (
          shownFolders.length ? null : 
          <p className="ui-help">{t('noMatches')}</p>
        ) : (
          <EmptyState
            product="rec"
            title={
              scope.kind === 'workspace'
                ? t('emptyWorkspaceTitle')
                : scope.kind === 'archived'
                  ? t('emptyArchiveTitle')
                  : scope.kind === 'later'
                    ? t('emptyLaterTitle')
                    : scope.kind === 'space'
                      ? t('emptySpaceTitle')
                      : t('emptyTitle')
            }
            body={
              scope.kind === 'workspace'
                ? t('emptyWorkspaceBody')
                : scope.kind === 'archived'
                  ? t('emptyArchiveBody')
                  : scope.kind === 'later'
                    ? t('emptyLaterBody')
                    : scope.kind === 'space'
                      ? t('emptySpaceBody')
                      : t('emptyBody')
            }
            action={listOnly ? { label: t('mine'), href: '/app/rec' } : { label: t('record'), href: recordHref }}
          />
        )
      ) : (
        <ul className="rec-grid" aria-label={t('videos')}>
          {videos.map((v) => {
            const dur = trimmedDuration(v.durationSec, v.trimStart, v.trimEnd);
            const file = `/api/rec/videos/${v.id}/file`;
            return (
              <li key={v.id} className="rec-card" data-testid="rec-card">
                <Link href={`/app/rec/${v.id}`} className="rec-card-link">
                  <span className={`rec-thumb${v.hasGif ? ' has-gif' : ''}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- miniatura servida por la ruta con permisos */}
                    {v.hasThumb ? <img src={`${file}?kind=thumb`} alt="" loading="lazy" /> : <span className="rec-thumb-empty" aria-hidden="true" />}
                    {/* eslint-disable-next-line @next/next/no-img-element -- GIF animado, next/image no lo anima */}
                    {v.hasGif && <img className="rec-thumb-gif" src={`${file}?kind=gif`} alt="" loading="lazy" />}
                    {dur > 0 && <span className="rec-dur data">{fmtClock(dur)}</span>}
                  </span>
                  <span className="rec-card-title">{v.title}</span>
                </Link>
                <div className="rec-card-meta">
                  <span className="muted">
                    {v.authorName ? `${v.authorName} · ` : ''}
                    <LocalText>{date(v.createdAt)}</LocalText>
                  </span>
                  <span className="muted data">
                    {t('viewsShort', { n: v.uniqueViewers })}
                    {v.comments > 0 ? ` · ${t('commentsShort', { n: v.comments })}` : ''}
                  </span>
                </div>
                <div className="rec-card-menu">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon"
                    aria-haspopup="menu"
                    aria-expanded={menu === v.id}
                    aria-label={t('actionsFor', { title: v.title })}
                    onClick={() => setMenu(menu === v.id ? null : v.id)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="5" cy="12" r="1.8" fill="currentColor" />
                      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
                      <circle cx="19" cy="12" r="1.8" fill="currentColor" />
                    </svg>
                  </button>
                  {menu === v.id && (
                    <div className="rec-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="rec-menu-item"
                        autoFocus
                        onClick={async () => {
                          setMenu(null);
                          if (await copyToClipboard(shareUrl(v))) setToast(tc('linkCopied'));
                        }}
                      >
                        {t('copyLink')}
                      </button>
                      <button type="button" role="menuitem" className="rec-menu-item" data-testid="rec-card-later" onClick={() => (setMenu(null), void setLater(v, !v.watchLater))}>
                        {v.watchLater ? t('laterRemove') : t('laterAdd')}
                      </button>
                      {v.canManage && (
                        <>
                          <button type="button" role="menuitem" className="rec-menu-item" onClick={() => (setMenu(null), setRenaming(v))}>
                            {t('rename')}
                          </button>
                          <button type="button" role="menuitem" className="rec-menu-item" onClick={() => (setMenu(null), setError(null), setMoving(v))}>
                            {t('moveTo')}
                          </button>
                          <button type="button" role="menuitem" className="rec-menu-item" data-testid="rec-card-archive" onClick={() => (setMenu(null), void setArchived(v, !v.archived))}>
                            {v.archived ? t('restore') : t('archiveAction')}
                          </button>
                          <button type="button" role="menuitem" className="rec-menu-item danger" onClick={() => (setMenu(null), setDeleting(v))}>
                            {t('delete')}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {toast && (
        <div className="ui-toasts" aria-live="polite">
          <div className="ui-toast" role="status">
            {toast}
          </div>
        </div>
      )}
      <RecNameDialog
        open={renaming !== null}
        title={t('renameTitle')}
        label={t('name')}
        initial={renaming?.title ?? ''}
        submitLabel={tc('save')}
        busy={busy}
        onSubmit={(n) => void rename(n)}
        onClose={() => setRenaming(null)}
      />
      <RecNameDialog open={newSpace} title={t('newSpace')} label={t('name')} submitLabel={t('create')} busy={busy} onSubmit={(n) => void createSpace(n)} onClose={() => setNewSpace(false)} />
      {scope.kind === 'space' && (
        <>
          <RecNameDialog open={spaceRename} title={t('renameSpace')} label={t('name')} initial={scope.space.name} submitLabel={tc('save')} busy={busy} onSubmit={(n) => void renameSpace(n)} onClose={() => setSpaceRename(false)} />
          <ConfirmDialog
            open={spaceDelete}
            title={t('deleteSpaceTitle', { name: scope.space.name })}
            body={t('deleteSpaceBody')}
            confirmLabel={t('delete')}
            cancelLabel={tc('cancel')}
            danger
            busy={busy}
            onConfirm={() => void deleteSpace()}
            onCancel={() => setSpaceDelete(false)}
          />
          <RecSpaceMembers open={spaceMembers} spaceId={scope.space.id} canManage={scope.space.canManage} onClose={() => setSpaceMembers(false)} onChanged={changed} />
        </>
      )}
      <RecNameDialog
        open={newFolder}
        title={t('newFolder')}
        label={t('name')}
        submitLabel={t('create')}
        busy={busy}
        onSubmit={(n) => void createFolder(n)}
        onClose={() => setNewFolder(false)}
        extra={
          scope.kind === 'space' ? undefined : (
          <fieldset className="rec-space-pick">
            <legend className="label">{t('folderSpace')}</legend>
            {(['personal', 'workspace'] as const).map((s) => (
              <label key={s} className="ui-check">
                <input type="radio" name="rec-folder-space" checked={newFolderSpace === s} onChange={() => setNewFolderSpace(s)} />
                <span>{s === 'workspace' ? t('spaceWorkspace') : t('spacePersonal')}</span>
              </label>
            ))}
          </fieldset>
          )
        }
      />
      {scope.kind === 'folder' && (
        <>
          <RecNameDialog
            open={folderRename}
            title={t('renameFolder')}
            label={t('name')}
            initial={scope.folder.name}
            submitLabel={tc('save')}
            busy={busy}
            onSubmit={(n) => void renameFolder(n)}
            onClose={() => setFolderRename(false)}
          />
          <ConfirmDialog
            open={folderDelete}
            title={t('deleteFolderTitle', { name: scope.folder.name })}
            body={t('deleteFolderBody')}
            confirmLabel={t('delete')}
            cancelLabel={tc('cancel')}
            danger
            busy={busy}
            onConfirm={() => void deleteFolder()}
            onCancel={() => setFolderDelete(false)}
          />
        </>
      )}
      <RecMoveDialog
        open={moving !== null}
        folders={folders}
        spaces={initialSpaces}
        current={{ space: moving?.space ?? 'personal', folderId: moving?.folderId ?? null, spaceId: moving?.spaceId ?? null }}
        privacy={moving?.privacy}
        error={moving ? error : null}
        busy={busy}
        onMove={(m) => void move(m)}
        onClose={() => setMoving(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? t('deleteTitle', { title: deleting.title }) : ''}
        body={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
