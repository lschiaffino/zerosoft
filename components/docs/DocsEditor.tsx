'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultBlocks,
  type DocsBlock,
  type DocsBlockType,
  type DocsPage,
  stringifyBlocks,
} from '@/lib/docs-types';
import DocsBlockEditor from './DocsBlockEditor';
import MentionPopover from './MentionPopover';

interface DocsEditorProps {
  page: DocsPage;
  onSave: (page: DocsPage) => void;
  saving?: boolean;
}

const BLOCK_COMMANDS: { key: string; label: string; type: DocsBlockType; level?: 1 | 2 | 3 }[] = [
  { key: 'p', label: 'Paragraph', type: 'paragraph' },
  { key: 'h1', label: 'Heading 1', type: 'heading', level: 1 },
  { key: 'h2', label: 'Heading 2', type: 'heading', level: 2 },
  { key: 'h3', label: 'Heading 3', type: 'heading', level: 3 },
  { key: 'bulleted', label: 'Bulleted list', type: 'bulleted_list_item' },
  { key: 'numbered', label: 'Numbered list', type: 'numbered_list_item' },
  { key: 'todo', label: 'To-do', type: 'todo' },
  { key: 'quote', label: 'Quote', type: 'quote' },
  { key: 'code', label: 'Code', type: 'code' },
  { key: 'divider', label: 'Divider', type: 'divider' },
  { key: 'table', label: 'Table', type: 'table' },
];

export default function DocsEditor({ page, onSave, saving }: DocsEditorProps) {
  const [blocks, setBlocks] = useState<DocsBlock[]>(
    page.content.length ? page.content : defaultBlocks(),
  );
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon ?? '📄');
  const [focusIndex, setFocusIndex] = useState<number>(0);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');
  const [cmdSel, setCmdSel] = useState(0);
  const [mention, setMention] = useState<{ index: number; query: string } | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    setBlocks(page.content.length ? page.content : defaultBlocks());
    setTitle(page.title);
    setIcon(page.icon ?? '📄');
  }, [page.id]);

  useEffect(() => {
    const el = blockRefs.current[focusIndex];
    if (el) {
      el.focus();
      // coloca el cursor al final
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [focusIndex, blocks.length]);

  const triggerSave = useCallback(
    (nextBlocks?: DocsBlock[], nextTitle?: string, nextIcon?: string) => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        onSave({
          ...page,
          title: nextTitle ?? title,
          icon: nextIcon ?? icon,
          content: nextBlocks ?? blocks,
        });
      }, 600);
    },
    [blocks, icon, onSave, page, title],
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

  // Índice visual para listas numeradas
  let numberedIndex = 0;

  return (
    <div className="docs-editor">
      <div className="docs-page-header">
        <div className="docs-icon-wrap">
          <input
            className="docs-icon"
            value={icon}
            onChange={(e) => {
              setIcon(e.target.value);
              triggerSave(undefined, undefined, e.target.value);
            }}
            maxLength={2}
            aria-label="Page icon"
          />
        </div>
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
                  {filteredCommands.map((cmd, i) => (
                    <button
                      key={cmd.key}
                      type="button"
                      className={`docs-command-item${i === cmdSel ? ' sel' : ''}`}
                      onClick={() => convertBlock(index, cmd.type, cmd.level)}
                    >
                      {cmd.label}
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
