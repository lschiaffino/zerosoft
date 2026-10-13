'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { BoardDetail, BoardSummary } from '@/lib/boards-types';

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
  const started = useRef(false);
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    setNow(Date.now());
    const h = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(h);
  }, []);

  const create = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: t('list.untitled') }),
      });
      if (!res.ok) return;
      const board = (await res.json()) as BoardDetail;
      router.push(`/app/board/${board.id}`);
    } finally {
      setBusy(false);
    }
  }, [busy, router, t]);

  useEffect(() => {
    if (startNew && !started.current) {
      started.current = true;
      void create();
    }
  }, [startNew, create]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.board-card-menu')) setMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  async function rename(id: string, name: string) {
    setRenaming(null);
    const clean = name.trim();
    const prev = boards.find((b) => b.id === id);
    if (!clean || !prev || clean === prev.name) return;
    setBoards((list) => list.map((b) => (b.id === id ? { ...b, name: clean } : b)));
    await fetch(`/api/boards/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: clean }),
    });
  }

  async function duplicate(b: BoardSummary) {
    setMenu(null);
    const res = await fetch(`/api/boards/${b.id}/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: t('list.copyName', { name: b.name }).slice(0, 120) }),
    });
    if (!res.ok) return;
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
    const res = await fetch(`/api/boards/${b.id}`, { method: 'DELETE' });
    if (res.ok) setBoards((list) => list.filter((x) => x.id !== b.id));
  }

  return (
    <div className="board-list app-page">
      <div className="page-head">
        <div>
          <h1 className="app-title">{t('list.title')}</h1>
          <p className="app-sub">{t('list.subtitle')}</p>
        </div>
        {boards.length > 0 && (
          <button type="button" className="btn btn-solid" onClick={() => void create()} disabled={busy}>
            {t('list.new')}
          </button>
        )}
      </div>

      {boards.length === 0 ? (
        <div className="board-empty">
          <p className="board-empty-title">{t('list.emptyTitle')}</p>
          <p className="dim">{t('list.emptyHint')}</p>
          <button type="button" className="btn btn-solid" onClick={() => void create()} disabled={busy}>
            {t('list.new')}
          </button>
        </div>
      ) : (
        <ul className="board-grid">
          {boards.map((b) => (
            <li key={b.id} className="board-card">
              <Link href={`/app/board/${b.id}`} className="board-thumb" aria-label={b.name}>
                {b.thumbnail ? (
                  // Miniatura SVG generada por el cliente (filtrada en el servidor); como <img> no ejecuta nada.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(b.thumbnail)}`} alt="" />
                ) : (
                  <span className="board-thumb-empty" aria-hidden="true" />
                )}
              </Link>
              <div className="board-card-body">
                {renaming === b.id ? (
                  <input
                    className="board-rename"
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
                <p className="board-card-meta mono">
                  {t('list.updated', { when: format.relativeTime(new Date(b.updated_at), new Date(now)) })}
                  {b.updated_by ? ` · ${b.updated_by}` : ''}
                  {b.shared ? ` · ${t('share.on')}` : ''}
                </p>
              </div>
              <div className="board-card-menu">
                <button
                  type="button"
                  className="board-icon-btn"
                  onClick={() => setMenu(menu === b.id ? null : b.id)}
                  aria-expanded={menu === b.id}
                  aria-label={t('list.actions')}
                >
                  ···
                </button>
                {menu === b.id && (
                  <div className="board-menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => { setMenu(null); setRenaming(b.id); }}>
                      {t('list.rename')}
                    </button>
                    <button type="button" role="menuitem" onClick={() => void duplicate(b)}>
                      {t('list.duplicate')}
                    </button>
                    <button type="button" role="menuitem" className="danger" onClick={() => void remove(b)}>
                      {t('list.delete')}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
