'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { buildTagTree, type NotebookInfo, type SavedSearchInfo, type TagInfo } from '@/lib/notes-types';
import NotesIcon from './NotesIcon';
import RowMenu from './RowMenu';
import { groupNotebooks, type NotesFilter } from './notes-ui';

/** Búsquedas guardadas del sidebar (como los Smart Folders de Apple Notes). */
export function SavedSearchesNav({
  searches,
  activeId,
  onPick,
  onRename,
  onUpdate,
  onDelete,
  canUpdate,
}: {
  searches: SavedSearchInfo[];
  activeId: string | null;
  onPick: (s: SavedSearchInfo) => void;
  onRename: (s: SavedSearchInfo) => void;
  onUpdate: (s: SavedSearchInfo) => void;
  onDelete: (s: SavedSearchInfo) => void;
  canUpdate: boolean;
}) {
  const t = useTranslations('notes');
  const [menu, setMenu] = useState<string | null>(null);
  if (!searches.length) return null;
  return (
    <>
      <div className="notes-nav-section">
        <h2>{t('nav.savedSearches')}</h2>
      </div>
      {searches.map((s) => (
        <div key={s.id} className="notes-nav-row">
          <button
            type="button"
            className="notes-nav-item"
            aria-current={activeId === s.id ? 'true' : undefined}
            onClick={() => onPick(s)}
            title={s.query}
          >
            <NotesIcon name="saved" size={14} />
            <span className="notes-nav-name">{s.name}</span>
          </button>
          <RowMenu
            className="notes-nav-menu"
            open={menu === s.id}
            label={t('searches.actions', { name: s.name })}
            onToggle={(o) => setMenu(o ? s.id : null)}
            items={[
              { label: t('searches.rename'), onSelect: () => { setMenu(null); onRename(s); } },
              ...(canUpdate ? [{ label: t('searches.update'), onSelect: () => { setMenu(null); onUpdate(s); } }] : []),
              { label: t('searches.delete'), danger: true, onSelect: () => { setMenu(null); onDelete(s); } },
            ]}
          />
        </div>
      ))}
    </>
  );
}

interface NotebookHandlers {
  isActive: (f: NotesFilter) => boolean;
  onChoose: (f: NotesFilter) => void;
  renaming: string | null;
  onStartRename: (nb: NotebookInfo) => void;
  onRename: (nb: NotebookInfo, name: string) => void;
  onCancelRename: () => void;
  onShare: (nb: NotebookInfo) => void;
  onDelete: (nb: NotebookInfo) => void;
  onMoveToStack: (nb: NotebookInfo) => void;
  onRemoveFromStack: (nb: NotebookInfo) => void;
  onExport: (nb: NotebookInfo) => void;
  onRenameStack: (stack: string) => void;
  onUngroupStack: (stack: string) => void;
}

