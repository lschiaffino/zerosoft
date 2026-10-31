'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/** Miembros de un espacio: quien lo administra los elige; el resto los ve. Sacar a alguien le corta el acceso al toque. */
export default function RecSpaceMembers({ open, spaceId, canManage, onClose, onChanged }: { open: boolean; spaceId: string; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations('rec.library');
  const tc = useTranslations('rec.common');
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [people, setPeople] = useState<Array<{ id: string; name: string; email: string }> | null>(null);
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setPeople(null);
      setError(null);
      d.showModal();
      void fetch(`/api/rec/spaces/${spaceId}/members`)
        .then((r) => (r.ok ? (r.json() as Promise<{ members: string[]; people: Array<{ id: string; name: string; email: string }> }>) : null))
        .then((x) => {
          if (!x) return setError(tc('errors.generic'));
          setPeople(x.people);
          setMembers(new Set(x.members));
        })
        .catch(() => setError(tc('errors.generic')));
    }
    if (!open && d.open) d.close();
  }, [open, spaceId, tc]);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/rec/spaces/${spaceId}/members`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ members: [...members] }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(tc('errors.generic'));
    onChanged();
    onClose();
  }

  return (
    <dialog
      ref={ref}
      className="ui-modal"
      aria-labelledby={`${id}-t`}
      data-testid="rec-members-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id={`${id}-t`}>
              {t('spaceMembers')}
            </h2>
          </div>
          <div className="ui-modal-body">
            <p className="ui-help">{t('spaceMembersHelp')}</p>
            {!people && !error && <div className="ui-skeleton-text" aria-busy="true" />}
            {people && (
              <fieldset className="rec-move-list">
                <legend className="sr-only">{t('spaceMembers')}</legend>
                {people.map((p) => (
                  <label key={p.id} className="ui-check rec-move-opt">
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={members.has(p.id)}
                      data-testid="rec-member-check"
                      data-email={p.email}
                      onChange={(e) =>
                        setMembers((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(p.id);
                          else next.delete(p.id);
                          return next;
                        })
                      }
                    />
                    <span>{p.name}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {error && (
              <p className="ui-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-sm" onClick={onClose}>
              {tc('cancel')}
            </button>
            {canManage && (
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !people} data-testid="rec-members-save">
                {tc('save')}
              </button>
            )}
          </div>
        </form>
      )}
    </dialog>
  );
}
