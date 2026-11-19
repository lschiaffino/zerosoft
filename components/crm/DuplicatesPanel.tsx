'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

interface DupContact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  job_title?: string;
  created_at: string;
}

interface DupGroup {
  email: string;
  contacts: DupContact[];
}

interface DuplicatesPanelProps {
  /**
   * Solo el grupo de este contacto (drawer "Más" de su ficha): es el que queda
   * por defecto. Sin él, todos los grupos del workspace (Contactos › Duplicados).
   */
  contactId?: string;
}

function displayName(c: DupContact): string {
  return `${c.first_name} ${c.last_name}`.trim() || c.email || c.id;
}

/**
 * Contactos que comparten email. En cada grupo se elige cuál queda (por
 * defecto este contacto o el más antiguo) y el resto se fusiona en él con
 * /api/crm/contacts/merge. Nada se fusiona solo: siempre con confirmación.
 */
export default function DuplicatesPanel({ contactId }: DuplicatesPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Grupo esperando la confirmación de la fusión. */
  const [confirming, setConfirming] = useState<DupGroup | null>(null);

  async function load() {
    setState('loading');
    const qs = contactId ? `?contactId=${encodeURIComponent(contactId)}` : '';
    const res = await fetch(`/api/crm/contacts/duplicates${qs}`).catch(() => null);
    if (!res || !res.ok) {
      setState('error');
      return;
    }
    const data = (await res.json()) as { groups: DupGroup[] };
    setGroups(data.groups);
    setKeep(
      Object.fromEntries(
        data.groups.map((g) => [
          g.email,
          contactId && g.contacts.some((c) => c.id === contactId) ? contactId : g.contacts[0].id,
        ]),
      ),
    );
    setState('loaded');
  }

  useEffect(() => {
    void load();
    // Solo al montar (y si cambia el contacto).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  /** Lo que queda y lo que se fusiona según la elección del grupo. */
  function plan(group: DupGroup) {
    const keepId = keep[group.email];
    return {
      keepId,
      kept: group.contacts.find((c) => c.id === keepId),
      drops: group.contacts.filter((c) => c.id !== keepId),
    };
  }

  async function merge(group: DupGroup) {
    const { keepId, kept, drops } = plan(group);
    setConfirming(null);
    if (!kept || !drops.length) return;
    setBusy(group.email);
    setNotice(null);
    let merged = 0;
    for (const d of drops) {
      const res = await fetch('/api/crm/contacts/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keepId, dropId: d.id }),
      }).catch(() => null);
      if (res?.ok) merged++;
    }
    setBusy(null);
    setNotice(merged === drops.length ? t('contacts.dupes.merged', { count: merged }) : t('errors.generic'));
    // El contacto abierto se fusionó en otro: se va al que quedó.
    if (contactId && keepId !== contactId && merged) {
      router.push(`/app/crm/contacts/${keepId}`);
      return;
    }
    router.refresh();
    void load();
  }

  if (state === 'loading') {
    return (
      <div className="ui-loading-stack" aria-busy="true">
        <span className="ui-skeleton ui-skeleton-row" />
        <span className="ui-skeleton ui-skeleton-row" />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="dup-panel">
        <p className="ui-error" role="alert">
          {t('errors.generic')}
        </p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
          {t('contacts.detail.findDuplicates')}
        </button>
      </div>
    );
  }

  return (
    <div className="dup-panel dup-contacts" data-testid="contact-duplicates">
      {notice && (
        <p className="ui-help" role="status">
          {notice}
        </p>
      )}
      {groups.length === 0 ? (
        <p className="muted">{t(contactId ? 'contacts.detail.noDuplicates' : 'contacts.dupes.none')}</p>
      ) : (
        groups.map((group) => (
          <div key={group.email} className="dup-group" data-testid="contact-duplicates-group">
            <p className="muted dup-sub">
              {t('contacts.detail.duplicatesSub')} <span className="data dup-key">{group.email}</span>
            </p>
            <div className="dup-list" role="radiogroup" aria-label={t('contacts.dupes.keepLabel')}>
              {group.contacts.map((c) => (
                <label key={c.id} className={`dup-row ui-check${keep[group.email] === c.id ? ' dup-keep' : ''}`}>
                  <input
                    type="radio"
                    name={`dup-keep-${group.email}`}
                    checked={keep[group.email] === c.id}
                    onChange={() => setKeep((prev) => ({ ...prev, [group.email]: c.id }))}
                  />
                  {c.id === contactId ? (
                    <span className="dup-name">{displayName(c)}</span>
                  ) : (
                    <Link href={`/app/crm/contacts/${c.id}`} className="dup-name">
                      {displayName(c)}
                    </Link>
                  )}
                  <span className="muted dup-email">{[c.job_title, c.phone].filter(Boolean).join(' · ')}</span>
                  {keep[group.email] === c.id && <span className="badge">{t('contacts.dupes.keep')}</span>}
                </label>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setConfirming(group)}
              disabled={busy !== null}
              aria-busy={busy === group.email || undefined}
              data-testid="contact-duplicates-merge"
            >
              {t('contacts.dupes.merge', { count: group.contacts.length - 1 })}
            </button>
          </div>
        ))
      )}
      {groups.length > 0 && <p className="ui-help">{t('contacts.dupes.note')}</p>}
      {confirming &&
        (() => {
          const { kept, drops } = plan(confirming);
          return (
            <ConfirmDialog
              open
              title={t('contacts.detail.mergeConfirmTitle')}
              body={t('contacts.dupes.confirm', { count: drops.length, keep: kept ? displayName(kept) : '' })}
              confirmLabel={t('contacts.dupes.merge', { count: drops.length })}
              cancelLabel={t('common.cancel')}
              busy={busy !== null}
              onConfirm={() => void merge(confirming)}
              onCancel={() => setConfirming(null)}
            />
          );
        })()}
    </div>
  );
}
