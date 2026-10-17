'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TrackStatusRow } from '@/lib/db';
import TrackIcon from './TrackIcon';

const CATEGORIES = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_KEY: Record<Category, string> = {
  backlog: 'backlog',
  todo: 'todo',
  in_progress: 'inProgress',
  done: 'done',
  cancelled: 'cancelled',
};

interface StatusesSettingsProps {
  projectId: string;
  statuses: TrackStatusRow[];
  /** Borrar status es solo para owner/admin. */
  canDelete?: boolean;
  /** Estado nuevo tras cada cambio (la vista recarga issues si hace falta). */
  onChange: (statuses: TrackStatusRow[], opts?: { reloadIssues?: boolean }) => void;
}

/**
 * Configuración de los status del workflow de un proyecto: agregar, renombrar,
 * color, categoría, reordenar (↑/↓) y borrar reasignando sus issues.
 */
export default function StatusesSettings({ projectId, statuses, canDelete = true, onChange }: StatusesSettingsProps) {
  const t = useTranslations('track');
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<Category>('todo');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState('');
  const [busy, setBusy] = useState(false);
  // Color guardado antes de empezar a editar, para revertir si falla el PATCH.
  const colorBefore = useRef(new Map<string, string>());

  async function call(url: string, init: RequestInit): Promise<Response | null> {
    setError(null);
    const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } }).catch(() => null);
    if (!res?.ok) setError(t('errors.generic'));
    return res?.ok ? res : null;
  }

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    const res = await call(`/api/track/statuses/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!res) return false;
    const saved = (await res.json()) as TrackStatusRow;
    onChange(statuses.map((s) => (s.id === id ? saved : s)), { reloadIssues: true });
    return true;
  }

  async function saveColor(id: string, color: string) {
    const before = colorBefore.current.get(id);
    colorBefore.current.delete(id);
    if (before === undefined || before === color) return;
    if (!(await patch(id, { color }))) {
      onChange(statuses.map((x) => (x.id === id ? { ...x, color: before } : x)));
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= statuses.length) return;
    const next = [...statuses];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    const res = await call(`/api/track/projects/${projectId}/statuses/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ statusIds: next.map((s) => s.id) }),
    });
    if (!res) {
      onChange(statuses);
      return;
    }
    onChange(((await res.json()) as { rows: TrackStatusRow[] }).rows);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || busy) return;
    setBusy(true);
    const res = await call(`/api/track/projects/${projectId}/statuses`, {
      method: 'POST',
      body: JSON.stringify({ name: newName.trim(), category: newCategory, color: '#767676' }),
    });
    setBusy(false);
    if (!res) return;
    const created = (await res.json()) as TrackStatusRow;
    onChange([...statuses, created]);
    setNewName('');
  }

  async function remove(id: string) {
    if (!reassignTo || busy) return;
    setBusy(true);
    const res = await call(`/api/track/statuses/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reassignTo }),
    });
    setBusy(false);
    if (!res) return;
    setDeleting(null);
    onChange(
      statuses.filter((s) => s.id !== id),
      { reloadIssues: true },
    );
  }

  return (
    <div className="track-statuses" data-testid="track-statuses-settings">
      <p className="ui-help">{t('statusSettings.help')}</p>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <ul className="track-status-list">
        {statuses.map((s, i) => (
          <li key={s.id} className="track-status-item" data-testid="track-status-item">
            <input
              type="color"
              className="track-status-color"
              value={/^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#767676'}
              onChange={(e) => {
                if (!colorBefore.current.has(s.id)) colorBefore.current.set(s.id, s.color);
                onChange(statuses.map((x) => (x.id === s.id ? { ...x, color: e.target.value } : x)));
              }}
              onBlur={(e) => void saveColor(s.id, e.target.value)}
              aria-label={`${t('statusSettings.color')}: ${s.name}`}
            />
            <input
              className="input track-status-name"
              defaultValue={s.name}
              aria-label={t('statusSettings.name')}
              maxLength={200}
              onBlur={async (e) => {
                const el = e.target;
                const v = el.value.trim();
                if (!v) {
                  el.value = s.name;
                  return;
                }
                if (v !== s.name && !(await patch(s.id, { name: v }))) el.value = s.name;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
            <select
              className="select track-status-category"
              value={s.category}
              aria-label={`${t('statusSettings.category')}: ${s.name}`}
              onChange={(e) => void patch(s.id, { category: e.target.value })}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`statuses.${CATEGORY_KEY[c]}`)}
                </option>
              ))}
            </select>
            <span className="track-status-tools">
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => void move(i, -1)}
                disabled={i === 0}
                aria-label={`${t('statusSettings.moveUp')}: ${s.name}`}
                title={t('statusSettings.moveUp')}
              >
                <TrackIcon name="up" />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => void move(i, 1)}
                disabled={i === statuses.length - 1}
                aria-label={`${t('statusSettings.moveDown')}: ${s.name}`}
                title={t('statusSettings.moveDown')}
              >
                <TrackIcon name="down" />
              </button>
              {canDelete && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon track-status-remove"
                  disabled={statuses.length <= 1}
                  aria-label={`${t('statusSettings.delete')}: ${s.name}`}
                  title={t('statusSettings.delete')}
                  onClick={() => {
                    setDeleting(s.id);
                    setReassignTo(statuses.find((x) => x.id !== s.id)?.id ?? '');
                  }}
                >
                  <TrackIcon name="close" />
                </button>
              )}
            </span>
            {deleting === s.id && (
              <div className="track-status-delete" role="group" aria-label={t('statusSettings.confirmDelete')}>
                <label className="track-status-reassign">
                  <span>{t('statusSettings.reassignTo')}</span>
                  <select className="select" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                    {statuses
                      .filter((x) => x.id !== s.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                </label>
                <span className="track-inline-form-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(null)}>
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary btn-danger"
                    onClick={() => void remove(s.id)}
                    aria-busy={busy || undefined}
                  >
                    {t('statusSettings.confirmDelete')}
                  </button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!canDelete && <p className="ui-help">{t('statusSettings.adminOnly')}</p>}
      <form className="track-status-add" onSubmit={add}>
        <input
          className="input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('statusSettings.newPlaceholder')}
          aria-label={t('statusSettings.newPlaceholder')}
          maxLength={200}
        />
        <select
          className="select"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value as Category)}
          aria-label={t('statusSettings.category')}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`statuses.${CATEGORY_KEY[c]}`)}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-sm" disabled={!newName.trim()} aria-busy={busy || undefined}>
          {t('statusSettings.add')}
        </button>
      </form>
    </div>
  );
}
