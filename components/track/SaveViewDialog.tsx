'use client';

import { useState } from 'react';
import type { ViewType } from './ViewSwitcher';
import type { FilterState } from './IssueFilters';

interface SaveViewDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  viewType: ViewType;
  filters: FilterState;
  labels: {
    title: string;
    name: string;
    namePlaceholder: string;
    save: string;
    cancel: string;
  };
}

export default function SaveViewDialog({ open, onClose, onSave, labels }: SaveViewDialogProps) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  return (
    <div className="track-dialog-overlay" onClick={onClose}>
      <div className="track-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{labels.title}</h3>
        <div className="track-form-row">
          <label htmlFor="viewName">{labels.name}</label>
          <input
            id="viewName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={labels.namePlaceholder}
            autoFocus
          />
        </div>
        <div className="track-form-actions">
          <button
            type="button"
            className="btn btn-solid"
            disabled={!name.trim() || submitting}
            onClick={() => {
              setSubmitting(true);
              onSave(name.trim());
            }}
          >
            {submitting ? labels.save + '…' : labels.save}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {labels.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
