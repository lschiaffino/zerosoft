'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useCollapsedBranch, useShellBranch } from '@/components/app/useShellBranch';
import FolderRail from '@/components/ui/FolderRail';
import type { LineFolderDto } from '@/lib/groups-lines';
import { menuPlace } from '@/lib/menu-place';
import { canMoveFolder, childrenMap, depthOf, flattenTree, MAX_FOLDER_DEPTH } from '@/lib/inbox/folder-tree';
import { Modal, api, useErrorText } from './ui';
import { FOLDERS_CHANGED, notifyFoldersChanged, type LineFoldersResponse } from './LineFolders';
import { ASSISTANT_APPLIED_EVENT } from '@/components/assistant/client';
import { FolderIcon, GroupIcon } from './wa/icons';

type FolderDto = LineFolderDto;
type FolderData = LineFoldersResponse;

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
 * Inbox (InboxBranch), en dos secciones. "Equipo": las carpetas del workspace,
 * que ve todo el mundo y administran los admins (los demás las abren y les
 * sueltan chats, sin menú ni arrastre para ordenarlas). "Mías": las de la
 * persona, que nadie más ve. Sin carpetas del equipo y sin ser admin, solo
 * están las suyas, sin títulos.
 *
 * Subcarpetas que se pliegan, no leídos que suben a los padres, la abierta
 * marcada y un menú por carpeta (subcarpeta, renombrar, subir, bajar, mover,
 * borrar). Las carpetas se arrastran para ordenarlas o meterlas en otra de su
 * misma sección; los chats de la lista se sueltan encima de cualquiera (cada
 * fila es un destino `data-chat-drop` de components/ui/chat-gestures.tsx, que
 * la marca y mueve los chats). Con el teclado: Alt+↑/↓ ordena, Alt+→ mete en
 * la de arriba, Alt+← saca un nivel, F2 renombra. La carpeta abierta va en la
 * URL (?folder=). Con el sidebar colapsado o en el teléfono la bandeja ofrece
 * un selector en su lugar.
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
  const rail = useCollapsedBranch();
  const [data, setData] = useState<FolderData | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<{ parentId: string | null; name: string; team: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<FolderDto | null>(null);
  const [moving, setMoving] = useState<FolderDto | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  // El menú va fuera de la barra lateral (que recorta lo que se sale) y fijo junto a su botón.
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  const menuBox = useRef<HTMLUListElement | null>(null);
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!menu) return setMenuAt(null);
    const btn = menuBtn.current?.getBoundingClientRect();
    const box = menuBox.current?.getBoundingClientRect();
    if (!btn || !box) return;
    setMenuAt(menuPlace(btn, box.width, box.height, window.innerWidth, window.innerHeight));
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    // Al mover la página o cambiar el tamaño el botón ya no está donde estaba: se cierra.
    const close = (e: Event) => {
      if (e.type === 'scroll' && menuBox.current?.contains(e.target as Node | null)) return;
      setMenu(null);
    };
    // Un clic afuera lo cierra (no depende del foco: un clic en algo que no se enfoca no lo mueve).
    const outside = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (menuBox.current?.contains(t) || menuBtn.current?.contains(t)) return;
      setMenu(null);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [menu]);
  // Ya ubicado (antes estaba oculto y no se podía enfocar): el foco va a la primera opción.
  useEffect(() => {
    if (menuAt) menuBox.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [menuAt]);
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
    window.addEventListener(ASSISTANT_APPLIED_EVENT, run);
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(onVisible, 30_000);
    return () => {
      window.removeEventListener(FOLDERS_CHANGED, run);
      window.removeEventListener(ASSISTANT_APPLIED_EVENT, run);
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
    const r = await api<{ id: string; parentId: string | null }>('/api/groups/folders', {
      body: { name: creating.name, parentId: creating.parentId, ...(creating.team ? { team: true } : {}) },
    });
    setBusy(false);
    if (!r.data) return fail(r.error);
    if (creating.parentId) toggle(creating.parentId, true);
    setCreating(null);
    setError('');
    notifyFoldersChanged();
    router.push(hrefOf(r.data.id));
  };

  const team = data?.team ?? [];
  const mine = data?.folders ?? [];
  const canManageTeam = !!data?.canManageTeam;
  const teamIds = new Set(team.map((f) => f.id));
  const isTeam = (f: FolderDto | null | undefined) => !!f && teamIds.has(f.id);

  if (!slot && rail && data) {
    const railRow = ({ folder: f, depth }: { folder: FolderDto; depth: number }) => ({
      id: f.id,
      name: f.name,
      href: selected === f.id ? base : hrefOf(f.id),
      active: selected === f.id,
      unread: f.unread,
      depth,
    });
    return createPortal(
      <FolderRail
        label={tl('folders')}
        unreadLabel={(n, name) => `${name}: ${tl('folderUnread', { n })}`}
        folders={[...flattenTree(team).map(railRow), ...flattenTree(mine).map(railRow)]}
      />,
      rail,
    );
  }
  if (!slot || !data) return null;

  /** Lo que se hace con una carpeta depende de su sección: se ordena y se mueve solo entre las de su misma lista. */
  const listOf = (f: FolderDto) => (isTeam(f) ? team : mine);
  const canEdit = (f: FolderDto) => !isTeam(f) || canManageTeam;
  const kidsTeam = childrenMap(team);
  const kidsMine = childrenMap(mine);
  const siblingsOf = (f: FolderDto) => {
    const list = listOf(f);
    const kids = isTeam(f) ? kidsTeam : kidsMine;
    return kids.get(f.parentId && list.some((x) => x.id === f.parentId) ? f.parentId : null) ?? [];
  };
  const nextSibling = (f: FolderDto) => {
    const s = siblingsOf(f);
    return s[s.indexOf(f) + 1] ?? null;
  };
  const byId = new Map([...team, ...mine].map((f) => [f.id, f]));

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
    if (prev && canMoveFolder(listOf(f), f.id, prev.id) === 'ok') void move(f, prev.id, null);
  };
  const outdent = (f: FolderDto) => {
    const parent = f.parentId ? byId.get(f.parentId) : null;
    if (parent) void move(f, parent.parentId, nextSibling(parent)?.id ?? null);
  };

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
    const dragged = byId.get(id);
    // Una carpeta no cambia de sección: una del equipo no pasa a ser personal ni al revés.
    if (!dragged || isTeam(dragged) !== isTeam(f) || !canEdit(f)) return;
    const zone = zoneFor(e);
    const parent = zone === 'inside' ? f.id : f.parentId;
    if (canMoveFolder(listOf(f), id, parent) !== 'ok') {
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
    if (!dragged || dragged.id === f.id || isTeam(dragged) !== isTeam(f)) return;
    if (zone === 'inside') void move(dragged, f.id, null);
    else if (zone === 'before') void move(dragged, f.parentId, f.id);
    else void move(dragged, f.parentId, nextSibling(f)?.id === dragged.id ? (nextSibling(dragged)?.id ?? null) : (nextSibling(f)?.id ?? null));
  };

  const linkKeys = (e: KeyboardEvent<HTMLAnchorElement>, f: FolderDto, hasChildren: boolean) => {
    const editable = canEdit(f);
    if (editable && e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      moveUp(f);
    } else if (editable && e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      moveDown(f);
    } else if (editable && e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      indent(f);
    } else if (editable && e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      outdent(f);
    } else if (!e.altKey && e.key === 'ArrowRight' && hasChildren && collapsed.has(f.id)) {
      e.preventDefault();
      toggle(f.id, true);
    } else if (!e.altKey && e.key === 'ArrowLeft' && hasChildren && !collapsed.has(f.id)) {
      e.preventDefault();
      toggle(f.id, false);
    } else if (editable && e.key === 'F2') {
      e.preventDefault();
      setRenaming(f.id);
    }
  };

  const menuItems = (f: FolderDto): Array<{ key: string; run: () => void; disabled?: boolean; danger?: boolean }> => {
    const s = siblingsOf(f);
    const i = s.indexOf(f);
    return [
      { key: 'newSub', run: () => setCreating({ parentId: f.id, name: '', team: isTeam(f) }), disabled: depthOf(listOf(f), f.id) + 1 > MAX_FOLDER_DEPTH },
      { key: 'rename', run: () => setRenaming(f.id) },
      { key: 'moveUp', run: () => moveUp(f), disabled: i <= 0 },
      { key: 'moveDown', run: () => moveDown(f), disabled: i < 0 || i >= s.length - 1 },
      { key: 'moveTo', run: () => setMoving(f) },
      { key: 'delete', run: () => setDeleting(f), danger: true },
    ];
  };

  const renderRow = ({ folder: f, depth, hasChildren }: { folder: FolderDto; depth: number; hasChildren: boolean }, kind: 'team' | 'personal') => {
    const active = selected === f.id;
    const href = active ? base : hrefOf(f.id);
    const open = hasChildren && !collapsed.has(f.id);
    const shown = f.unread;
    const editable = kind === 'personal' || canManageTeam;
    const dropCls = drop?.id === f.id ? ` drop drop-${drop.zone}` : '';
    return (
      <li
        key={f.id}
        data-folder={f.id}
        data-folder-kind={kind}
        data-chat-drop={f.id}
        data-chat-drop-scope="lines"
        data-chat-drop-name={f.name}
        className={`docs-tree-row${active ? ' active' : ''}${dropCls}`}
        style={{ ['--d' as string]: depth }}
        draggable={editable && renaming !== f.id}
        onDragStart={(e) => {
          if (!editable) return;
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
          <Link
            href={href}
            prefetch={false}
            className="docs-tree-link"
            data-testid={kind === 'team' ? 'lines-team-folder' : 'lines-folder'}
            aria-current={active ? 'page' : undefined}
            draggable={false}
            onKeyDown={(e) => linkKeys(e, f, hasChildren)}
          >
            <span className="docs-tree-icon" aria-hidden="true">
              <span className={`grf-swatch${kind === 'team' ? ' grf-swatch-team' : ''}`} />
            </span>
            <span className="docs-tree-title">{f.name}</span>
            {shown > 0 && (
              <span className="grf-branch-count" aria-label={tl('folderUnread', { n: shown })}>
                {shown > 99 ? '99+' : shown}
              </span>
            )}
          </Link>
        )}
        {renaming !== f.id && editable && (
          <span className="grf-ftree-actions" data-chat-drop-hide>
            <button
              type="button"
              className="grf-ftree-btn"
              aria-label={t('actionsFor', { name: f.name })}
              aria-haspopup="menu"
              aria-expanded={menu === f.id}
              onClick={(e) => {
                menuBtn.current = e.currentTarget;
                setMenu((m) => (m === f.id ? null : f.id));
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </button>
            {menu === f.id &&
              createPortal(
                <ul
                  ref={menuBox}
                  className="grf-menu grf-ftree-menu"
                  data-testid="lines-folder-menu"
                  // El clic en una opción no le saca el foco al menú antes de tiempo (Safari no enfoca botones al hacer clic).
                  onMouseDown={(e) => e.preventDefault()}
                  style={menuAt ? { top: menuAt.top, left: menuAt.left } : { top: 0, left: 0, visibility: 'hidden' }}
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
                    const to = e.relatedTarget as Node | null;
                    if (!e.currentTarget.contains(to) && !menuBtn.current?.contains(to)) setMenu(null);
                  }}
                >
                  {menuItems(f).map((it) => (
                    <li key={it.key} role="none">
                      <button
                        type="button"
                        role="menuitem"
                        className={`grf-menu-item${it.danger ? ' grf-danger' : ''}`}
                        disabled={it.disabled}
                        onClick={() => {
                          setMenu(null);
                          it.run();
                        }}
                      >
                        {t(`menu.${it.key}`)}
                      </button>
                    </li>
                  ))}
                </ul>,
                document.body,
              )}
          </span>
        )}
      </li>
    );
  };

  const anyFolders = team.length > 0 || mine.length > 0;
  // La sección del equipo está si hay carpetas del equipo o si quien mira puede crearlas; sin ella, las suyas van sin título.
  const showTeam = team.length > 0 || canManageTeam;
  const deletingTeam = isTeam(deleting);
  const movingTeam = isTeam(moving);

  return createPortal(
    <nav ref={navRef} className="docs-branch grf-branch" aria-label={tl('folders')} data-testid="lines-folders" data-chat-drop-zone="lines">
      {anyFolders && (
        <ul className="docs-tree grf-ftree" role="list" aria-label={tl('unfiled')}>
          {/* "Sin carpeta" arriba, antes de la primera carpeta: se filtran los sueltos (ni en una suya ni en una del equipo) y se arrastran a las carpetas de abajo. */}
          <li className={`docs-tree-row${selected === 'none' ? ' active' : ''}`} data-chat-drop="none" data-chat-drop-scope="lines" data-chat-drop-name={tl('unfiled')} data-testid="lines-nofolder">
            <span className="docs-tree-chevron-spacer" aria-hidden="true" />
            <Link
              href={selected === 'none' ? base : hrefOf('none')}
              prefetch={false}
              className="docs-tree-link"
              aria-current={selected === 'none' ? 'page' : undefined}
              title={tl('unfiledHint')}
            >
              <span className="docs-tree-icon" aria-hidden="true">
                <FolderIcon size={15} />
              </span>
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
      {showTeam && (
        <section className="grf-sec" aria-label={t('teamLabel')} data-testid="lines-team-folders">
          <p className="grf-sec-head" title={tl('teamFoldersHelp')}>
            <GroupIcon size={14} />
            <span>{tl('teamFolders')}</span>
          </p>
          {team.length > 0 ? (
            <ul className="docs-tree grf-ftree" role="list" aria-label={t('teamLabel')}>
              {flattenTree(team, collapsed).map((r) => renderRow(r, 'team'))}
            </ul>
          ) : (
            <p className="docs-sidebar-empty">{t('teamEmpty')}</p>
          )}
          {canManageTeam && (
            <button type="button" className="grf-branch-new" onClick={() => setCreating({ parentId: null, name: '', team: true })} data-testid="lines-team-folder-new">
              + {t('newTeam')}
            </button>
          )}
        </section>
      )}
      <section className="grf-sec" aria-label={t('mineLabel')} data-testid="lines-my-folders">
        {showTeam && (
          <p className="grf-sec-head">
            <FolderIcon size={14} />
            <span>{tl('myFolders')}</span>
          </p>
        )}
        {mine.length === 0 ? (
          <p className="docs-sidebar-empty">{t('branchEmpty')}</p>
        ) : (
          <ul className="docs-tree grf-ftree" role="list" aria-label={showTeam ? t('mineLabel') : tl('folders')}>
            {flattenTree(mine, collapsed).map((r) => renderRow(r, 'personal'))}
          </ul>
        )}
        <button type="button" className="grf-branch-new" onClick={() => setCreating({ parentId: null, name: '', team: false })} data-testid="lines-folder-new">
          + {t('new')}
        </button>
      </section>
      {error && (
        <p className="ui-error grf-ftree-error" role="alert">
          {error}
        </p>
      )}
      <Modal
        open={creating !== null}
        title={creating?.team ? (creating.parentId ? tl('newTeamSubfolder') : tl('newTeamFolder')) : creating?.parentId ? tl('newSubfolder') : tl('newFolder')}
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
          {creating?.team && <p className="ui-help">{tl('teamFoldersHelp')}</p>}
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
        body={deletingTeam ? tl('deleteTeamFolderBody') : tl('deleteFolderBody')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        danger
        onConfirm={() => deleting && void remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
      <MoveFolderDialog
        folder={moving}
        folders={movingTeam ? team : mine}
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

/** "Mover a…": elegir la carpeta padre con el teclado (o primer nivel), entre las de su misma sección. */
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
