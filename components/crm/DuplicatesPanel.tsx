'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import ConfirmDialog from './ConfirmDialog';

interface DupContact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  created_at: string;
}

interface DupGroup {
  email: string;
  contacts: DupContact[];
}

interface DuplicatesPanelProps {
  contactId: string;
  /** Busca apenas se monta (dentro del drawer "Más"): sin el clic extra. */
  autoFind?: boolean;
}

/**
 * "Find duplicates" → grupos que comparten email e incluyen a este contacto.
 * Merge: keepId = este contacto, dropId = el elegido (con diálogo de confirmación).
 */
export default function DuplicatesPanel({ contactId, autoFind = false }: DuplicatesPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'loaded' | 'error'>(autoFind ? 'loading' : 'idle');
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [dropId, setDropId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [merged, setMerged] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function find() {
    setState('loading');
    const res = await fetch('/api/crm/contacts/duplicates').catch(() => null);
    if (!res || !res.ok) {
      setState('error');
      return;
    }
    const data = (await res.json()) as { groups: DupGroup[] };
    const mine = data.groups.filter((g) => g.contacts.some((c) => c.id === contactId));
    setGroups(mine);
    const firstOther = mine[0]?.contacts.find((c) => c.id !== contactId);
    setDropId(firstOther?.id ?? null);
    setState('loaded');
  }

  useEffect(() => {
    if (autoFind) void find();
    // Solo al montar: find no cambia entre renders relevantes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function displayName(c: DupContact): string {
    return `${c.first_name} ${c.last_name}`.trim() || c.email || c.id;
  }

  async function merge() {
    if (!dropId) return;
    const keep = groups[0]?.contacts.find((c) => c.id === contactId);
    const drop = groups[0]?.contacts.find((c) => c.id === dropId);
    setConfirming(false);
    if (!keep || !drop) return;
    setBusy(true);
    const res = await fetch('/api/crm/contacts/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keepId: contactId, dropId }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) {
      setMerged(true);
      setGroups([]);
      router.refresh();
    }
  }

  if (merged) {
    return <p className="ui-help" role="status">{t('contacts.detail.merged')}</p>;
  }

  if (autoFind && state === 'loading') {
    return (
      <div className="ui-loading-stack" aria-busy="true">
        <span className="ui-skeleton ui-skeleton-row" />
        <span className="ui-skeleton ui-skeleton-row" />
      </div>
    );
  }

  if (state === 'idle' || state === 'loading' || state === 'error') {
    return (
      <div className="dup-panel">
        {state === 'error' && (
          <p className="ui-error" role="alert">
            {t('errors.generic')}
          </p>
        )}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={find}
          aria-busy={state === 'loading' || undefined}
          disabled={state === 'loading'}
        >
          {t('contacts.detail.findDuplicates')}
        </button>
      </div>
    );
  }

  if (groups.length === 0) {
    return <p className="muted">{t('contacts.detail.noDuplicates')}</p>;
  }

  return (
    <div className="dup-panel">
      {groups.map((group) => (
        <div key={group.email} className="dup-group">
          <p className="muted dup-sub">
            {t('contacts.detail.duplicatesSub')} <span className="data">{group.email}</span>
          </p>
          <div className="dup-list">
            {group.contacts.map((c) => (
              <label key={c.id} className={`dup-row ui-check${c.id === contactId ? ' dup-keep' : ''}`}>
                {c.id === contactId ? (
                  <span className="badge">{t('contacts.detail.mergeKeep')}</span>
                ) : (
                  <input
                    type="radio"
                    name="dup-drop"
                    checked={dropId === c.id}
                    onChange={() => setDropId(c.id)}
                  />
                )}
                <span className="dup-name">{displayName(c)}</span>
                <span className="muted dup-email">{c.email}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setConfirming(true)}
            disabled={busy || !dropId}
          >
            {t('contacts.detail.merge')}
          </button>
        </div>
      ))}
      {confirming &&
        (() => {
          const keep = groups[0]?.contacts.find((c) => c.id === contactId);
          const drop = groups[0]?.contacts.find((c) => c.id === dropId);
          return (
            <ConfirmDialog
              title={t('contacts.detail.mergeConfirmTitle')}
              message={t('contacts.detail.mergeConfirm', {
                drop: drop ? drop.email || displayName(drop) : '',
                keep: keep ? keep.email || displayName(keep) : '',
              })}
              confirmLabel={t('contacts.detail.merge')}
              cancelLabel={t('common.cancel')}
              busy={busy}
              onConfirm={() => void merge()}
              onCancel={() => setConfirming(false)}
            />
          );
        })()}
    </div>
  );
}
