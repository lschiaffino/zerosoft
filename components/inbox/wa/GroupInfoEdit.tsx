'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { CheckIcon, Close, PencilIcon } from '@/components/groups/wa/icons';
import RichText from '@/components/groups/wa/RichText';
import { GROUP_DESCRIPTION_MAX, GROUP_NAME_MAX } from '@/lib/wa-group-limits';
import { api } from '../api';

/**
 * Nombre y descripción del grupo con su lápiz, como en la info del grupo de
 * WhatsApp Web: el lápiz abre el campo, Enter (en la descripción ⌘/Ctrl+Enter)
 * o el tilde guardan en WhatsApp, Esc o la X lo dejan como estaba. Mientras
 * vuelve la info del servidor se muestra lo guardado.
 */
type Field = 'name' | 'description';

function useGroupField(threadId: string, field: Field, value: string, cb: { onSaved: (text: string) => void; onError: (code: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Llegó la info nueva (o cambió de chat): manda lo del servidor.
  useEffect(() => setSaved(null), [value, threadId]);
  useEffect(() => setEditing(false), [threadId]);
  const shown = saved ?? value;
  const start = () => {
    setDraft(shown);
    setEditing(true);
  };
  const cancel = () => setEditing(false);
  const save = async () => {
    const text = field === 'name' ? draft.replace(/\s+/g, ' ').trim() : draft.trim();
    if (field === 'name' && !text) {
      cb.onError('invalid_name');
      return;
    }
    if (text === shown) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const r = await api<{ title: string; about: string }>(`/api/inbox/threads/${threadId}/wa`, { method: 'POST', json: { action: 'groupInfo', [field]: text } });
    setBusy(false);
    if (!r.ok) {
      cb.onError(r.data.error ?? 'generic');
      return;
    }
    setSaved(field === 'name' ? r.data.title : r.data.about);
    setEditing(false);
    cb.onSaved(text);
  };
  return { editing, draft, setDraft, busy, shown, start, cancel, save };
}

interface Props {
  threadId: string;
  value: string;
  onSaved: () => void;
  onToast: (text: string) => void;
  onError: (code: string) => void;
}

export function GroupNameEdit({ threadId, value, onSaved, onToast, onError }: Props) {
  const t = useTranslations('inboxWa.groupEdit');
  const f = useGroupField(threadId, 'name', value, {
    onError,
    onSaved: () => {
      onToast(t('nameSaved'));
      onSaved();
    },
  });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (f.editing) input.current?.select();
  }, [f.editing]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      f.cancel();
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void f.save();
    }
  };
  if (!f.editing) {
    return (
      <p className="ib-wa-hero-name ib-wa-editable" dir="auto" data-testid="group-name">
        <span>{f.shown}</span>
        <button type="button" className="wa-icon-btn ib-wa-edit-btn" onClick={f.start} aria-label={t('editName')} title={t('editName')} data-testid="group-name-edit">
          <PencilIcon size={18} />
        </button>
      </p>
    );
  }
  return (
    <div className="ib-wa-edit-row" data-testid="group-name-form">
      <input
        ref={input}
        className="input ib-wa-edit-input"
        value={f.draft}
        maxLength={GROUP_NAME_MAX}
        onChange={(e) => f.setDraft(e.target.value)}
        onKeyDown={onKey}
        aria-label={t('nameLabel')}
        disabled={f.busy}
        dir="auto"
        autoFocus
      />
      <span className="ib-wa-edit-count" aria-hidden="true">
        {GROUP_NAME_MAX - f.draft.length}
      </span>
      <EditButtons busy={f.busy} onSave={() => void f.save()} onCancel={f.cancel} />
    </div>
  );
}

export function GroupDescriptionEdit({ threadId, value, onSaved, onToast, onError }: Props) {
  const t = useTranslations('inboxWa.groupEdit');
  const f = useGroupField(threadId, 'description', value, {
    onError,
    onSaved: () => {
      onToast(t('descriptionSaved'));
      onSaved();
    },
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      f.cancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void f.save();
    }
  };
  if (!f.editing) {
    return (
      <div className="ib-wa-editable ib-wa-editable-block" data-testid="group-description">
        {f.shown ? (
          <p className="ib-wa-about" dir="auto">
            <RichText text={f.shown} />
          </p>
        ) : (
          <button type="button" className="ib-wa-add-desc" onClick={f.start} data-testid="group-description-add">
            {t('addDescription')}
          </button>
        )}
        <button type="button" className="wa-icon-btn ib-wa-edit-btn" onClick={f.start} aria-label={t('editDescription')} title={t('editDescription')} data-testid="group-description-edit">
          <PencilIcon size={18} />
        </button>
      </div>
    );
  }
  return (
    <div className="ib-wa-edit-row is-block" data-testid="group-description-form">
      <textarea
        className="input ib-wa-edit-input"
        value={f.draft}
        maxLength={GROUP_DESCRIPTION_MAX}
        rows={4}
        onChange={(e) => f.setDraft(e.target.value)}
        onKeyDown={onKey}
        aria-label={t('descriptionLabel')}
        disabled={f.busy}
        dir="auto"
        autoFocus
      />
      <div className="ib-wa-edit-foot">
        <span className="ib-wa-edit-count">{t('left', { n: GROUP_DESCRIPTION_MAX - f.draft.length })}</span>
        <EditButtons busy={f.busy} onSave={() => void f.save()} onCancel={f.cancel} />
      </div>
    </div>
  );
}

function EditButtons({ busy, onSave, onCancel }: { busy: boolean; onSave: () => void; onCancel: () => void }) {
  const t = useTranslations('inboxWa.groupEdit');
  return (
    <span className="ib-wa-edit-actions">
      <button type="button" className="wa-icon-btn" onClick={onCancel} aria-label={t('cancel')} title={t('cancel')} disabled={busy} data-testid="group-edit-cancel">
        <Close size={18} />
      </button>
      <button type="button" className="wa-icon-btn is-primary" onClick={onSave} aria-label={t('save')} title={t('save')} disabled={busy} data-testid="group-edit-save">
        <CheckIcon size={18} />
      </button>
    </span>
  );
}
