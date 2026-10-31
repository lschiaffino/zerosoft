'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

interface Row {
  id: string;
  name: string;
  skills: string[];
  capacity: number | null;
}

/** Habilidades y límite de conversaciones activas por persona (los usan las reglas de asignación). */
export default function RoutingClient({ canManage }: { canManage: boolean }) {
  const t = useTranslations('chat');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState<string>('');

  async function load() {
    setError(false);
    try {
      const res = await fetch('/api/chat/routing');
      if (!res.ok) throw new Error('load_failed');
      setRows(((await res.json()) as { agents: Row[] }).agents);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(row: Row, patch: { skills?: string; capacity?: string }) {
    const skills = patch.skills !== undefined ? patch.skills.split(',').map((x) => x.trim()).filter(Boolean) : row.skills;
    const capacity = patch.capacity !== undefined ? (patch.capacity.trim() === '' ? null : Number(patch.capacity)) : row.capacity;
    setStatus('');
    const res = await fetch('/api/chat/routing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: row.id, skills, capacity }),
    }).catch(() => null);
    if (!res?.ok) {
      setStatus(t('errors.generic'));
      return;
    }
    const saved = (await res.json()) as Row;
    setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? { ...r, skills: saved.skills, capacity: saved.capacity } : r)));
    setStatus(t('routing.saved'));
  }

  return (
    <section className="chat-pane" aria-labelledby="chat-routing-title">
      <h2 id="chat-routing-title" className="ui-section-title">
        {t('routing.title')}
      </h2>
      <p className="ui-help">{t('routing.sub')}</p>
      {error ? (
        <div className="chat-load-error" role="alert">
          <p>{t('errors.loadFailed')}</p>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      ) : rows === null ? (
        <div className="ui-loading-stack" aria-label={t('common.loading')}>
          <span className="ui-skeleton ui-skeleton-row" />
        </div>
      ) : (
        <div className="table-wrap chat-stack">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('routing.person')}</th>
                <th scope="col">{t('routing.skills')}</th>
                <th scope="col">{t('routing.capacity')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td data-label={t('routing.skills')}>
                    <input
                      key={r.skills.join(',')}
                      className="input"
                      disabled={!canManage}
                      defaultValue={r.skills.join(', ')}
                      placeholder={t('routing.skillsPlaceholder')}
                      aria-label={t('routing.skillsOf', { name: r.name })}
                      onBlur={(e) => {
                        if (e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).join(',') !== r.skills.join(',')) void save(r, { skills: e.target.value });
                      }}
                    />
                  </td>
                  <td data-label={t('routing.capacity')}>
                    <input
                      key={String(r.capacity)}
                      className="input"
                      type="number"
                      min={0}
                      max={1000}
                      disabled={!canManage}
                      defaultValue={r.capacity ?? ''}
                      placeholder={t('routing.noLimit')}
                      aria-label={t('routing.capacityOf', { name: r.name })}
                      onBlur={(e) => {
                        if (e.target.value !== String(r.capacity ?? '')) void save(r, { capacity: e.target.value });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="ui-help" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