/** Libretas, agrupadas en pilas plegables como en Evernote. */
export function NotebooksNav({ notebooks, ...h }: { notebooks: NotebookInfo[] } & NotebookHandlers) {
  const t = useTranslations('notes');
  const [menu, setMenu] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const { loose, stacks } = useMemo(() => groupNotebooks(notebooks), [notebooks]);

  const row = (nb: NotebookInfo, nested: boolean) =>
    h.renaming === nb.id ? (
      <input
        key={nb.id}
        className={`input notes-nav-input${nested ? ' is-nested' : ''}`}
        autoFocus
        defaultValue={nb.name}
        aria-label={t('notebooks.renameLabel')}
        maxLength={80}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') h.onRename(nb, e.currentTarget.value);
          if (e.key === 'Escape') h.onCancelRename();
        }}
        onBlur={(e) => h.onRename(nb, e.currentTarget.value)}
      />
    ) : (
      <div key={nb.id} className={`notes-nav-row${nested ? ' is-nested' : ''}`}>
        <button
          type="button"
          className="notes-nav-item"
          aria-current={h.isActive({ kind: 'notebook', id: nb.id }) ? 'true' : undefined}
          onClick={() => h.onChoose({ kind: 'notebook', id: nb.id })}
        >
          <span className="notes-nav-name">{nb.name}</span>
          <span className="notes-count num">{nb.count}</span>
        </button>
        <RowMenu
          className="notes-nav-menu"
          open={menu === nb.id}
          label={`${t('notebooks.actions')}: ${nb.name}`}
          onToggle={(open) => setMenu(open ? nb.id : null)}
          items={[
            { label: t('notebooks.rename'), onSelect: () => { setMenu(null); h.onStartRename(nb); } },
            { label: t('notebooks.share'), onSelect: () => { setMenu(null); h.onShare(nb); } },
            { label: t('stacks.moveTo'), onSelect: () => { setMenu(null); h.onMoveToStack(nb); } },
            ...(nb.stack ? [{ label: t('stacks.remove'), onSelect: () => { setMenu(null); h.onRemoveFromStack(nb); } }] : []),
            { label: t('export.notebook'), onSelect: () => { setMenu(null); h.onExport(nb); } },
            { label: t('notebooks.delete'), danger: true, onSelect: () => { setMenu(null); h.onDelete(nb); } },
          ]}
        />
      </div>
    );

  return (
    <>
      {stacks.map(({ stack, notebooks: list }) => {
        const open = !closed.has(stack);
        const count = list.reduce((n, nb) => n + nb.count, 0);
        const menuKey = `stack:${stack}`;
        return (
          <div key={menuKey} className="notes-stack">
            <div className="notes-nav-row">
              <button
                type="button"
                className="notes-nav-toggle"
                aria-expanded={open}
                aria-label={t('stacks.toggle', { name: stack })}
                onClick={() =>
                  setClosed((cur) => {
                    const next = new Set(cur);
                    if (next.has(stack)) next.delete(stack);
                    else next.add(stack);
                    return next;
                  })
                }
              >
                <span className={`notes-chevron${open ? ' is-open' : ''}`}>
                  <NotesIcon name="chevron" size={12} />
                </span>
              </button>
              <button
                type="button"
                className="notes-nav-item notes-stack-name"
                aria-current={h.isActive({ kind: 'stack', stack }) ? 'true' : undefined}
                onClick={() => h.onChoose({ kind: 'stack', stack })}
              >
                <span className="notes-nav-name">{stack}</span>
                <span className="notes-count num">{count}</span>
              </button>
              <RowMenu
                className="notes-nav-menu"
                open={menu === menuKey}
                label={t('stacks.actions', { name: stack })}
                onToggle={(o) => setMenu(o ? menuKey : null)}
                items={[
                  { label: t('stacks.rename'), onSelect: () => { setMenu(null); h.onRenameStack(stack); } },
                  { label: t('stacks.ungroup'), onSelect: () => { setMenu(null); h.onUngroupStack(stack); } },
                ]}
              />
            </div>
            {open && list.map((nb) => row(nb, true))}
          </div>
        );
      })}
      {loose.map((nb) => row(nb, false))}
    </>
  );
}

/** Etiquetas en árbol ("trabajo/clientes" debajo de "trabajo"), plegables, con renombrar y borrar. */
export function TagsNav({
  tags,
  isActive,
  onChoose,
  onRename,
  onDelete,
}: {
  tags: TagInfo[];
  isActive: (f: NotesFilter) => boolean;
  onChoose: (f: NotesFilter) => void;
  onRename: (tag: string) => void;
  onDelete: (tag: string) => void;
}) {
  const t = useTranslations('notes');
  const [menu, setMenu] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildTagTree(tags), [tags]);
  const hidden = (tag: string) => [...closed].some((c) => tag.startsWith(`${c}/`));
  if (!tree.length) return null;
  return (
    <>
      <div className="notes-nav-section">
        <h2>{t('nav.tags')}</h2>
      </div>
      {tree
        .filter((n) => !hidden(n.tag))
        .map((n) => (
          <div key={n.tag} className="notes-nav-row notes-tag-row" style={{ paddingLeft: n.depth * 14 }}>
            {n.hasChildren ? (
              <button
                type="button"
                className="notes-nav-toggle"
                aria-expanded={!closed.has(n.tag)}
                aria-label={t('tags.toggle', { tag: n.tag })}
                onClick={() =>
                  setClosed((cur) => {
                    const next = new Set(cur);
                    if (next.has(n.tag)) next.delete(n.tag);
                    else next.add(n.tag);
                    return next;
                  })
                }
              >
                <span className={`notes-chevron${!closed.has(n.tag) ? ' is-open' : ''}`}>
                  <NotesIcon name="chevron" size={12} />
                </span>
              </button>
            ) : (
              <span className="notes-nav-toggle-space" aria-hidden="true" />
            )}
            <button
              type="button"
              className="notes-nav-item"
              aria-current={isActive({ kind: 'tag', tag: n.tag }) ? 'true' : undefined}
              onClick={() => onChoose({ kind: 'tag', tag: n.tag })}
              title={`#${n.tag}`}
            >
              <span className="notes-nav-name">
                <span className="notes-hash" aria-hidden="true">
                  #
                </span>
                {n.label}
              </span>
              <span className="notes-count num">{n.count}</span>
            </button>
            <RowMenu
              className="notes-nav-menu"
              open={menu === n.tag}
              label={t('tags.actions', { tag: n.tag })}
              onToggle={(o) => setMenu(o ? n.tag : null)}
              items={[
                { label: t('tags.rename'), onSelect: () => { setMenu(null); onRename(n.tag); } },
                { label: t('tags.delete'), danger: true, onSelect: () => { setMenu(null); onDelete(n.tag); } },
              ]}
            />
          </div>
        ))}
    </>
  );
}
