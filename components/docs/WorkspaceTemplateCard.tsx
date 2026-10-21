'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DocsWorkspaceTemplate } from '@/lib/docs-types';
import RowMenu from '@/components/notes/RowMenu';

/**
 * Tarjeta de una plantilla del workspace en el inicio de Docs: click crea una
 * página desde la plantilla; el menú "…" (quien la guardó o un admin) la
 * renombra en el lugar o la borra.
 */
export default function WorkspaceTemplateCard({
  template,
  canEdit,
  createAction,
  renameAction,
  deleteAction,
}: {
  template: Pick<DocsWorkspaceTemplate, 'id' | 'title' | 'icon' | 'description'>;
  canEdit: boolean;
  createAction: () => Promise<void>;
  renameAction: (title: string) => Promise<boolean>;
  deleteAction: () => Promise<boolean>;
}) {
  const t = useTranslations('docs.templates');
  const router = useRouter();
  const [title, setTitle] = useState(template.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(template.title);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const name = title || t('untitled');

  useEffect(() => {
    setTitle(template.title);
  }, [template.title]);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const commitRename = () => {
    const next = draft.trim();
    setRenaming(false);
    if (!next || next === title) return;
    const prev = title;
    setTitle(next);
    setError(false);
    startTransition(async () => {
      const ok = await renameAction(next).catch(() => false);
      if (!ok) {
        setTitle(prev);
        setError(true);
        return;
      }
      router.refresh();
    });
  };

  const remove = () => {
    setMenuOpen(false);
    if (!confirm(t('confirmDelete', { name }))) return;
    setError(false);
    startTransition(async () => {
      const ok = await deleteAction().catch(() => false);
      if (!ok) setError(true);
      router.refresh();
    });
  };

  return (
    <li className="docs-template-item" aria-busy={pending || undefined}>
      {renaming ? (
        <div className="docs-template docs-template-renaming">
          <input
            ref={inputRef}
            className="input docs-template-rename"
            value={draft}
            maxLength={200}
            aria-label={t('renameLabel')}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(title);
                setRenaming(false);
              }
            }}
          />
          <span className="docs-template-desc">{template.description || t('workspaceDesc')}</span>
        </div>
      ) : (
        <form action={createAction}>
          <button type="submit" className="docs-template" disabled={pending}>
            <span className="docs-template-name">
              {template.icon && <span aria-hidden="true">{template.icon} </span>}
              {name}
            </span>
            <span className="docs-template-desc">{template.description || t('workspaceDesc')}</span>
            {error && (
              <span className="docs-template-error" role="alert">
                {t('editError')}
              </span>
            )}
          </button>
        </form>
      )}
      {canEdit && !renaming && (
        <RowMenu
          className="docs-template-menu"
          open={menuOpen}
          label={t('options', { name })}
          onToggle={setMenuOpen}
          items={[
            {
              label: t('rename'),
              onSelect: () => {
                setMenuOpen(false);
                setDraft(title);
                setRenaming(true);
              },
            },
            { label: t('deleteItem'), onSelect: remove, danger: true },
          ]}
        />
      )}
    </li>
  );
}
