'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useShellBranch } from '@/components/app/useShellBranch';
import type { LineFolderDto } from '@/lib/groups-lines';
import { canMoveFolder, childrenMap, depthOf, flattenTree, MAX_FOLDER_DEPTH } from '@/lib/inbox/folder-tree';
import { Modal, api, useErrorText } from './ui';
import { FOLDERS_CHANGED, notifyFoldersChanged } from './LineFolders';

type FolderDto = LineFolderDto;
interface FolderData {
  folders: LineFolderDto[];
  unfiled: { unread: number; chats: number };
}

const FOLDER_MIME = 'application/x-zs-lines-folder';
const COLLAPSED_KEY = 'zs-lines-folders-collapsed';

type Zone = 'before' | 'inside' | 'after';

function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Carpetas de Lines en el sidebar, debajo de "Bandeja": el mismo árbol que
 * Inbox (InboxBranch). Subcarpetas que se pliegan, no leídos que suben a los
 * padres, la abierta marcada y un menú por carpeta (subcarpeta, renombrar,
 * subir, bajar, mover, borrar). Las carpetas se arrastran para ordenarlas o
 * meterlas en otra; los chats de la lista se sueltan encima (cada fila es un
 * destino `data-chat-drop` de components/ui/chat-gestures.tsx, que la marca
 * y mueve los chats). Con el teclado:
 * Alt+↑/↓ ordena, Alt+→ mete en la de arriba, Alt+← saca un nivel, F2
 * renombra. La carpeta abierta va en la URL (?folder=). Con el sidebar
 * colapsado o en el teléfono la bandeja ofrece un selector en su lugar.
 */
