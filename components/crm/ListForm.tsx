'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

export interface EnumOption {
  value: string;
  label: string;
}

interface ListFormProps {
  lifecycles: EnumOption[];
  leadStatuses: EnumOption[];
  sources: EnumOption[];
  onCancel: () => void;
}

/** Nueva lista: nombre + tipo; si es dinámica, mini filter builder → filter JSON. */
export default function ListForm({ lifecycles, leadStatuses, sources, onCancel }: ListFormProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<'static' | 'dynamic'>('static');
  const [q, setQ] = useState('');
  const [lifecycle, setLifecycle] = useState('');
  const [leadStatus, setLeadStatus] = useState('');
  const [source, setSource] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t('errors.missing_name'));
      return;
    }
    setBusy(true);
    const filter: Record<string, string> = {};
    if (kind === 'dynamic') {
      if (q.trim()) filter.q = q.trim();
      if (lifecycle) filter.lifecycle = lifecycle;
      if (leadStatus) filter.leadStatus = leadStatus;
      if (source) filter.source = source;
    }
    const res = await fetch('/api/crm/lists', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        entity: 'contacts',
        kind,
        ...(kind === 'dynamic' ? { filter } : {}),
      }),
    }).catch(() => null);
    if (res && res.status === 201) {
      const created = (await res.json()) as { id: string };
      router.push(`/app/crm/lists/${created.id}`);
      return;
    }
    setError(t('errors.generic'));
    setBusy(false);
  }

  return (
    <form className="crm-form" onSubmit={onSubmit}>
      <div className="ui-fields-2">
        <label className="ui-field">
          <span className="label">{t('lists.nameLabel')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
        </label>
        <label className="ui-field">
          <span className="label">{t('lists.kind')}</span>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as 'static' | 'dynamic')}>
            <option value="static">{t('lists.static')}</option>
            <option value="dynamic">{t('lists.dynamic')}</option>
          </select>
        </label>
      </div>

      {kind === 'dynamic' && (
        <>
          <p className="ui-help">{t('lists.dynamicNote')}</p>
          <div className="ui-fields-2">
            <label className="ui-field">
              <span className="label">{t('lists.filterLifecycle')}</span>
              <select className="select" value={lifecycle} onChange={(e) => setLifecycle(e.target.value)}>
                <option value="">{t('common.all')}</option>
                {lifecycles.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="label">{t('lists.filterLeadStatus')}</span>
              <select className="select" value={leadStatus} onChange={(e) => setLeadStatus(e.target.value)}>
                <option value="">{t('common.all')}</option>
                {leadStatuses.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="label">{t('lists.filterSource')}</span>
              <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">{t('common.all')}</option>
                {sources.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="ui-field">
            <span className="label">{t('lists.filterQ')}</span>
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('common.search')}
              maxLength={500}
            />
          </label>
        </>
      )}

      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy} aria-busy={busy || undefined}>
          {t('record.createList')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
