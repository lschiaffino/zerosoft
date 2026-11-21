'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { RemoveIcon } from './RowTools';
import { CONTACT_COMPANY_LABELS } from '@/lib/crm-constants';

type Pair = 'contact_company' | 'deal_contact';

interface Label {
  id: string;
  pair: Pair;
  name: string;
}

const PAIRS: Pair[] = ['contact_company', 'deal_contact'];

/**
 * Labels de asociación del workspace (Ajustes › Datos), como en HubSpot:
 * contacto ↔ empresa ("Contacto de facturación") y deal ↔ contacto ("Decisor").
 * Solo owner y admins los crean, renombran y borran; la ficha los ofrece en
 * las tarjetas de asociaciones.
 */
export default function AssociationLabelsPanel({ initial, canEdit }: { initial: Label[]; canEdit: boolean }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [labels, setLabels] = useState(initial);
  const [drafts, setDrafts] = useState<Record<Pair, string>>({ contact_company: '', deal_contact: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: string, url: string, body?: unknown): Promise<Response | null> {
    setBusy(true);
    setError(null);
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
      setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
      return null;
    }
    router.refresh();
    return res;
  }

  async function add(e: React.FormEvent, pair: Pair) {
    e.preventDefault();
    const name = drafts[pair].trim();
    if (!name) return;
    const res = await call('POST', '/api/crm/association-labels', { pair, name });
    if (res) {
      const created = (await res.json()) as Label;
      setLabels((prev) => [...prev, created]);
      setDrafts((d) => ({ ...d, [pair]: '' }));
    }
  }

  async function rename(id: string, name: string) {
    if (await call('PATCH', '/api/crm/association-labels', { id, name })) {
      setLabels((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)));
    }
  }

  async function remove(id: string) {
    if (await call('DELETE', `/api/crm/association-labels?id=${encodeURIComponent(id)}`)) {
      setLabels((prev) => prev.filter((l) => l.id !== id));
    }
  }

  return (
    <div className="assoc-labels" data-testid="assoc-labels">
      {PAIRS.map((pair) => {
        const rows = labels.filter((l) => l.pair === pair);
        return (
          <section key={pair} className="assoc-labels-group" data-testid={`assoc-labels-${pair}`}>
            <h3 className="assoc-labels-title">{t(`assocLabels.pairs.${pair}`)}</h3>
            {pair === 'contact_company' && (
              <p className="ui-help">
                {t('assocLabels.builtin', {
                  labels: CONTACT_COMPANY_LABELS.map((k) => t(`enums.contactCompanyLabel.${k}`)).join(', '),
                })}
              </p>
            )}
            {rows.length === 0 ? (
              <p className="muted assoc-labels-empty">{t('assocLabels.empty')}</p>
            ) : (
              <ul className="assoc-labels-list">
                {rows.map((l) => (
                  <li key={l.id} className="assoc-labels-row">
                    <input
                      className="input"
                      defaultValue={l.name}
                      aria-label={`${t('assocLabels.name')}: ${l.name}`}
                      maxLength={60}
                      disabled={!canEdit || busy}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== l.name) void rename(l.id, v);
                        else if (!v) e.target.value = l.name;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') {
                          (e.target as HTMLInputElement).value = l.name;
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                    />
                    {canEdit && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-danger btn-sm btn-icon"
                        onClick={() => void remove(l.id)}
                        disabled={busy}
                        aria-label={`${t('assocLabels.delete')}: ${l.name}`}
                        title={t('assocLabels.delete')}
                      >
                        <RemoveIcon />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <form className="assoc-labels-add" onSubmit={(e) => void add(e, pair)}>
                <input
                  className="input"
                  value={drafts[pair]}
                  onChange={(e) => setDrafts((d) => ({ ...d, [pair]: e.target.value }))}
                  placeholder={t('assocLabels.placeholder')}
                  aria-label={`${t('assocLabels.name')} (${t(`assocLabels.pairs.${pair}`)})`}
                  maxLength={60}
                  data-testid={`assoc-labels-input-${pair}`}
                />
                <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !drafts[pair].trim()}>
                  {t('assocLabels.add')}
                </button>
              </form>
            )}
          </section>
        );
      })}
      {!canEdit && <p className="ui-help">{t('common.adminOnly')}</p>}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
