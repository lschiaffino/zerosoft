'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { LineFolderDto } from '@/lib/groups-lines';
import { flattenTree } from '@/lib/inbox/folder-tree';
import { Modal } from './ui';

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

/** Avisa que cambiaron las carpetas o lo que hay adentro (crear, renombrar, borrar, mover chats). */
export const FOLDERS_CHANGED = 'zs:lines-folders-changed';
export function notifyFoldersChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(FOLDERS_CHANGED));
}

/** Selector de carpeta para cuando el sidebar no está a la vista (teléfono o sidebar colapsado). */
export function FolderSelect({ folders, value, onChange }: { folders: LineFolderDto[]; value: string; onChange: (v: string) => void }) {
  const t = useTranslations('groups.lines');
  const rows = useMemo(() => flattenTree(folders), [folders]);
  if (folders.length === 0) return null;
  return (
    <select className="select gr-folder-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('folders')} data-testid="lines-folder-select">
      <option value="">{t('allChats')}</option>
      {rows.map(({ folder: f, depth }) => (
        <option key={f.id} value={f.id}>
          {'\u00a0\u00a0'.repeat(depth) + f.name}
        </option>
      ))}
      <option value="none">{t('unfiled')}</option>
    </select>
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
