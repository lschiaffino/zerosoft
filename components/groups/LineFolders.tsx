'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { LineFolderDto } from '@/lib/groups-lines';
import { flattenTree } from '@/lib/inbox/folder-tree';
import MenuSelect from '@/components/ui/MenuSelect';
import { Modal, api, useErrorText } from './ui';
import LineDot from './LineDot';
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
        { value: 'none', label: t('unfiled') },
        ...teamRows.map(({ folder: f, depth }) => ({ value: f.id, label: f.name, depth, hint: depth === 0 ? t('teamFolders') : undefined })),
        ...rows.map(({ folder: f, depth }) => ({ value: f.id, label: f.name, depth })),
      ]}
    />
  );
}

/**
 * "Mover a carpeta" desde el menú de un chat o la barra de selección (alternativa al arrastre, con teclado), en dos
 * secciones: las del equipo (lo que se pone ahí lo ve todo el workspace) y las propias. Quien todavía no tiene
 * ninguna propia crea la primera acá mismo y el chat va a esa. `teamValue` y `value` marcan dónde está ahora (un
 * solo chat).
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
  const rows = useMemo(() => flattenTree(folders), [folders]);
  const teamRows = useMemo(() => flattenTree(team), [team]);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) {
      setName(null);
      setError('');
    }
  }, [open]);
  const create = async () => {
    const clean = (name ?? '').trim();
    if (!clean || busy) return;
    setBusy(true);
    const r = await api<{ id: string; name: string }>('/api/groups/folders', { body: { name: clean } });
    setBusy(false);
    if (!r.data) return setError(errText(r.error));
    notifyFoldersChanged();
    onPick(r.data.id, r.data.name, 'personal');
  };
  const sections = team.length > 0;
  return (
    <Modal
      open={open}
      title={t('moveTitle')}
      onClose={onClose}
      onSubmit={name !== null ? () => void create() : undefined}
      busy={busy}
      foot={
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {tc('cancel')}
        </button>
      }
    >
      {sections && (
        <>
          <p className="gr-folder-sec" id="gr-move-team">
            <GroupIcon size={14} />
            <span>{t('teamFolders')}</span>
          </p>
          <ul className="gr-folder-list gr-folder-pick" aria-labelledby="gr-move-team" data-testid="lines-move-team">
            {teamRows.map(({ folder: f, depth }) => (
              <li key={f.id} style={{ paddingInlineStart: depth * 14 }}>
                <button type="button" className="gr-folder" onClick={() => onPick(f.id, f.name, 'team')} aria-pressed={teamValue === f.id || undefined}>
                  <span className="gr-folder-name">{f.name}</span>
                </button>
              </li>
            ))}
            {teamValue && (
              <li>
                <button type="button" className="gr-folder" onClick={() => onPick(null, undefined, 'team')} data-testid="lines-move-team-none">
                  <span className="gr-folder-name">{t('unfiled')}</span>
                </button>
              </li>
            )}
          </ul>
          <p className="gr-folder-sec" id="gr-move-mine">
            <FolderIcon size={14} />
            <span>{t('myFolders')}</span>
          </p>
        </>
      )}
      {folders.length === 0 && <p className="ui-help">{t('foldersEmpty')}</p>}
      <ul className="gr-folder-list gr-folder-pick" aria-labelledby={sections ? 'gr-move-mine' : undefined} data-testid="lines-move-mine">
        {rows.map(({ folder: f, depth }) => (
          <li key={f.id} style={{ paddingInlineStart: depth * 14 }}>
            <button type="button" className="gr-folder" onClick={() => onPick(f.id, f.name, 'personal')} aria-pressed={value === f.id || undefined}>
              <span className="gr-folder-name">{f.name}</span>
            </button>
          </li>
        ))}
        {folders.length > 0 && (
          <li>
            <button type="button" className="gr-folder" onClick={() => onPick(null, undefined, 'personal')}>
              <span className="gr-folder-name">{t('unfiled')}</span>
            </button>
          </li>
        )}
      </ul>
      {name === null ? (
        <button type="button" className={`btn btn-sm ${folders.length === 0 ? 'btn-primary' : 'btn-ghost'} gr-folder-create`} onClick={() => setName('')} data-testid="lines-move-new-folder">
          + {t('newFolder')}
        </button>
      ) : (
        <div className="gr-folder-new">
          <label className="ui-field">
            <span className="label">{t('folderName')}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus required data-testid="lines-move-new-name" />
          </label>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()} aria-busy={busy || undefined} data-testid="lines-move-new-save">
            {t('createAndMove')}
          </button>
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
