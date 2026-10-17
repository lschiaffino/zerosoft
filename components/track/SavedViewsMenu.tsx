'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { TrackIssueView } from '@/lib/track-data';
import TrackIcon from './TrackIcon';

interface SavedViewsMenuProps {
  views: TrackIssueView[];
  activeViewId?: string;
  onSelect: (view: TrackIssueView) => void;
  onSetDefault: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  labels: {
    title: string;
    empty: string;
    default: string;
    rename: string;
    delete: string;
  };
}

/** Menú de vistas guardadas: aplicar, marcar como predeterminada, renombrar y borrar. */
export default function SavedViewsMenu({
  views,
  activeViewId,
  onSelect,
  onSetDefault,
  onRename,
  onDelete,
  labels,
}: SavedViewsMenuProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const active = views.find((v) => v.id === activeViewId);

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
        <TrackIcon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className="track-saved-views-menu" id={id} role="group" aria-label={labels.title}>
          {views.length === 0 ? (
            <p className="track-saved-views-empty">{labels.empty}</p>
          ) : (
            <ul className="track-saved-view-list">
              {views.map((view) => (
                <li key={view.id} className={`track-saved-view${activeViewId === view.id ? ' is-active' : ''}`}>
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
                      {view.is_default && <span className="badge">{labels.default}</span>}
                    </button>
                  )}
                  <span className="track-saved-view-actions">
                    {!view.is_default && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-icon"
                        onClick={() => onSetDefault(view.id)}
                        aria-label={`${labels.default}: ${view.name}`}
                        title={labels.default}
                      >
                        <TrackIcon name="pin" size={13} />
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
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
