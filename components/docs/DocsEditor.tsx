'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import {
  defaultBlocks,
  type DocsBlock,
  type DocsBlockType,
  type DocsPage,
  stringifyBlocks,
} from '@/lib/docs-types';
import DocsBlockEditor from './DocsBlockEditor';
import MentionPopover from './MentionPopover';
import EmojiPicker from './EmojiPicker';

interface DocsEditorProps {
  page: DocsPage;
  ancestors: DocsPage[];
  onSave: (page: DocsPage) => void;
  saving?: boolean;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

const BLOCK_COMMANDS: {
  key: string;
  label: string;
  type: DocsBlockType;
  level?: 1 | 2 | 3;
  shortcut?: string;
}[] = [
  { key: 'p', label: 'Text', type: 'paragraph', shortcut: 'plain text' },
  { key: 'h1', label: 'Heading 1', type: 'heading', level: 1, shortcut: '# heading' },
  { key: 'h2', label: 'Heading 2', type: 'heading', level: 2, shortcut: '## heading' },
  { key: 'h3', label: 'Heading 3', type: 'heading', level: 3, shortcut: '### heading' },
  { key: 'bulleted', label: 'Bulleted list', type: 'bulleted_list_item', shortcut: '- list' },
  { key: 'numbered', label: 'Numbered list', type: 'numbered_list_item', shortcut: '1. list' },
  { key: 'todo', label: 'To-do', type: 'todo', shortcut: '[ ] todo' },
  { key: 'quote', label: 'Quote', type: 'quote', shortcut: '> quote' },
  { key: 'code', label: 'Code', type: 'code', shortcut: '``` code' },
  { key: 'divider', label: 'Divider', type: 'divider' },
  { key: 'table', label: 'Table', type: 'table' },
];

const BLOCK_ICONS: Record<DocsBlockType, string> = {
  paragraph: 'T',
  heading: 'H',
  bulleted_list_item: '•',
  numbered_list_item: '1.',
  todo: '☐',
  quote: '"',
  code: '</>',
  divider: '—',
  table: '▦',
};

export default function DocsEditor({
  page,
  ancestors,
  onSave,
  saving,
  onDuplicate,
  onDelete,
}: DocsEditorProps) {
  const [blocks, setBlocks] = useState<DocsBlock[]>(
    page.content.length ? page.content : defaultBlocks(),
  );
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon ?? '📄');
  const [coverUrl, setCoverUrl] = useState(page.cover_url ?? '');
  const [smallText, setSmallText] = useState(false);
  const [fullWidth, setFullWidth] = useState(false);
  const [focusIndex, setFocusIndex] = useState<number>(0);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');
  const [cmdSel, setCmdSel] = useState(0);
  const [mention, setMention] = useState<{ index: number; query: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBlocks(page.content.length ? page.content : defaultBlocks());
    setTitle(page.title);
    setIcon(page.icon ?? '📄');
    setCoverUrl(page.cover_url ?? '');
  }, [page.id]);

  useEffect(() => {
    const el = blockRefs.current[focusIndex];
    if (el) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [focusIndex, blocks.length]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [menuOpen]);

  useEffect(() => {
    if (!coverOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!coverRef.current?.contains(e.target as Node)) setCoverOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [coverOpen]);

  const triggerSave = useCallback(
    (
      nextBlocks?: DocsBlock[],
      nextTitle?: string,
      nextIcon?: string,
      nextCover?: string | null,
    ) => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        onSave({
          ...page,
          title: nextTitle ?? title,
          icon: nextIcon ?? icon,
          cover_url: nextCover === '' ? null : (nextCover ?? coverUrl),
          content: nextBlocks ?? blocks,
        });
      }, 600);
    },
    [blocks, coverUrl, icon, onSave, page, title],
  );

  const updateBlock = useCallback(
    (index: number, patch: Partial<DocsBlock>) => {
      setBlocks((prev) => {
        const next = prev.map((b, i) => (i === index ? { ...b, ...patch } : b));
        triggerSave(next);
        return next;
      });
    },
    [triggerSave],
  );

  const insertBlock = useCallback(
    (index: number, type: DocsBlockType, level?: 1 | 2 | 3) => {
      const newBlock: DocsBlock = {
        id: crypto.randomUUID(),
        type,
        content: '',
        level,
      };
      setBlocks((prev) => {
        const next = [...prev.slice(0, index + 1), newBlock, ...prev.slice(index + 1)];
        triggerSave(next);
        return next;
      });
      setCmdOpen(false);
      setCmdQuery('');
      setMention(null);
      setFocusIndex(index + 1);
    },
    [triggerSave],
  );

  const removeBlock = useCallback(
    (index: number) => {
      setBlocks((prev) => {
        if (prev.length <= 1) return prev;
        const next = prev.filter((_, i) => i !== index);
        triggerSave(next);
        return next;
      });
      setFocusIndex(Math.max(0, index - 1));
    },
    [triggerSave],
  );

  const convertBlock = useCallback(
    (index: number, type: DocsBlockType, level?: 1 | 2 | 3) => {
      setBlocks((prev) => {
        const next = prev.map((b, i) => (i === index ? { ...b, type, level, content: '' } : b));
        triggerSave(next);
        return next;
      });
      setCmdOpen(false);
      setCmdQuery('');
      setCmdSel(0);
      setFocusIndex(index);
    },
    [triggerSave],
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLElement>) => {
      const block = blocks[index];
      if (!block) return;

      if (cmdOpen) {
        const filtered = BLOCK_COMMANDS.filter((c) =>
          cmdQuery === '' ? true : c.label.toLowerCase().includes(cmdQuery.toLowerCase()),
        );
        if (e.key === 'Escape') {
          setCmdOpen(false);
          setCmdQuery('');
          setCmdSel(0);
          e.preventDefault();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const match = filtered[cmdSel];
          if (match) convertBlock(index, match.type, match.level);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setCmdSel((s) => (s + 1) % filtered.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setCmdSel((s) => (s - 1 + filtered.length) % filtered.length);
          return;
        }
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        insertBlock(index, 'paragraph');
        return;
      }

      if (e.key === 'Backspace' && block.content === '') {
        e.preventDefault();
        removeBlock(index);
        return;
      }
    },
    [blocks, cmdOpen, cmdQuery, cmdSel, convertBlock, insertBlock, removeBlock],
  );

  const handleInput = useCallback(
    (index: number, text: string) => {
      const block = blocks[index];
      if (!block) return;

      if (text.startsWith('/')) {
        setCmdOpen(true);
        setCmdQuery(text.slice(1));
        setCmdSel(0);
      } else {
        setCmdOpen(false);
        setCmdQuery('');
        setCmdSel(0);
      }

      const mentionMatch = text.match(/\[\[([^\]]*)$/);
      if (mentionMatch) {
        setMention({ index, query: mentionMatch[1] ?? '' });
      } else {
        setMention(null);
      }
    },
    [blocks],
  );

  const handleBlockChange = useCallback(
    (index: number, patch: Partial<DocsBlock>) => {
      updateBlock(index, patch);
      if (patch.content !== undefined) handleInput(index, patch.content);
    },
    [handleInput, updateBlock],
  );

  const onSelectMention = useCallback(
    (selected: DocsPage) => {
      if (!mention) return;
      const index = mention.index;
      setBlocks((prev) => {
        const block = prev[index];
        if (!block) return prev;
        const newContent = block.content.replace(/\[\[([^\]]*)$/, `[${selected.title || 'Untitled'}] `);
        const next = prev.map((b, i) => (i === index ? { ...b, content: newContent } : b));
        triggerSave(next);
        return next;
      });
      setMention(null);
      setFocusIndex(index);
    },
    [mention, triggerSave],
  );

  const filteredCommands = BLOCK_COMMANDS.filter((c) =>
    cmdQuery === '' ? true : c.label.toLowerCase().includes(cmdQuery.toLowerCase()),
  );

  const copyLink = () => {
    const url = `${window.location.origin}/app/docs/${page.id}`;
    navigator.clipboard.writeText(url);
    setMenuOpen(false);
  };

  const copyContents = () => {
    const text = blocks.map((b) => b.content).join('\n');
    navigator.clipboard.writeText(text);
    setMenuOpen(false);
  };

  const archivePage = () => {
    onSave({ ...page, archived: true });
    setMenuOpen(false);
  };

  const addCover = (url: string) => {
    setCoverUrl(url);
    triggerSave(undefined, undefined, undefined, url);
    setCoverOpen(false);
  };

  const removeCover = () => {
    setCoverUrl('');
    triggerSave(undefined, undefined, undefined, null);
  };

  const ancestorChain = ancestors.filter((a) => a.id !== page.id);

  let numberedIndex = 0;

  return (
    <div className={`docs-editor${smallText ? ' docs-editor-small' : ''}${fullWidth ? ' docs-editor-full' : ''}`}>
      <div className="docs-top-bar">
        {ancestorChain.length > 0 && (
          <nav className="docs-breadcrumb">
            <Link href="/app/docs" className="docs-breadcrumb-root">
              Docs
            </Link>
            {ancestorChain.map((a) => (
              <span key={a.id} className="docs-breadcrumb-segment">
                <span className="docs-breadcrumb-slash">/</span>
                <Link href={`/app/docs/${a.id}`} className="docs-breadcrumb-link">
                  <span className="docs-breadcrumb-icon">{a.icon ?? '📄'}</span>
                  <span className="docs-breadcrumb-title">{a.title || 'Untitled'}</span>
                </Link>
              </span>
            ))}
            <span className="docs-breadcrumb-segment">
              <span className="docs-breadcrumb-slash">/</span>
              <span className="docs-breadcrumb-current">{title || 'Untitled'}</span>
            </span>
          </nav>
        )}

        <div className="docs-page-actions">
          <div className="docs-action-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="docs-action-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Page options"
            >
              ···
            </button>
            {menuOpen && (
              <div className="docs-page-menu">
                <button type="button" className="docs-page-menu-item" onClick={copyLink}>
                  Copy link
                </button>
                <button type="button" className="docs-page-menu-item" onClick={copyContents}>
                  Copy page contents
                </button>
                {onDuplicate && (
                  <button type="button" className="docs-page-menu-item" onClick={onDuplicate}>
                    Duplicate
                  </button>
                )}
                <button type="button" className="docs-page-menu-item" onClick={archivePage}>
                  Archive
                </button>
                <hr className="docs-page-menu-divider" />
                <button
                  type="button"
                  className="docs-page-menu-item docs-page-menu-toggle"
                  onClick={() => {
                    setSmallText((v) => !v);
                    setMenuOpen(false);
                  }}
                >
                  Small text
                  <span className={`docs-toggle${smallText ? ' on' : ''}`} />
                </button>
                <button
                  type="button"
                  className="docs-page-menu-item docs-page-menu-toggle"
                  onClick={() => {
                    setFullWidth((v) => !v);
                    setMenuOpen(false);
                  }}
                >
                  Full width
                  <span className={`docs-toggle${fullWidth ? ' on' : ''}`} />
                </button>
                <hr className="docs-page-menu-divider" />
                {onDelete && (
                  <button
                    type="button"
                    className="docs-page-menu-item docs-page-menu-danger"
                    onClick={onDelete}
                  >
                    Move to trash
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {coverUrl ? (
        <div className="docs-cover">
          <img src={coverUrl} alt="" className="docs-cover-img" />
          <button type="button" className="docs-cover-remove" onClick={removeCover}>
            Remove cover
          </button>
        </div>
      ) : (
        <div className="docs-cover-placeholder">
          <button type="button" className="docs-cover-add" onClick={() => setCoverOpen(true)}>
            Add cover
          </button>
          {coverOpen && (
            <div className="docs-cover-popover" ref={coverRef}>
              <input
                type="text"
                placeholder="Paste image URL…"
                className="docs-cover-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addCover((e.target as HTMLInputElement).value);
                }}
              />
              <div className="docs-cover-presets">
                {[
                  'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200&q=80',
                  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200&q=80',
                  'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=1200&q=80',
                  'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=1200&q=80',
                ].map((url) => (
                  <button
                    key={url}
                    type="button"
                    className="docs-cover-preset"
                    style={{ backgroundImage: `url(${url})` }}
                    onClick={() => addCover(url)}
                    aria-label="Cover preset"
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="docs-page-header">
        <EmojiPicker value={icon} onChange={(next) => {
          setIcon(next);
          triggerSave(undefined, undefined, next);
        }}>
          <span className="docs-icon">{icon}</span>
        </EmojiPicker>
        <input
          className="docs-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            triggerSave(undefined, e.target.value);
          }}
          placeholder="Untitled page"
          aria-label="Page title"
        />
      </div>

      <div className="docs-page-meta">
        <button type="button" className="docs-meta-btn">
          Add icon
        </button>
        <button type="button" className="docs-meta-btn" onClick={() => setCoverOpen(true)}>
          Add cover
        </button>
        <button type="button" className="docs-meta-btn">
          Add comment
        </button>
      </div>

      <div className="docs-blocks">
        {blocks.map((block, index) => {
          if (block.type === 'numbered_list_item') numberedIndex++;
          else numberedIndex = 0;
          return (
            <div key={block.id} className="docs-block-outer">
              <DocsBlockEditor
                block={block}
                index={index}
                listIndex={numberedIndex || undefined}
                onChange={handleBlockChange}
                onKeyDown={handleKeyDown}
                onFocus={setFocusIndex}
                focused={focusIndex === index}
                ref={(el) => { blockRefs.current[index] = el; }}
              />
              {cmdOpen && focusIndex === index && (
                <div className="docs-command-menu">
                  <div className="docs-command-title">Basic blocks</div>
                  {filteredCommands.map((cmd, i) => (
                    <button
                      key={cmd.key}
                      type="button"
                      className={`docs-command-item${i === cmdSel ? ' sel' : ''}`}
                      onClick={() => convertBlock(index, cmd.type, cmd.level)}
                    >
                      <span className="docs-command-icon">{BLOCK_ICONS[cmd.type]}</span>
                      <span className="docs-command-label">{cmd.label}</span>
                      {cmd.shortcut && (
                        <span className="docs-command-shortcut">{cmd.shortcut}</span>
                      )}
                    </button>
                  ))}
                  {filteredCommands.length === 0 && (
                    <div className="docs-command-empty">No commands</div>
                  )}
                </div>
              )}
              {mention && focusIndex === index && (
                <MentionPopover
                  query={mention.query}
                  onSelect={onSelectMention}
                  onClose={() => setMention(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="docs-editor-foot">
        <span className="docs-save-status">{saving ? 'Saving…' : 'Saved'}</span>
      </div>
    </div>
  );
}
