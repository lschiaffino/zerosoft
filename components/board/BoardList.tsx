'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import NotesIcon from '@/components/notes/NotesIcon';
import type { BoardDetail, BoardSummary } from '@/lib/boards-types';

const TOAST_MS = 6000;

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
  const format = useFormatter();
  const router = useRouter();
  const [boards, setBoards] = useState(initialBoards);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const started = useRef(false);
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
      created_at: copy.created_at,
      updated_at: copy.updated_at,
      updated_by: copy.updated_by,
    };
    setBoards((list) => [summary, ...list]);
  }

  async function remove(b: BoardSummary) {
    setMenu(null);
    if (!confirm(t('list.confirmDelete', { name: b.name }))) return;
    const res = await fetch(`/api/boards/${b.id}`, { method: 'DELETE' }).catch(() => null);
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
        <EmptyState product="board" title={t('list.emptyTitle')} body={t('list.emptyHint')} action={newButton} />
      ) : (
        <ul className="board-grid">
          {boards.map((b) => (
            <li key={b.id} className="board-card">
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
                  {t('list.updated', { when: format.relativeTime(new Date(b.updated_at), new Date(now)) })}
                  {b.updated_by ? ` · ${b.updated_by}` : ''}
                </p>
                {b.shared && <span className="badge badge-outline board-card-shared">{t('share.on')}</span>}
              </div>
              <BoardCardMenu
                open={menu === b.id}
                label={`${t('list.actions')}: ${b.name}`}
                onToggle={(open) => setMenu(open ? b.id : null)}
                items={[
                  { label: t('list.rename'), onSelect: () => { setMenu(null); setRenaming(b.id); } },
                  { label: t('list.duplicate'), onSelect: () => void duplicate(b) },
                  { label: t('list.delete'), danger: true, onSelect: () => void remove(b) },
                ]}
              />
            </li>
          ))}
        </ul>
      )}

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

/**
 * Menú de una tarjeta: flechas, Home/End, Esc devuelve el foco al botón,
 * clic afuera cierra.
 */
function BoardCardMenu({
  open,
  label,
  onToggle,
  items,
}: {
  open: boolean;
  label: string;
  onToggle: (open: boolean) => void;
  items: Array<{ label: string; onSelect: () => void; danger?: boolean }>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // El padre pasa una función nueva en cada render: se lee por ref para no re-enfocar.
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) toggleRef.current(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function onKey(e: React.KeyboardEvent) {
    const els = Array.from(wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = (i + 1) % els.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + els.length) % els.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = els.length - 1;
    else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') {
        e.preventDefault();
        buttonRef.current?.focus();
      }
      onToggle(false);
      return;
    }
    if (next != null) {
      e.preventDefault();
      els[next]?.focus();
    }
  }

  return (
    <div className="board-card-menu" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        title={label}
      >
        <NotesIcon name="more" size={16} />
      </button>
      {open && (
        <div className="board-menu" role="menu" aria-label={label} onKeyDown={onKey}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className={it.danger ? 'is-danger' : undefined} onClick={it.onSelect}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
