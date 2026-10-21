'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import CompanyLogo from './CompanyLogo';
import ConfirmDialog from './ConfirmDialog';

interface DupCompany {
  id: string;
  name: string;
  domain: string;
  city: string;
  country: string;
  created_at: string;
}

interface DupGroup {
  reasons: Array<'domain' | 'name'>;
  key: string;
  companies: DupCompany[];
}

interface CompanyDuplicatesPanelProps {
  /** Solo los grupos que incluyen esta empresa (y es la que queda por defecto). */
  companyId?: string;
}

/**
 * Empresas duplicadas por dominio o nombre. En cada grupo se elige cuál queda
 * (por defecto esta empresa o la más antigua) y el resto se fusiona en ella.
 * Las fusionadas van a la papelera, de donde se pueden restaurar.
 */
export default function CompanyDuplicatesPanel({ companyId }: CompanyDuplicatesPanelProps) {
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
    const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    const res = await fetch(`/api/crm/companies/duplicates${qs}`).catch(() => null);
    if (!res || !res.ok) {
      setState('error');
      return;
    }
    const data = (await res.json()) as { groups: DupGroup[] };
    setGroups(data.groups);
    setKeep(
      Object.fromEntries(
        data.groups.map((g) => [
          groupKey(g),
          companyId && g.companies.some((c) => c.id === companyId) ? companyId : g.companies[0].id,
        ]),
      ),
    );
    setState('loaded');
  }

  useEffect(() => {
    void load();
    // Solo al montar (y si cambia la empresa).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  /** Lo que queda y lo que se fusiona según la elección del grupo. */
  function plan(group: DupGroup) {
    const keepId = keep[groupKey(group)];
    return {
      keepId,
      kept: group.companies.find((c) => c.id === keepId),
      drops: group.companies.filter((c) => c.id !== keepId),
    };
  }

  async function merge(group: DupGroup) {
    const gk = groupKey(group);
    const { keepId, kept, drops } = plan(group);
    setConfirming(null);
    if (!kept || !drops.length) return;
    setBusy(gk);
    setNotice(null);
    let merged = 0;
    for (const d of drops) {
      const res = await fetch('/api/crm/companies/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keepId, dropId: d.id }),
      }).catch(() => null);
      if (res?.ok) merged++;
    }
    setBusy(null);
    setNotice(merged === drops.length ? t('companies.dupes.merged', { count: merged }) : t('errors.generic'));
    // La empresa abierta se fusionó en otra: se va a la que quedó.
    if (companyId && keepId !== companyId && merged) {
      router.push(`/app/crm/companies/${keepId}`);
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
      <p className="ui-error" role="alert">
        {t('errors.generic')}
      </p>
    );
  }

  return (
    <div className="dup-panel">
      {notice && (
        <p className="ui-help" role="status">
          {notice}
        </p>
      )}
      {groups.length === 0 ? (
        <p className="muted">{t('companies.dupes.none')}</p>
      ) : (
        groups.map((group) => {
          const gk = groupKey(group);
          return (
            <div key={gk} className="dup-group">
              <p className="muted dup-sub">
                {t(group.reasons.includes('domain') ? 'companies.dupes.byDomain' : 'companies.dupes.byName')}{' '}
                <span className="data">{group.key}</span>
              </p>
              <div className="dup-list" role="radiogroup" aria-label={t('companies.dupes.keepLabel')}>
                {group.companies.map((c) => (
                  <label key={c.id} className={`dup-row ui-check${keep[gk] === c.id ? ' dup-keep' : ''}`}>
                    <input
                      type="radio"
                      name={`dup-keep-${gk}`}
                      checked={keep[gk] === c.id}
                      onChange={() => setKeep((prev) => ({ ...prev, [gk]: c.id }))}
                    />
                    <CompanyLogo domain={c.domain} name={c.name} size={18} />
                    <Link href={`/app/crm/companies/${c.id}`} className="dup-name">
                      {c.name || '—'}
                    </Link>
                    <span className="muted dup-email">{[c.domain, c.city, c.country].filter(Boolean).join(' · ')}</span>
                    {keep[gk] === c.id && <span className="badge">{t('companies.dupes.keep')}</span>}
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setConfirming(group)}
                disabled={busy !== null}
                aria-busy={busy === gk || undefined}
              >
                {t('companies.dupes.merge', { count: group.companies.length - 1 })}
              </button>
            </div>
          );
        })
      )}
      <p className="ui-help">{t('companies.dupes.trashNote')}</p>
      {confirming &&
        (() => {
          const { kept, drops } = plan(confirming);
          return (
            <ConfirmDialog
              title={t('companies.dupes.confirmTitle')}
              message={t('companies.dupes.confirm', { count: drops.length, keep: kept?.name ?? '' })}
              confirmLabel={t('companies.dupes.merge', { count: drops.length })}
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

function groupKey(g: DupGroup): string {
  return g.companies[0]?.id ?? g.key;
}
