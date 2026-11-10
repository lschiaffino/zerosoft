'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { LineFolderDto } from '@/lib/groups-lines';
import { flattenTree, MAX_FOLDER_DEPTH } from '@/lib/inbox/folder-tree';
import { Modal, api, useErrorText } from './ui';
import { MessageMenu } from './ThreadParts';

export const DRAG_TYPE = 'application/x-zs-lines-chats';

export interface LineOption {
  id: string;
  name: string;
  phone: string;
  ownerId: string | null;
  ownerName: string;
}

/** Selector de línea: una o "Todas las líneas". Se recuerda por persona en el servidor. */
export function LineSelector({ numbers, value, onChange }: { numbers: LineOption[]; value: string; onChange: (v: string) => void }) {
  const t = useTranslations('groups.lines');
  if (numbers.length < 2) return null;
  return (
    <select className="select gr-line-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('selectorLabel')}>
      <option value="all">{t('all')}</option>
      {numbers.map((n) => (
        <option key={n.id} value={n.id}>
          {n.name}
        </option>
      ))}
    </select>
  );
}

/** Chip con la línea de un chat (en la vista "Todas las líneas"). */
export function LineBadge({ name }: { name: string }) {
  return (
    <span className="gr-line-badge" title={name}>
      {name}
    </span>
  );
}

