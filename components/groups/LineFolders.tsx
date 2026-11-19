'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { LineFolderDto } from '@/lib/groups-lines';
import { flattenTree } from '@/lib/inbox/folder-tree';
import MenuSelect from '@/components/ui/MenuSelect';
import { Modal } from './ui';
import LineDot from './LineDot';

export { LineDot };

/** Últimos 4 dígitos del teléfono, para distinguir líneas con nombres parecidos. */
function phoneTail(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length > 4 ? `···${d.slice(-4)}` : d;
}

export interface LineOption {
  id: string;
  name: string;
  phone: string;
  ownerId: string | null;
  ownerName: string;
  /** Color elegido en Ajustes › Números (lib/line-colors.ts); '' = sin color. */
  color?: string;
  /** Grupo de líneas (lib/groups-line-groups.ts); null o ausente = sin grupo. */
  groupId?: string | null;
}

/** Un grupo de líneas, con las líneas que ve quien mira. */
export interface LineGroupOption {
  id: string;
  name: string;
}

/** Valor del selector para un grupo entero (igual que LINE_GROUP_PREFIX en lib/groups-lines.ts). */
export const lineGroupValue = (groupId: string) => `g:${groupId}`;
/** Id del grupo si el valor del selector es un grupo; si no, ''. */
export const lineGroupOf = (value: string) => (value.startsWith('g:') ? value.slice(2) : '');


/**
 * Selector de línea: una, un grupo de líneas entero o "Todas las líneas". Se recuerda por persona en el
 * servidor. Con grupos, cada línea va debajo del nombre de su grupo (que también se elige) y las sueltas al
 * final. Solo llegan acá las líneas que la persona ve, y los grupos donde ve alguna.
 */
export function LineSelector({ numbers, groups = [], value, onChange }: { numbers: LineOption[]; groups?: LineGroupOption[]; value: string; onChange: (v: string) => void }) {
  const t = useTranslations('groups.lines');
  if (numbers.length < 2) return null;
  const option = (n: LineOption, depth = 0) => ({ value: n.id, label: n.name, hint: n.phone ? phoneTail(n.phone) : undefined, lead: <LineDot color={n.color} />, depth });
  const shown = groups.filter((g) => numbers.some((n) => n.groupId === g.id));
  const inGroup = new Set(shown.map((g) => g.id));
  const grouped = shown.flatMap((g) => {
    const lines = numbers.filter((n) => n.groupId === g.id);
    return [{ value: lineGroupValue(g.id), label: g.name, hint: t('groupLines', { n: lines.length }), group: true }, ...lines.map((n) => option(n, 1))];
  });
  const loose = numbers.filter((n) => !n.groupId || !inGroup.has(n.groupId)).map((n) => option(n));
  return (
    <MenuSelect
      className="gr-line-select"
      testId="lines-line-select"
      tour="lines-line-select"
      label={t('selectorLabel')}
      value={value}
      onChange={onChange}
      options={[{ value: 'all', label: t('all') }, ...grouped, ...loose]}
    />
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
    <MenuSelect
      className="gr-folder-select"
      testId="lines-folder-select"
      label={t('folders')}
      value={value}
      onChange={onChange}
      options={[{ value: '', label: t('allChats') }, { value: 'none', label: t('unfiled') }, ...rows.map(({ folder: f, depth }) => ({ value: f.id, label: f.name, depth }))]}
    />
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
