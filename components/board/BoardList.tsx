'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import NotesIcon from '@/components/notes/NotesIcon';
import RowMenu from '@/components/notes/RowMenu';
import type { BoardDetail, BoardSummary } from '@/lib/boards-types';
import { BOARD_TEMPLATES, type BoardTemplateKey } from '@/lib/board-templates';
import TemplatePreview from './TemplatePreview';
import { notifyBoardsChanged } from './BoardBranch';
import { preloadCanvas } from './preloadCanvas';
import { parseDbUtc } from '@/lib/utils';

const TOAST_MS = 6000;
/** Plantillas plegadas o abiertas: se recuerda por navegador. */
const TEMPLATES_KEY = 'board.templates.collapsed';

/** Grilla de pizarras del workspace: crear, renombrar, duplicar y borrar. */
export default function BoardList({
  initialBoards,
  startNew = false,
  serverNow,
}: {
  initialBoards: BoardSummary[];
  startNew?: boolean;
  /** "Ahora" del render del servidor: el primer render del cliente usa el mismo (sin hydration mismatch). */
  serverNow: number;
}) {
  const t = useTranslations('board');
  const tt = useTranslations('board.templates');
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const [boards, setBoards] = useState(initialBoards);
  // El sidebar lista las pizarras: se le avisa cada cambio local (renombrar, duplicar, borrar).
  const firstBoards = useRef(true);
  useEffect(() => {
    if (firstBoards.current) {
      firstBoards.current = false;
      return;
    }
    notifyBoardsChanged();
  }, [boards]);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState<BoardTemplateKey | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Pizarra a borrar, esperando la confirmación del modal. */
  const [deleting, setDeleting] = useState<BoardSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [templatesCollapsed, setTemplatesCollapsed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    try {
      setTemplatesCollapsed(window.localStorage.getItem(TEMPLATES_KEY) === '1');
    } catch {
      // Sin storage: quedan abiertas.
    }
  }, []);

  function toggleTemplates(open: boolean) {
    setTemplatesCollapsed(!open);
    try {
      window.localStorage.setItem(TEMPLATES_KEY, open ? '0' : '1');
    } catch {
      // Sin storage: vale solo para esta visita.
    }
  }
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    setNow(Date.now());
    const h = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(h);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(h);
  }, [toast]);

  const create = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    preloadCanvas(); // el lienzo baja mientras se crea la pizarra
    try {
      const res = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: t('list.untitled') }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const board = (await res.json()) as BoardDetail;
      router.push(`/app/board/${board.id}`);
    } catch {
      setToast(t('list.createError'));
      setBusy(false);
    }
  }, [busy, router, t]);

  /** Pizarra nueva con la escena de la plantilla, en el idioma de la interfaz. */
  async function createFromTemplate(key: BoardTemplateKey) {
    if (busy || creatingTemplate) return;
    setCreatingTemplate(key);
    preloadCanvas();
    try {
      const res = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: tt(`${key}.name`), template: key, locale }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const board = (await res.json()) as BoardDetail;
      router.push(`/app/board/${board.id}`);
    } catch {
      setToast(t('list.createError'));
      setCreatingTemplate(null);
    }
  }

  useEffect(() => {
    if (startNew && !started.current) {
      started.current = true;
      void create();
    }
  }, [startNew, create]);

  async function rename(id: string, name: string) {
    setRenaming(null);
    const clean = name.trim();
    const prev = boards.find((b) => b.id === id);
    if (!clean || !prev || clean === prev.name) return;
    setBoards((list) => list.map((b) => (b.id === id ? { ...b, name: clean } : b)));
    const res = await fetch(`/api/boards/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: clean }),
    }).catch(() => null);
    if (!res?.ok) {
      setBoards((list) => list.map((b) => (b.id === id ? { ...b, name: prev.name } : b)));
      setToast(t('list.actionError'));
    }
  }

  async function duplicate(b: BoardSummary) {
    setMenu(null);
    const res = await fetch(`/api/boards/${b.id}/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: t('list.copyName', { name: b.name }).slice(0, 120) }),
    }).catch(() => null);
    if (!res?.ok) {
      setToast(t('list.actionError'));
      return;
    }
    const copy = (await res.json()) as BoardDetail;
    const summary: BoardSummary = {
      id: copy.id,
      name: copy.name,
      thumbnail: copy.thumbnail,
      version: copy.version,
      shared: copy.shared,
      access: copy.access,
      created_at: copy.created_at,
      updated_at: copy.updated_at,
      updated_by: copy.updated_by,
    };
    setBoards((list) => [summary, ...list]);
  }

  async function remove(b: BoardSummary) {
    setDeleteBusy(true);
    const res = await fetch(`/api/boards/${b.id}`, { method: 'DELETE' }).catch(() => null);
    setDeleteBusy(false);
    setDeleting(null);
    if (res?.ok) setBoards((list) => list.filter((x) => x.id !== b.id));
    else setToast(t('list.actionError'));
  }

  const newButton = (
    <button type="button" className="btn btn-primary" onClick={() => void create()} aria-busy={busy}>
      {busy ? t('list.creating') : t('list.new')}
    </button>
  );

  return (
    <div className="ui-page board-list">
      <PageHeader title={t('list.title')} description={t('list.subtitle')} actions={boards.length > 0 ? newButton : undefined} />


      {boards.length === 0 ? (
        <EmptyState quiet product="board" title={t('list.emptyTitle')} body={t('list.emptyHint')} action={newButton} />
      ) : (
        <ul className="board-grid">
          {boards.map((b) => (
            // Al apuntar o enfocar una tarjeta se precarga el lienzo (ver preloadCanvas).
            <li key={b.id} className="board-card" onPointerEnter={preloadCanvas} onFocus={preloadCanvas}>
              <div className="board-thumb" aria-hidden="true">
                {b.thumbnail ? (
                  // Miniatura SVG generada por el cliente (filtrada en el servidor); como <img> no ejecuta nada.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(b.thumbnail)}`} alt="" />
                ) : null}
              </div>
              <div className="board-card-body">
                {renaming === b.id ? (
                  <input
                    className="input board-rename"
                    defaultValue={b.name}
                    autoFocus
                    maxLength={120}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => void rename(b.id, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void rename(b.id, e.currentTarget.value);
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    aria-label={t('list.rename')}
                  />
                ) : (
                  <Link href={`/app/board/${b.id}`} className="board-card-name">
                    {b.name}
                  </Link>
                )}
                <p className="board-card-meta">
                  {t('list.updated', { when: format.relativeTime(parseDbUtc(b.updated_at), new Date(now)) })}
                  {b.updated_by ? ` · ${b.updated_by}` : ''}
                </p>
                {b.shared && <span className="badge badge-outline board-card-shared">{t('share.on')}</span>}
                {b.access === 'restricted' && <span className="badge badge-outline board-card-shared">{t('access.restrictedBadge')}</span>}
              </div>
              <RowMenu
                className="board-card-menu"
                open={menu === b.id}
                label={`${t('list.actions')}: ${b.name}`}
                onToggle={(open) => setMenu(open ? b.id : null)}
                items={[
                  { label: t('list.rename'), onSelect: () => { setMenu(null); setRenaming(b.id); } },
                  { label: t('list.duplicate'), onSelect: () => void duplicate(b) },
                  { label: t('list.delete'), danger: true, onSelect: () => { setMenu(null); setDeleting(b); } },
                ]}
              />
            </li>
          ))}
        </ul>
      )}

      <section className={`board-templates${boards.length > 0 ? ' is-compact' : ''}`} aria-labelledby="board-templates-title">
        <details
          className="board-templates-details"
          // Sin pizarras, las plantillas son el camino principal: siempre abiertas.
          open={boards.length === 0 || !templatesCollapsed}
        >
          <summary
            className="board-templates-title"
            id="board-templates-title"
            onClick={(e) => {
              // El estado manda (y se recuerda); el toggle nativo no, que también salta al hidratar.
              e.preventDefault();
              if (boards.length > 0) toggleTemplates(templatesCollapsed);
            }}
          >
            <NotesIcon name="back" size={12} />
            {t('list.templatesTitle')}
          </summary>
          <ul className="board-templates-grid">
            {BOARD_TEMPLATES.map((key) => (
              <li key={key}>
                <button
                  type="button"
                  className="board-template"
                  onClick={() => void createFromTemplate(key)}
                  aria-busy={creatingTemplate === key}
                  disabled={creatingTemplate !== null}
                >
                  <span className="board-template-preview" aria-hidden="true">
                    <TemplatePreview template={key} />
                  </span>
                  <span className="board-template-name">{tt(`${key}.name`)}</span>
                  <span className="board-template-desc">{tt(`${key}.description`)}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <ConfirmDialog
        open={deleting !== null}
        danger
        busy={deleteBusy}
        title={t('list.deleteTitle')}
        body={deleting ? t('list.confirmDelete', { name: deleting.name }) : null}
        confirmLabel={t('list.delete')}
        cancelLabel={t('list.cancel')}
        onConfirm={() => deleting && void remove(deleting)}
        onCancel={() => setDeleting(null)}
      />

      <div className="ui-toasts" role="status" aria-live="polite">
        {toast && (
          <div className="ui-toast" data-tone="error">
            {toast}
            <button type="button" className="ui-toast-action" onClick={() => setToast(null)}>
              {t('editor.dismiss')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