export default function GroupsFoldersBranch() {
  const t = useTranslations('groups.lines.branch');
  const tl = useTranslations('groups.lines');
  const tc = useTranslations('groups.common');
  const errText = useErrorText();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const slot = useShellBranch();
  const [data, setData] = useState<FolderData | null>(null);
  const folders = data?.folders ?? null;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<{ parentId: string | null; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<FolderDto | null>(null);
  const [moving, setMoving] = useState<FolderDto | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; zone: Zone } | null>(null);
  const [error, setError] = useState('');
  const dragId = useRef<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const inInbox = pathname.startsWith('/app/lines/inbox');
  const selected = inInbox ? (params.get('folder') ?? '') : '';
  const base = inInbox ? pathname : '/app/lines/inbox';
  const hrefOf = (id: string) => `${base}?folder=${id}`;

  const load = useCallback(async () => {
    const r = await api<FolderData>('/api/groups/folders');
    if (r.data) setData(r.data);
  }, []);

  useEffect(() => {
    setCollapsed(readCollapsed());
  }, []);

  useEffect(() => {
    const run = () => void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    run();
    window.addEventListener(FOLDERS_CHANGED, run);
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(onVisible, 30_000);
    return () => {
      window.removeEventListener(FOLDERS_CHANGED, run);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, [load]);

  const toggle = (id: string, open?: boolean) => {
    setCollapsed((c) => {
      const n = new Set(c);
      const willOpen = open ?? n.has(id);
      if (willOpen) n.delete(id);
      else n.add(id);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...n]));
      } catch {
        /* sin almacenamiento: solo dura la sesión */
      }
      return n;
    });
  };

  const focusFolder = (id: string) => requestAnimationFrame(() => navRef.current?.querySelector<HTMLElement>(`[data-folder="${id}"] .docs-tree-link`)?.focus());

  const fail = (code?: string) => setError(errText(code));

  const move = async (f: FolderDto, parentId: string | null, before: string | null) => {
    setError('');
    const r = await api<FolderData>('/api/groups/folders', { method: 'PATCH', body: { id: f.id, parentId, beforeId: before } });
    if (!r.data) return fail(r.error);
    setData(r.data);
    if (parentId) toggle(parentId, true);
    notifyFoldersChanged();
    focusFolder(f.id);
  };

  const rename = async (f: FolderDto, name: string) => {
    setRenaming(null);
    const clean = name.trim();
    if (!clean || clean === f.name) return;
    const r = await api<FolderData>('/api/groups/folders', { method: 'PATCH', body: { id: f.id, name: clean } });
    if (!r.data) return fail(r.error);
    setData(r.data);
    notifyFoldersChanged();
    focusFolder(f.id);
  };

  const remove = async (f: FolderDto) => {
    setDeleting(null);
    const r = await api(`/api/groups/folders?id=${encodeURIComponent(f.id)}`, { method: 'DELETE' });
    if (!r.data) return fail(r.error);
    if (selected === f.id) router.push(base);
    notifyFoldersChanged();
  };

  const create = async () => {
    if (!creating || !creating.name.trim()) return;
    setBusy(true);
    const r = await api<{ id: string; parentId: string | null }>('/api/groups/folders', { body: { name: creating.name, parentId: creating.parentId } });
    setBusy(false);
    if (!r.data) return fail(r.error);
    if (creating.parentId) toggle(creating.parentId, true);
    setCreating(null);
    setError('');
    notifyFoldersChanged();
    router.push(hrefOf(r.data.id));
  };

  if (!slot || !data || !folders) return null;

  const kids = childrenMap(folders);
  const siblingsOf = (f: FolderDto) => kids.get(f.parentId && folders.some((x) => x.id === f.parentId) ? f.parentId : null) ?? [];
  const nextSibling = (f: FolderDto) => {
    const s = siblingsOf(f);
    return s[s.indexOf(f) + 1] ?? null;
  };
  const byId = new Map(folders.map((f) => [f.id, f]));

  const moveUp = (f: FolderDto) => {
    const s = siblingsOf(f);
    const i = s.indexOf(f);
    if (i > 0) void move(f, f.parentId, s[i - 1].id);
  };
  const moveDown = (f: FolderDto) => {
    const s = siblingsOf(f);
    const i = s.indexOf(f);
    if (i >= 0 && i < s.length - 1) void move(f, f.parentId, s[i + 2]?.id ?? null);
  };
  const indent = (f: FolderDto) => {
    const s = siblingsOf(f);
    const prev = s[s.indexOf(f) - 1];
    if (prev && canMoveFolder(folders, f.id, prev.id) === 'ok') void move(f, prev.id, null);
  };
  const outdent = (f: FolderDto) => {
    const parent = f.parentId ? byId.get(f.parentId) : null;
    if (parent) void move(f, parent.parentId, nextSibling(parent)?.id ?? null);
  };

  const rows = flattenTree(folders, collapsed);

  const zoneFor = (e: DragEvent<HTMLElement>): Zone => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    if (y < r.height * 0.28) return 'before';
    if (y > r.height * 0.72) return 'after';
    return 'inside';
  };

  const onDragOver = (e: DragEvent<HTMLLIElement>, f: FolderDto) => {
    const types = Array.from(e.dataTransfer.types);
    const id = dragId.current;
    if (!id || !types.includes(FOLDER_MIME) || id === f.id) return;
    const zone = zoneFor(e);
    const parent = zone === 'inside' ? f.id : f.parentId;
    if (canMoveFolder(folders, id, parent) !== 'ok') {
      if (drop) setDrop(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (drop?.id !== f.id || drop.zone !== zone) setDrop({ id: f.id, zone });
  };

  const onDrop = (e: DragEvent<HTMLLIElement>, f: FolderDto) => {
    e.preventDefault();
    const zone = drop?.zone ?? 'inside';
    setDrop(null);
    const id = dragId.current;
    dragId.current = null;
    const dragged = id ? byId.get(id) : null;
    if (!dragged || dragged.id === f.id) return;
    if (zone === 'inside') void move(dragged, f.id, null);
    else if (zone === 'before') void move(dragged, f.parentId, f.id);
    else void move(dragged, f.parentId, nextSibling(f)?.id === dragged.id ? (nextSibling(dragged)?.id ?? null) : (nextSibling(f)?.id ?? null));
  };

  const linkKeys = (e: KeyboardEvent<HTMLAnchorElement>, f: FolderDto, hasChildren: boolean) => {
    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      moveUp(f);
    } else if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      moveDown(f);
    } else if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      indent(f);
    } else if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      outdent(f);
    } else if (!e.altKey && e.key === 'ArrowRight' && hasChildren && collapsed.has(f.id)) {
      e.preventDefault();
      toggle(f.id, true);
    } else if (!e.altKey && e.key === 'ArrowLeft' && hasChildren && !collapsed.has(f.id)) {
      e.preventDefault();
      toggle(f.id, false);
    } else if (e.key === 'F2') {
      e.preventDefault();
      setRenaming(f.id);
    }
  };

  const menuItems = (f: FolderDto): Array<{ key: string; run: () => void; disabled?: boolean; danger?: boolean }> => {
    const s = siblingsOf(f);
    const i = s.indexOf(f);
    return [
      { key: 'newSub', run: () => setCreating({ parentId: f.id, name: '' }), disabled: depthOf(folders, f.id) + 1 > MAX_FOLDER_DEPTH },
      { key: 'rename', run: () => setRenaming(f.id) },
      { key: 'moveUp', run: () => moveUp(f), disabled: i <= 0 },
      { key: 'moveDown', run: () => moveDown(f), disabled: i < 0 || i >= s.length - 1 },
      { key: 'moveTo', run: () => setMoving(f) },
      { key: 'delete', run: () => setDeleting(f), danger: true },
    ];
  };

  return createPortal(
    <nav ref={navRef} className="docs-branch grf-branch" aria-label={tl('folders')} data-testid="lines-folders" data-chat-drop-zone="lines">
      {folders.length === 0 ? (
        <p className="docs-sidebar-empty">{t('branchEmpty')}</p>
      ) : (
        <ul className="docs-tree grf-ftree" role="list" aria-label={tl('folders')}>
          {rows.map(({ folder: f, depth, hasChildren }) => {
            const active = selected === f.id;
            const href = active ? base : hrefOf(f.id);
            const open = hasChildren && !collapsed.has(f.id);
            const shown = f.unread;
            const dropCls = drop?.id === f.id ? ` drop drop-${drop.zone}` : '';
            return (
              <li
                key={f.id}
                data-folder={f.id}
                data-chat-drop={f.id}
                data-chat-drop-scope="lines"
                data-chat-drop-name={f.name}
                className={`docs-tree-row${active ? ' active' : ''}${dropCls}`}
                style={{ ['--d' as string]: depth }}
                draggable={renaming !== f.id}
                onDragStart={(e) => {
                  dragId.current = f.id;
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData(FOLDER_MIME, f.id);
                  e.dataTransfer.setData('text/plain', f.name);
                }}
                onDragEnd={() => {
                  dragId.current = null;
                  setDrop(null);
                }}
                onDragOver={(e) => onDragOver(e, f)}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null) && drop?.id === f.id) setDrop(null);
                }}
                onDrop={(e) => onDrop(e, f)}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    className={`grf-ftree-chevron${open ? ' open' : ''}`}
                    aria-expanded={open}
                    data-chat-drop-expand
                    aria-label={open ? t('collapse', { name: f.name }) : t('expand', { name: f.name })}
                    onClick={() => toggle(f.id)}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                      <path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  </button>
                ) : (
                  <span className="docs-tree-chevron-spacer" aria-hidden="true" />
                )}
                {renaming === f.id ? (
                  <input
                    className="input grf-ftree-rename"
                    aria-label={t('renameLabel', { name: f.name })}
                    defaultValue={f.name}
                    maxLength={60}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void rename(f, e.currentTarget.value);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        setRenaming(null);
                        focusFolder(f.id);
                      }
                    }}
                    onBlur={(e) => void rename(f, e.currentTarget.value)}
                  />
                ) : (
                  <Link href={href} className="docs-tree-link" data-testid="lines-folder" aria-current={active ? 'page' : undefined} draggable={false} onKeyDown={(e) => linkKeys(e, f, hasChildren)}>
                    <span className="docs-tree-icon" aria-hidden="true">
                      <span className="grf-swatch" style={{ background: 'var(--c-groups)' }} />
                    </span>
                    <span className="docs-tree-title">{f.name}</span>
                    {shown > 0 && (
                      <span className="grf-branch-count" aria-label={tl('folderUnread', { n: shown })}>
                        {shown > 99 ? '99+' : shown}
                      </span>
                    )}
                  </Link>
                )}
                {renaming !== f.id && (
                  <span className="grf-ftree-actions" data-chat-drop-hide>
                    <button
                      type="button"
                      className="grf-ftree-btn"
                      aria-label={t('actionsFor', { name: f.name })}
                      aria-haspopup="menu"
                      aria-expanded={menu === f.id}
                      onClick={() => setMenu((m) => (m === f.id ? null : f.id))}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <circle cx="5" cy="12" r="1.8" />
                        <circle cx="12" cy="12" r="1.8" />
                        <circle cx="19" cy="12" r="1.8" />
                      </svg>
                    </button>
                    {menu === f.id && (
                      <ul
                        className="grf-menu grf-ftree-menu"
                        role="menu"
                        aria-label={t('actionsFor', { name: f.name })}
                        onKeyDown={(e) => {
                          const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
                          const i = items.indexOf(document.activeElement as HTMLButtonElement);
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            e.stopPropagation();
                            setMenu(null);
                            focusFolder(f.id);
                          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                            e.preventDefault();
                            items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
                          }
                        }}
                        onBlur={(e) => {
                          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) setMenu(null);
                        }}
                      >
                        {menuItems(f).map((it, i) => (
                          <li key={it.key} role="none">
                            <button
                              type="button"
                              role="menuitem"
                              className={`grf-menu-item${it.danger ? ' grf-danger' : ''}`}
                              disabled={it.disabled}
                              autoFocus={i === 0}
                              onClick={() => {
                                setMenu(null);
                                it.run();
                              }}
                            >
                              {t(`menu.${it.key}`)}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </span>
                )}
              </li>
            );
          })}
          <li className={`docs-tree-row${selected === 'none' ? ' active' : ''}`} data-chat-drop="none" data-chat-drop-scope="lines" data-chat-drop-name={tl('unfiled')}>
            <span className="docs-tree-chevron-spacer" aria-hidden="true" />
            <Link href={selected === 'none' ? base : hrefOf('none')} className="docs-tree-link" aria-current={selected === 'none' ? 'page' : undefined}>
              <span className="docs-tree-title">{tl('unfiled')}</span>
              {data.unfiled.unread > 0 && (
                <span className="grf-branch-count" aria-label={tl('folderUnread', { n: data.unfiled.unread })}>
                  {data.unfiled.unread > 99 ? '99+' : data.unfiled.unread}
                </span>
              )}
            </Link>
          </li>
        </ul>
      )}
      {error && (
        <p className="ui-error grf-ftree-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="grf-branch-new" onClick={() => setCreating({ parentId: null, name: '' })} data-testid="lines-folder-new">
        + {t('new')}
      </button>
      <Modal
        open={creating !== null}
        title={creating?.parentId ? tl('newSubfolder') : tl('newFolder')}
        onClose={() => setCreating(null)}
        onSubmit={() => void create()}
        busy={busy}
        foot={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setCreating(null)}>
              {tc('cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={!creating?.name.trim()} aria-busy={busy || undefined}>
              {tc('save')}
            </button>
          </>
        }
      >
        <div className="ui-fields">
          <label className="ui-field">
            <span className="label">{tl('folderName')}</span>
            <input className="input" value={creating?.name ?? ''} onChange={(e) => setCreating((s) => (s ? { ...s, name: e.target.value } : s))} maxLength={60} autoFocus required />
          </label>
          {error && creating && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={deleting !== null}
        title={tl('deleteFolderTitle', { name: deleting?.name ?? '' })}
        body={tl('deleteFolderBody')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        danger
        onConfirm={() => deleting && void remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
      <MoveFolderDialog
        folder={moving}
        folders={folders}
        onClose={() => setMoving(null)}
        onPick={(parentId) => {
          const f = moving;
          setMoving(null);
          if (f) void move(f, parentId, null);
        }}
      />
    </nav>,
    slot,
  );
}

/** "Mover a…": elegir la carpeta padre con el teclado (o primer nivel). */
function MoveFolderDialog({ folder, folders, onClose, onPick }: { folder: FolderDto | null; folders: FolderDto[]; onClose: () => void; onPick: (parentId: string | null) => void }) {
  const t = useTranslations('groups.lines.branch');
  const tc = useTranslations('groups.common');
  const [q, setQ] = useState('');
  useEffect(() => {
    if (folder) setQ('');
  }, [folder]);
  const needle = q.trim().toLowerCase();
  const options = folder
    ? flattenTree(folders).filter(({ folder: f }) => f.id !== folder.id && canMoveFolder(folders, folder.id, f.id) === 'ok' && f.name.toLowerCase().includes(needle))
    : [];
  const pick = (id: string | null) => {
    if (folder && id === (folder.parentId ?? null)) onClose();
    else onPick(id);
  };
  return (
    <Modal
      open={folder !== null}
      title={t('moveTitle', { name: folder?.name ?? '' })}
      onClose={onClose}
      foot={
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {tc('cancel')}
        </button>
      }
    >
      <label className="sr-only" htmlFor="grf-fmove-q">
        {t('moveFilter')}
      </label>
      <input
        id="grf-fmove-q"
        className="input"
        autoFocus
        placeholder={t('moveFilter')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (needle && options[0]) pick(options[0].folder.id);
            else if (!needle) pick(null);
          }
        }}
      />
      <ul className="grf-pick-list">
        {!needle && (
          <li>
            <button type="button" className="grf-pick" onClick={() => pick(null)} aria-pressed={folder?.parentId === null}>
              <span className="grf-pick-name">{t('topLevel')}</span>
            </button>
          </li>
        )}
        {options.map(({ folder: f, depth }) => (
          <li key={f.id}>
            <button type="button" className="grf-pick" style={{ paddingLeft: 10 + (needle ? 0 : depth) * 16 }} onClick={() => pick(f.id)} aria-pressed={folder?.parentId === f.id}>
              <span className="grf-pick-name">{f.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
