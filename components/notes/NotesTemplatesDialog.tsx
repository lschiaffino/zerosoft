'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { DocsBlock } from '@/lib/docs-types';
import type { NoteTemplateInfo } from '@/lib/notes-types';
import { getNoteBuiltinTemplates } from '@/lib/notes-templates-builtin';
import { NotesModal, PromptDialog } from './NotesModal';
import RowMenu from './RowMenu';

/** Bloques nuevos (ids nuevos) a partir de una plantilla propia. */
function freshBlocks(blocks: DocsBlock[]): DocsBlock[] {
  return blocks.map((b) => ({ ...b, id: crypto.randomUUID() }));
}

/**
 * Galería de plantillas (como "New from template" de Evernote): las propias
 * arriba, con renombrar y borrar, y las de fábrica abajo. Elegir una crea la
 * nota en el filtro actual.
 */
export default function NotesTemplatesDialog({
  onPick,
  onClose,
  onError,
}: {
  onPick: (tpl: { title: string; content: DocsBlock[] }) => void;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('notes.templates');
  const locale = useLocale();
  const [mine, setMine] = useState<NoteTemplateInfo[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<NoteTemplateInfo | null>(null);
  const [deleting, setDeleting] = useState<NoteTemplateInfo | null>(null);
  const builtIn = useMemo(() => getNoteBuiltinTemplates(locale), [locale]);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch('/api/notes/templates');
      if (!res.ok) throw new Error(String(res.status));
      setMine(((await res.json()) as { templates: NoteTemplateInfo[] }).templates);
    } catch {
      setLoadError(true);
      setMine([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const term = filter.trim().toLowerCase();
  const mineShown = (mine ?? []).filter((x) => !term || x.name.toLowerCase().includes(term));
  const builtShown = builtIn.filter((x) => !term || x.title.toLowerCase().includes(term) || x.description.toLowerCase().includes(term));

  async function rename(tpl: NoteTemplateInfo, name: string) {
    const res = await fetch(`/api/notes/templates/${tpl.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (!res?.ok) {
      onError(t('loadError'));
      return false;
    }
    setMine((cur) => (cur ?? []).map((x) => (x.id === tpl.id ? { ...x, name } : x)).sort((a, b) => a.name.localeCompare(b.name)));
    return true;
  }

  async function remove(tpl: NoteTemplateInfo) {
    setDeleting(null);
    const prev = mine;
    setMine((cur) => (cur ?? []).filter((x) => x.id !== tpl.id));
    const res = await fetch(`/api/notes/templates/${tpl.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setMine(prev);
      onError(t('loadError'));
    }
  }

  return (
    <>
      <NotesModal title={t('title')} onClose={onClose} closeLabel={t('close')} wide className="notes-templates">
        <input
          className="input notes-templates-filter"
          type="search"
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('filter')}
          aria-label={t('filter')}
        />
        <div role="group" aria-labelledby="notes-tpl-mine">
          <h3 id="notes-tpl-mine" className="notes-templates-head">
            {t('yours')}
          </h3>
          {mine === null ? (
            <div className="notes-templates-grid" aria-label={t('loading')} aria-busy="true">
              {[0, 1].map((i) => (
                <span key={i} className="ui-skeleton notes-template-skeleton" />
              ))}
            </div>
          ) : loadError ? (
            <p className="notes-templates-empty" role="alert">
              {t('loadError')}{' '}
              <button type="button" className="btn btn-sm" onClick={() => void load()}>
                {t('retry')}
              </button>
            </p>
          ) : mine.length === 0 ? (
            <p className="notes-templates-empty">{t('empty')}</p>
          ) : mineShown.length === 0 ? (
            <p className="notes-templates-empty">{t('noMatch')}</p>
          ) : (
            <ul className="notes-templates-grid">
              {mineShown.map((tpl) => (
                <li key={tpl.id} className="notes-template-card">
                  <button
                    type="button"
                    className="notes-template-pick"
                    onClick={() => onPick({ title: tpl.title, content: freshBlocks(tpl.content) })}
                  >
                    <span className="notes-template-name">{tpl.name}</span>
                    {tpl.title && <span className="notes-template-desc">{tpl.title}</span>}
                  </button>
                  <RowMenu
                    className="notes-template-menu"
                    open={menu === tpl.id}
                    label={t('actions', { name: tpl.name })}
                    onToggle={(o) => setMenu(o ? tpl.id : null)}
                    items={[
                      {
                        label: t('rename'),
                        onSelect: () => {
                          setMenu(null);
                          setRenaming(tpl);
                        },
                      },
                      {
                        label: t('delete'),
                        danger: true,
                        onSelect: () => {
                          setMenu(null);
                          setDeleting(tpl);
                        },
                      },
                    ]}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div role="group" aria-labelledby="notes-tpl-built">
          <h3 id="notes-tpl-built" className="notes-templates-head">
            {t('builtIn')}
          </h3>
          {builtShown.length === 0 ? (
            <p className="notes-templates-empty">{t('noMatch')}</p>
          ) : (
            <ul className="notes-templates-grid">
              {builtShown.map((tpl) => (
                <li key={tpl.key} className="notes-template-card">
                  <button
                    type="button"
                    className="notes-template-pick"
                    data-template={tpl.key}
                    onClick={() => onPick({ title: tpl.title, content: tpl.makeBlocks() })}
                  >
                    <span className="notes-template-name">{tpl.title}</span>
                    <span className="notes-template-desc">{tpl.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </NotesModal>
      {renaming && (
        <PromptDialog
          title={t('rename')}
          label={t('nameLabel')}
          initial={renaming.name}
          confirmLabel={t('save')}
          cancelLabel={t('cancel')}
          onSubmit={(v) => rename(renaming, v)}
          onClose={() => setRenaming(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t('confirmDelete', { name: deleting?.name ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={() => deleting && void remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
