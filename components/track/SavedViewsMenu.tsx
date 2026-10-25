'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TrackSavedView } from '@/lib/track-ux';
import TrackIcon from './TrackIcon';

interface SavedViewsMenuProps {
  views: TrackSavedView[];
  activeViewId?: string;
  /** Usuario actual: solo quien creó una vista la edita, comparte o borra. */
  userId: string;
  /** La vista activa difiere de lo guardado (filtros, agrupado, orden o vista). */
  dirty?: boolean;
  onSelect: (view: TrackSavedView) => void;
  onSetDefault: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onToggleShared: (id: string, shared: boolean) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
  onUpdate: (id: string) => void;
  onCopyLink: (id: string) => void;
  labels: {
    title: string;
    empty: string;
    default: string;
    rename: string;
    delete: string;
  };
}

/**
 * Vistas guardadas del proyecto, como las de Linear: las mías y las del
 * equipo, con favoritas (aparecen en el sidebar), compartir con el equipo,
 * guardar los cambios actuales, copiar el link, renombrar y borrar.
 */
export default function SavedViewsMenu({
  views,
  activeViewId,
  userId,
  dirty = false,
  onSelect,
  onSetDefault,
  onRename,
  onDelete,
  onToggleShared,
  onToggleFavorite,
  onUpdate,
  onCopyLink,
  labels,
}: SavedViewsMenuProps) {
  const t = useTranslations('track.ux.views');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const active = views.find((v) => v.id === activeViewId);
  const mine = views.filter((v) => v.user_id === userId);
  const team = views.filter((v) => v.user_id !== userId);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const commit = (viewId: string) => {
    if (editName.trim()) onRename(viewId, editName.trim());
    setEditing(null);
  };

  const item = (view: TrackSavedView) => {
    const own = view.user_id === userId;
    return (
      <li key={view.id} className={`track-saved-view${activeViewId === view.id ? ' is-active' : ''}`} data-testid="track-saved-view">
        {editing === view.id ? (
          <input
            className="input"
            type="text"
            value={editName}
            aria-label={labels.rename}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={() => commit(view.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(view.id);
              if (e.key === 'Escape') {
                e.stopPropagation();
                setEditing(null);
              }
            }}
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="track-saved-view-name"
            aria-current={activeViewId === view.id ? 'true' : undefined}
            onClick={() => {
              onSelect(view);
              setOpen(false);
            }}
          >
            <span>{view.name}</span>
            {view.is_default && <span className="track-saved-view-tag">{labels.default}</span>}
            {own && view.shared && <span className="track-saved-view-tag">{t('team')}</span>}
            {!own && view.owner_name && <span className="track-saved-view-owner">{view.owner_name}</span>}
          </button>
        )}
        <span className="track-saved-view-actions">
          <button
            type="button"
            className={`btn btn-ghost btn-sm btn-icon track-fav${view.favorite ? ' is-on' : ''}`}
            onClick={() => onToggleFavorite(view.id, !view.favorite)}
            aria-pressed={view.favorite}
            aria-label={`${view.favorite ? t('unfavorite') : t('favorite')}: ${view.name}`}
            title={view.favorite ? t('unfavorite') : t('favorite')}
            data-testid="track-view-favorite"
          >
            <TrackIcon name="star" size={13} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => onCopyLink(view.id)}
            aria-label={`${t('copyLink')}: ${view.name}`}
            title={t('copyLink')}
          >
            <TrackIcon name="link" size={13} />
          </button>
          {own && (
            <>
              <button
                type="button"
                className={`btn btn-ghost btn-sm btn-icon${view.shared ? ' is-on' : ''}`}
                onClick={() => onToggleShared(view.id, !view.shared)}
                aria-pressed={view.shared}
                aria-label={`${view.shared ? t('unshare') : t('share')}: ${view.name}`}
                title={view.shared ? t('unshare') : t('share')}
                data-testid="track-view-share"
              >
                <TrackIcon name="users" size={13} />
              </button>
              {!view.is_default && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon"
                  onClick={() => onSetDefault(view.id)}
                  aria-label={`${labels.default}: ${view.name}`}
                  title={labels.default}
                >
                  <TrackIcon name="check" size={13} />
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => {
                  setEditing(view.id);
                  setEditName(view.name);
                }}
                aria-label={`${labels.rename}: ${view.name}`}
                title={labels.rename}
              >
                <TrackIcon name="pencil" size={13} />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon btn-danger"
                onClick={() => onDelete(view.id)}
                aria-label={`${labels.delete}: ${view.name}`}
                title={labels.delete}
              >
                <TrackIcon name="close" size={13} />
              </button>
            </>
          )}
        </span>
      </li>
    );
  };

  return (
    <div
      className="track-saved-views"
      ref={wrap}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open && !editing) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="btn btn-ghost btn-sm"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        data-testid="track-saved-views"
      >
        {active ? active.name : labels.title}
        {active && dirty && <span className="track-view-dirty" title={t('unsaved')} aria-label={t('unsaved')} />}
        <TrackIcon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className="track-saved-views-menu" id={id} role="group" aria-label={labels.title}>
          {active && dirty && active.user_id === userId && (
            <button
              type="button"
              className="btn btn-sm track-saved-views-update"
              onClick={() => {
                onUpdate(active.id);
                setOpen(false);
              }}
              data-testid="track-view-update"
            >
              {t('update', { name: active.name })}
            </button>
          )}
          {views.length === 0 ? (
            <p className="track-saved-views-empty">{labels.empty}</p>
          ) : (
            <>
              {mine.length > 0 && (
                <>
                  <p className="track-saved-views-section">{t('mine')}</p>
                  <ul className="track-saved-view-list">{mine.map(item)}</ul>
                </>
              )}
              {team.length > 0 && (
                <>
                  <p className="track-saved-views-section">{t('teamViews')}</p>
                  <ul className="track-saved-view-list">{team.map(item)}</ul>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
