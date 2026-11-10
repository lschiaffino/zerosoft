'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import Icon from '@/components/app/icons';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useShellBranch } from '@/components/app/useShellBranch';
import type { LineFolderDto } from '@/lib/groups-lines';
import { flattenTree, MAX_FOLDER_DEPTH } from '@/lib/inbox/folder-tree';
import { Modal, api, useErrorText } from './ui';
import { MessageMenu } from './ThreadParts';
import { DRAG_TYPE, DROP_CHATS, FOLDERS_CHANGED, notifyFoldersChanged, type DropChatsDetail } from './LineFolders';

interface FolderData {
  folders: LineFolderDto[];
  unfiled: { unread: number; chats: number };
}

/**
 * Carpetas de Lines en el sidebar, colgadas de "Bandeja" (como las de Inbox):
 * abrir una filtra la bandeja (?folder=), se crean, renombran y borran acá, y
 * se les sueltan chats encima. Con el sidebar colapsado o en el teléfono la
 * bandeja ofrece un selector de carpeta en su lugar.
 */
export default function GroupsFoldersBranch() {
  const t = useTranslations('groups.lines');
  const tc = useTranslations('groups.common');
  const errText = useErrorText();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const slot = useShellBranch();
  const [data, setData] = useState<FolderData | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<{ id: string | null; parentId: string | null; name: string } | null>(null);
  const [removing, setRemoving] = useState<LineFolderDto | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const inInbox = pathname.startsWith('/app/lines/inbox');
  const selected = inInbox ? (params.get('folder') ?? '') : '';
  const base = inInbox ? pathname : '/app/lines/inbox';
  const rows = useMemo(() => flattenTree(data?.folders ?? [], collapsed), [data, collapsed]);

  const load = useCallback(async () => {
    const r = await api<FolderData>('/api/groups/folders');
    if (r.data) setData(r.data);
  }, []);
  useEffect(() => {
    void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener(FOLDERS_CHANGED, load);
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(onVisible, 30_000);
    return () => {
      window.removeEventListener(FOLDERS_CHANGED, load);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, [load]);

  useEffect(() => {
    if (edit) setError('');
  }, [edit]);

  async function save() {
    if (!edit || !edit.name.trim()) return;
    setBusy(true);
    const r = edit.id
      ? await api('/api/groups/folders', { method: 'PATCH', body: { id: edit.id, name: edit.name } })
      : await api('/api/groups/folders', { body: { name: edit.name, parentId: edit.parentId } });
    setBusy(false);
    if (!r.data) return setError(errText(r.error));
    setEdit(null);
    notifyFoldersChanged();
  }

  async function remove() {
    const f = removing;
    setRemoving(null);
    if (!f) return;
    const r = await api(`/api/groups/folders?id=${encodeURIComponent(f.id)}`, { method: 'DELETE' });
    if (!r.data) setError(errText(r.error));
    if (selected === f.id) router.push(base);
    notifyFoldersChanged();
  }

  const dropProps = (key: string, folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes(DRAG_TYPE)) {
        e.preventDefault();
        setOver(key);
      }
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      try {
        const ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as string[];
        if (Array.isArray(ids) && ids.length) window.dispatchEvent(new CustomEvent<DropChatsDetail>(DROP_CHATS, { detail: { ids, folderId } }));
      } catch {
        // Lo soltado no era un chat de la lista.
      }
    },
  });
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const unread = (n: number) => (n > 0 ? <span className="gr-branch-count gr-branch-unread">{n > 99 ? '99+' : n}</span> : null);

  const dialogs = (
    <>
      <Modal
        open={!!edit}
        title={edit?.id ? t('renameFolder') : edit?.parentId ? t('newSubfolder') : t('newFolder')}
        onClose={() => setEdit(null)}
        onSubmit={() => void save()}
        busy={busy}
        foot={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>
              {tc('cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={!edit?.name.trim()} aria-busy={busy || undefined}>
              {tc('save')}
            </button>
          </>
        }
      >
        <div className="ui-fields">
          <label className="ui-field">
            <span className="label">{t('folderName')}</span>
            <input className="input" value={edit?.name ?? ''} onChange={(e) => setEdit((s) => (s ? { ...s, name: e.target.value } : s))} maxLength={60} autoFocus required />
          </label>
          {error && edit && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={!!removing}
        title={t('deleteFolderTitle', { name: removing?.name ?? '' })}
        body={t('deleteFolderBody')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </>
  );

  if (!slot || !data) return dialogs;
  return (
    <>
      {createPortal(
        <nav className="docs-branch gr-folders-branch" aria-label={t('folders')} data-testid="lines-folders">
          <div className="gr-fb-head">
            <span className="gr-fb-title">{t('folders')}</span>
            <button type="button" className="gr-fb-btn" aria-label={t('newFolder')} title={t('newFolder')} onClick={() => setEdit({ id: null, parentId: null, name: '' })} data-testid="lines-folder-new">
              <Icon name="plus" size={14} />
            </button>
          </div>
          {error && !edit && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          <ul className="docs-tree" role="list">
            {rows.map(({ folder: f, depth, hasChildren }) => {
              const active = selected === f.id;
              const open = !collapsed.has(f.id);
              return (
                <li
                  key={f.id}
                  className={`docs-tree-row gr-fb-row${active ? ' active' : ''}${over === f.id ? ' is-over' : ''}`}
                  style={{ '--d': depth } as React.CSSProperties}
                  {...dropProps(f.id, f.id)}
                >
                  {hasChildren ? (
                    <button type="button" className={`gr-fb-btn gr-fb-chevron${open ? ' open' : ''}`} aria-label={open ? t('collapse', { name: f.name }) : t('expand', { name: f.name })} aria-expanded={open} onClick={() => toggle(f.id)}>
                      <Icon name="chevronRight" size={12} />
                    </button>
                  ) : (
                    <span className="docs-tree-chevron-spacer" aria-hidden="true" />
                  )}
                  <Link href={active ? base : `${base}?folder=${f.id}`} className="docs-tree-link" aria-current={active ? 'page' : undefined} data-testid="lines-folder">
                    <span className="docs-tree-icon" aria-hidden="true">
                      <Icon name="folder" size={14} />
                    </span>
                    <span className="docs-tree-title">{f.name}</span>
                    {f.unread > 0 && <span className="sr-only">{t('folderUnread', { n: f.unread })}</span>}
                    {unread(f.unread)}
                  </Link>
                  <MessageMenu
                    label={t('folderOptions', { name: f.name })}
                    align="right"
                    items={[
                      { key: 'rename', label: t('rename'), onSelect: () => setEdit({ id: f.id, parentId: f.parentId, name: f.name }) },
                      ...(depth < MAX_FOLDER_DEPTH ? [{ key: 'sub', label: t('newSubfolder'), onSelect: () => setEdit({ id: null, parentId: f.id, name: '' }) }] : []),
                      { key: 'delete', label: tc('delete'), danger: true, divider: true, onSelect: () => setRemoving(f) },
                    ]}
                    trigger={<span aria-hidden="true">···</span>}
                    className="gr-fb-btn gr-fb-more"
                  />
                </li>
              );
            })}
            {data.folders.length > 0 && (
              <li className={`docs-tree-row gr-fb-row${selected === 'none' ? ' active' : ''}${over === 'none' ? ' is-over' : ''}`} {...dropProps('none', null)}>
                <span className="docs-tree-chevron-spacer" aria-hidden="true" />
                <Link href={selected === 'none' ? base : `${base}?folder=none`} className="docs-tree-link" aria-current={selected === 'none' ? 'page' : undefined}>
                  <span className="docs-tree-title">{t('unfiled')}</span>
                  {unread(data.unfiled.unread)}
                </Link>
              </li>
            )}
          </ul>
        </nav>,
        slot,
      )}
      {dialogs}
    </>
  );
}
