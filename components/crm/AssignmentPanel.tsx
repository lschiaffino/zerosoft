'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import AdvancedSection from '@/components/ui/AdvancedSection';
import RowTools from './RowTools';

interface Person {
  id: string;
  label: string;
}

interface HistoryRow {
  id: string;
  contact_id: string | null;
  contact_name: string | null;
  person_id: string;
  source: string;
  created_at: string;
}

interface Props {
  rule: { enabled: boolean; sources: string[]; pool: string[] };
  unavailable: string[];
  history: HistoryRow[];
  people: Person[];
  /** Persona logueada: siempre puede marcar su propia disponibilidad. */
  selfId: string;
  canEdit: boolean;
}

const SOURCES = ['form', 'chat', 'cal', 'import', 'api'] as const;

/**
 * Round-robin de leads nuevos: encendido, pool ordenado y fuera de oficina a
 * la vista; fuentes e historial en Avanzado.
 */
export default function AssignmentPanel({ rule, unavailable, history, people, selfId, canEdit }: Props) {
  const t = useTranslations('crm');
  const locale = useLocale();
  const [enabled, setEnabled] = useState(rule.enabled);
  const [sources, setSources] = useState<string[]>(rule.sources);
  const [pool, setPool] = useState<string[]>(rule.pool);
  const [away, setAway] = useState<string[]>(unavailable);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = (id: string) => people.find((p) => p.id === id)?.label ?? id;

  async function save(next: { enabled: boolean; sources: string[]; pool: string[] }) {
    setSaved(false);
    setError(null);
    const res = await fetch('/api/crm/assignment', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => null);
    if (res?.ok) setSaved(true);
    else setError(t('errors.generic'));
  }

  function update(patch: Partial<{ enabled: boolean; sources: string[]; pool: string[] }>) {
    const next = { enabled, sources, pool, ...patch };
    setEnabled(next.enabled);
    setSources(next.sources);
    setPool(next.pool);
    void save(next);
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= pool.length) return;
    const copy = [...pool];
    const [x] = copy.splice(i, 1);
    copy.splice(j, 0, x);
    update({ pool: copy });
  }

  async function setAvailable(personId: string, available: boolean) {
    const res = await fetch('/api/crm/assignment/availability', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personId, available }),
    }).catch(() => null);
    if (res?.ok) setAway((prev) => (available ? prev.filter((x) => x !== personId) : [...prev, personId]));
  }

  const fmt = (ts: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(`${ts.replace(' ', 'T')}Z`));

  return (
    <div className="assign-panel">
      <label className="ui-switch">
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          disabled={!canEdit}
          data-testid="rr-enabled"
        />
        {t('assignment.enabled')}
      </label>

      <div className="assign-pool">
        <h3 className="label">{t('assignment.pool')}</h3>
        <p className="ui-help">{t('assignment.poolDesc')}</p>
        <ul className="assign-people">
          {people.map((p) => {
            const idx = pool.indexOf(p.id);
            const inPool = idx >= 0;
            const isAway = away.includes(p.id);
            return (
              <li key={p.id} className={`assign-person${inPool ? '' : ' out'}`}>
                <label className="ui-check">
                  <input
                    type="checkbox"
                    checked={inPool}
                    onChange={(e) => update({ pool: e.target.checked ? [...pool, p.id] : pool.filter((x) => x !== p.id) })}
                    disabled={!canEdit}
                  />
                  <span className="data assign-order">{inPool ? idx + 1 : ''}</span>
                  {p.label}
                </label>
                <span className="assign-person-actions">
                  {(canEdit || p.id === selfId) && (
                    <label className="ui-check">
                      <input type="checkbox" checked={isAway} onChange={(e) => setAvailable(p.id, !e.target.checked)} />
                      {t('assignment.outOfOffice')}
                    </label>
                  )}
                  {canEdit && inPool && <RowTools index={idx} count={pool.length} onMove={(d) => move(idx, d)} name={p.label} />}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <p className={error ? 'ui-error' : 'ui-help'} role="status" aria-live="polite">
        {error ?? (saved ? t('common.saved') : null)}
      </p>

      <AdvancedSection storageKey="crm.settings.assignment" hint={t('assignment.advancedHint')}>
        <fieldset className="assign-sources" disabled={!canEdit}>
          <legend className="label">{t('assignment.sources')}</legend>
          {SOURCES.map((s) => (
            <label key={s} className="ui-check">
              <input
                type="checkbox"
                checked={sources.includes(s)}
                onChange={(e) => update({ sources: e.target.checked ? [...sources, s] : sources.filter((x) => x !== s) })}
              />
              {t(`assignment.source.${s}`)}
            </label>
          ))}
        </fieldset>

        <div className="assign-history">
          <h3 className="label">{t('assignment.history')}</h3>
          {history.length === 0 ? (
            <p className="ui-help">{t('assignment.noHistory')}</p>
          ) : (
            <ul className="assign-history-list">
              {history.slice(0, 15).map((h) => (
                <li key={h.id}>
                  <span className="data">{fmt(h.created_at)}</span>{' '}
                  {h.contact_id ? (
                    <Link href={`/app/crm/contacts/${h.contact_id}`}>{h.contact_name || t('forms.contact')}</Link>
                  ) : null}{' '}
                  {t('assignment.assignedTo', { name: name(h.person_id), source: t(`assignment.source.${h.source}`) })}
                </li>
              ))}
            </ul>
          )}
        </div>
      </AdvancedSection>
    </div>
  );
}