/** Carpetas compartidas: filtrar, crear, renombrar, borrar y soltar chats encima. */
export function FoldersPanel({
  folders,
  unfiled,
  selected,
  onSelect,
  onChanged,
  onDropChats,
}: {
  folders: LineFolderDto[];
  unfiled: { unread: number; chats: number };
  /** '' = sin filtro, 'none' = sin carpeta, o el id. */
  selected: string;
  onSelect: (id: string) => void;
  onChanged: () => void;
  onDropChats: (ids: string[], folderId: string | null) => void;
}) {
  const t = useTranslations('groups.lines');
  const tc = useTranslations('groups.common');
  const errText = useErrorText();
  const [open, setOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<{ id: string | null; parentId: string | null; name: string } | null>(null);
  const [removing, setRemoving] = useState<LineFolderDto | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const rows = useMemo(() => flattenTree(folders, collapsed), [folders, collapsed]);
  const depthOf = (id: string) => rows.find((r) => r.folder.id === id)?.depth ?? 0;

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
    onChanged();
  }

  async function remove() {
    const f = removing;
    setRemoving(null);
    if (!f) return;
    const r = await api(`/api/groups/folders?id=${encodeURIComponent(f.id)}`, { method: 'DELETE' });
    if (!r.data) setError(errText(r.error));
    if (selected === f.id) onSelect('');
    onChanged();
  }

  function drop(e: React.DragEvent, folderId: string | null) {
    e.preventDefault();
    setOver(null);
    try {
      const ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as string[];
      if (Array.isArray(ids) && ids.length) onDropChats(ids, folderId);
    } catch {
      // Lo soltado no era un chat de la lista.
    }
  }
  const dropProps = (key: string, folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes(DRAG_TYPE)) {
        e.preventDefault();
        setOver(key);
      }
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: React.DragEvent) => drop(e, folderId),
  });

  return (
    <div className="gr-folders" data-testid="lines-folders">
      <div className="gr-folders-head">
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {t('folders')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit({ id: null, parentId: null, name: '' })} data-testid="lines-folder-new">
          {t('newFolder')}
        </button>
      </div>
      {open && (
        <>
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          {folders.length === 0 ? (
            <p className="ui-help gr-folders-empty">{t('foldersEmpty')}</p>
          ) : (
            <ul className="gr-folder-list">
              <li>
                <button type="button" className={`gr-folder${selected === '' ? ' is-on' : ''}`} aria-pressed={selected === ''} onClick={() => onSelect('')}>
                  <span className="gr-folder-name">{t('allChats')}</span>
                </button>
              </li>
              {rows.map(({ folder: f, depth, hasChildren }) => (
                <li key={f.id} className="gr-folder-item" style={{ paddingInlineStart: depth * 14 }}>
                  {hasChildren ? (
                    <button
                      type="button"
                      className="gr-folder-toggle"
                      aria-label={collapsed.has(f.id) ? t('expand', { name: f.name }) : t('collapse', { name: f.name })}
                      aria-expanded={!collapsed.has(f.id)}
                      onClick={() =>
                        setCollapsed((s) => {
                          const n = new Set(s);
                          if (n.has(f.id)) n.delete(f.id);
                          else n.add(f.id);
                          return n;
                        })
                      }
                    >
                      {collapsed.has(f.id) ? '+' : '-'}
                    </button>
                  ) : (
                    <span className="gr-folder-toggle" aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    className={`gr-folder${selected === f.id ? ' is-on' : ''}${over === f.id ? ' is-over' : ''}`}
                    aria-pressed={selected === f.id}
                    onClick={() => onSelect(selected === f.id ? '' : f.id)}
                    data-testid="lines-folder"
                    {...dropProps(f.id, f.id)}
                  >
                    <span className="gr-folder-name">{f.name}</span>
                    {f.unread > 0 && (
                      <span className="gr-unread" aria-label={t('folderUnread', { n: f.unread })}>
                        {f.unread > 99 ? '99+' : f.unread}
                      </span>
                    )}
                  </button>
                  <MessageMenu
                    label={t('folderOptions', { name: f.name })}
                    align="right"
                    items={[
                      { key: 'rename', label: t('rename'), onSelect: () => setEdit({ id: f.id, parentId: f.parentId, name: f.name }) },
                      ...(depthOf(f.id) < MAX_FOLDER_DEPTH ? [{ key: 'sub', label: t('newSubfolder'), onSelect: () => setEdit({ id: null, parentId: f.id, name: '' }) }] : []),
                      { key: 'delete', label: tc('delete'), danger: true, divider: true, onSelect: () => setRemoving(f) },
                    ]}
                    trigger={<span aria-hidden="true">...</span>}
                    className="gr-folder-menu"
                  />
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className={`gr-folder${selected === 'none' ? ' is-on' : ''}${over === 'none' ? ' is-over' : ''}`}
                  aria-pressed={selected === 'none'}
                  onClick={() => onSelect(selected === 'none' ? '' : 'none')}
                  {...dropProps('none', null)}
                >
                  <span className="gr-folder-name">{t('unfiled')}</span>
                  {unfiled.unread > 0 && <span className="gr-unread">{unfiled.unread > 99 ? '99+' : unfiled.unread}</span>}
                </button>
              </li>
            </ul>
          )}
        </>
      )}
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
    </div>
  );
}

/** "Mover a carpeta" desde el menú de un chat o la barra de selección (alternativa al arrastre, con teclado). */
export function MoveToFolderModal({
  open,
  folders,
  onClose,
  onPick,
}: {
  open: boolean;
  folders: LineFolderDto[];
  onClose: () => void;
  onPick: (folderId: string | null) => void;
}) {
  const t = useTranslations('groups.lines');
  const tc = useTranslations('groups.common');
  const rows = useMemo(() => flattenTree(folders), [folders]);
  return (
    <Modal
      open={open}
      title={t('moveTitle')}
      onClose={onClose}
      foot={
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {tc('cancel')}
        </button>
      }
    >
      <ul className="gr-folder-list gr-folder-pick">
        {rows.map(({ folder: f, depth }) => (
          <li key={f.id} style={{ paddingInlineStart: depth * 14 }}>
            <button type="button" className="gr-folder" onClick={() => onPick(f.id)}>
              <span className="gr-folder-name">{f.name}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="gr-folder" onClick={() => onPick(null)}>
            <span className="gr-folder-name">{t('unfiled')}</span>
          </button>
        </li>
      </ul>
      {folders.length === 0 && <p className="ui-help">{t('foldersEmpty')}</p>}
    </Modal>
  );
}
