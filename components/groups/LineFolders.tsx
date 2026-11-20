'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { LineFolderDto } from '@/lib/groups-lines';
import { flattenTree } from '@/lib/inbox/folder-tree';
import MenuSelect from '@/components/ui/MenuSelect';
import { api, useErrorText } from './ui';
import LineDot from './LineDot';
import FolderPickerDialog from '@/components/ui/FolderPickerDialog';
import { FolderIcon, GroupIcon } from './wa/icons';

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

/** Lo que responde /api/groups/folders: las carpetas de quien mira, las del equipo y si puede administrar las del equipo. */
export interface LineFoldersResponse {
  folders: LineFolderDto[];
  team: LineFolderDto[];
  unfiled: { unread: number; chats: number };
  canManageTeam: boolean;
}

export const EMPTY_FOLDERS: LineFoldersResponse = { folders: [], team: [], unfiled: { unread: 0, chats: 0 }, canManageTeam: false };

/**
 * Selector de carpeta para cuando el sidebar no está a la vista (teléfono o sidebar colapsado). Las del equipo van
 * primero, marcadas "Equipo"; las propias después.
 */
export function FolderSelect({ folders, team = [], value, onChange }: { folders: LineFolderDto[]; team?: LineFolderDto[]; value: string; onChange: (v: string) => void }) {
  const t = useTranslations('groups.lines');
  const rows = useMemo(() => flattenTree(folders), [folders]);
  const teamRows = useMemo(() => flattenTree(team), [team]);
  if (folders.length === 0 && team.length === 0) return null;
  return (
    <MenuSelect
      className="gr-folder-select"
      testId="lines-folder-select"
      label={t('folders')}
      value={value}
      onChange={onChange}
      options={[
        { value: '', label: t('allChats') },
        { value: 'none', label: t('unfiled'), hint: team.length ? t('unfiledShort') : undefined },
        ...teamRows.map(({ folder: f, depth }) => ({ value: f.id, label: f.name, depth, hint: depth === 0 ? t('teamFolders') : undefined })),
        ...rows.map(({ folder: f, depth }) => ({ value: f.id, label: f.name, depth })),
      ]}
    />
  );
}

/**
 * "Mover a carpeta" desde el menú de un chat, la barra de selección o la cabecera del chat (alternativa al arrastre,
 * con teclado). Es el mismo diálogo que Inbox (components/ui/FolderPickerDialog): búsqueda, flechas y Enter, "Sin
 * carpeta" primero y "+ Carpeta nueva" ahí mismo (crea una propia y mueve el chat). Con carpetas del equipo va en dos
 * secciones: las del equipo (lo que se pone ahí lo ve todo el workspace) y las propias. `teamValue` y `value` marcan
 * dónde está ahora (un solo chat).
 */
export function MoveToFolderModal({
  open,
  folders,
  team = [],
  value,
  teamValue,
  onClose,
  onPick,
}: {
  open: boolean;
  folders: LineFolderDto[];
  team?: LineFolderDto[];
  value?: string | null;
  teamValue?: string | null;
  onClose: () => void;
  /** folderId null = sacarlo; `scope` dice de cuál (la propia, la del equipo, o de las dos con 'all'). */
  onPick: (folderId: string | null, name?: string, scope?: 'personal' | 'team' | 'all') => void;
}) {
  const t = useTranslations('groups.lines');
  const tc = useTranslations('groups.common');
  const errText = useErrorText();
  const sections = team.length > 0;
  const plain = (list: LineFolderDto[]) => list.map((f) => ({ id: f.id, parentId: f.parentId, position: f.position, name: f.name }));
  const nameOf = (id: string) => [...team, ...folders].find((f) => f.id === id)?.name;
  return (
    <FolderPickerDialog
      open={open}
      title={t('moveTitle')}
      testIdPrefix="lines-move"
      sections={[
        ...(sections
          ? [
              {
                key: 'team',
                title: t('moveTeamHeading'),
                icon: <GroupIcon size={14} />,
                folders: plain(team),
                current: teamValue ? [teamValue] : [],
                none: teamValue ? { label: t('unfiled'), testId: 'lines-move-team-none' } : null,
                testId: 'lines-move-team',
              },
            ]
          : []),
        {
          key: 'personal',
          title: t('moveMineHeading'),
          icon: <FolderIcon size={14} />,
          folders: plain(folders),
          current: value ? [value] : [],
          none: folders.length > 0 ? { label: t('unfiled'), testId: 'lines-move-none' } : null,
          testId: 'lines-move-mine',
        },
      ]}
      labels={{
        filter: t('moveFilter'),
        empty: t('foldersEmpty'),
        noMatch: t('moveNoMatch'),
        current: t('moveCurrent'),
        newFolder: t('newFolder'),
        folderName: t('folderName'),
        create: t('createAndMove'),
        close: tc('close'),
      }}
      onClose={onClose}
      onPick={(key, id) => onPick(id, id ? nameOf(id) : undefined, key === 'team' ? 'team' : 'personal')}
      onCreate={async (name) => {
        const r = await api<{ id: string; name: string }>('/api/groups/folders', { body: { name } });
        if (!r.data) return errText(r.error);
        notifyFoldersChanged();
        onPick(r.data.id, r.data.name, 'personal');
      }}
    />
  );
}
