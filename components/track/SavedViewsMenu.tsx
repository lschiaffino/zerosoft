'use client';

import { useState } from 'react';
import type { TrackIssueView } from '@/lib/track-data';

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

  return (
    <div className="track-saved-views">
      <button type="button" className="track-saved-views-toggle" onClick={() => setOpen((v) => !v)}>
        {labels.title}
      </button>
      {open && (
        <div className="track-saved-views-menu">
          {views.length === 0 ? (
            <p className="track-saved-views-empty">{labels.empty}</p>
          ) : (
            views.map((view) => (
              <div
                key={view.id}
                className={['track-saved-view', activeViewId === view.id ? 'active' : ''].filter(Boolean).join(' ')}
              >
                {editing === view.id ? (
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => {
                      if (editName.trim()) onRename(view.id, editName.trim());
                      setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (editName.trim()) onRename(view.id, editName.trim());
                        setEditing(null);
                      }
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    autoFocus
                  />
                ) : (
                  <button type="button" className="track-saved-view-name" onClick={() => onSelect(view)}>
                    {view.name}
                    {view.is_default && <span className="track-saved-view-default">{labels.default}</span>}
                  </button>
                )}
                <div className="track-saved-view-actions">
                  {!view.is_default && (
                    <button type="button" onClick={() => onSetDefault(view.id)} title={labels.default}>
                      ☆
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(view.id);
                      setEditName(view.name);
                    }}
                    title={labels.rename}
                  >
                    ✎
                  </button>
                  <button type="button" onClick={() => onDelete(view.id)} title={labels.delete}>
                    ×
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
