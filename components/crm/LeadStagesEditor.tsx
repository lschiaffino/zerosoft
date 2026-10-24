'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { RemoveIcon } from './RowTools';

interface Stage {
  id: string;
  name: string;
  kind: 'open' | 'qualified' | 'disqualified';
  position: number;
}

const KINDS = ['open', 'qualified', 'disqualified'] as const;

/** Pipeline de leads: renombrar, tipo, orden, alta y baja de etapas (solo admins editan). */
export default function LeadStagesEditor({ initial, canEdit }: { initial: Stage[]; canEdit: boolean }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [stages, setStages] = useState(initial);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function call(url: string, method: string, body?: unknown): Promise<Response | null> {
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
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
    router.refresh();
    return res;
  }

  async function patch(id: string, body: Partial<Stage>) {
    if (await call(`/api/crm/lead-stages/${id}`, 'PATCH', body)) {
      setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...body } : s)));
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= stages.length) return;
    const next = [...stages];
    [next[index], next[j]] = [next[j], next[index]];
    setStages(next);
    // Posiciones correlativas para las dos que cambiaron.
    await call(`/api/crm/lead-stages/${next[index].id}`, 'PATCH', { position: index });
    await call(`/api/crm/lead-stages/${next[j].id}`, 'PATCH', { position: j });
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const res = await call('/api/crm/lead-stages', 'POST', { name: name.trim() });
    if (res) {
      const created = (await res.json()) as Stage;
      setStages((prev) => [...prev, created]);
      setName('');
    }
  }

  async function remove(id: string) {
    if (await call(`/api/crm/lead-stages/${id}`, 'DELETE')) setStages((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <div className="lead-stages" data-testid="lead-stages">
      <ol className="lead-stages-list">
        {stages.map((s, i) => (
          <li key={s.id} className="lead-stage-row">
            <input
              className="input"
              defaultValue={s.name}
              aria-label={t('leads.stageName')}
              maxLength={200}
              disabled={!canEdit || busy}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== s.name) void patch(s.id, { name: v });
                else if (!v) e.target.value = s.name;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
            <select
              className="filter-select"
              value={s.kind}
              aria-label={t('leads.stageKind')}
              disabled={!canEdit || busy}
              onChange={(e) => void patch(s.id, { kind: e.target.value as Stage['kind'] })}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`leads.stageKinds.${k}`)}
                </option>
              ))}
            </select>
            {canEdit && (
              <span className="lead-stage-tools">
                <button type="button" className="icon-btn" onClick={() => void move(i, -1)} disabled={busy || i === 0} aria-label={`${t('leads.moveUp')}: ${s.name}`}>
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => void move(i, 1)}
                  disabled={busy || i === stages.length - 1}
                  aria-label={`${t('leads.moveDown')}: ${s.name}`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-danger btn-sm btn-icon"
                  onClick={() => void remove(s.id)}
                  disabled={busy}
                  aria-label={`${t('leads.deleteStage')}: ${s.name}`}
                  title={t('leads.deleteStage')}
                >
                  <RemoveIcon />
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {canEdit ? (
        <form className="lead-stage-add" onSubmit={add}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('leads.stageName')} aria-label={t('leads.stageName')} maxLength={200} />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !name.trim()}>
            {t('leads.addStage')}
          </button>
        </form>
      ) : (
        <p className="ui-help">{t('common.adminOnly')}</p>
      )}
      <div className="cf-feedback">
        {saved && <span className="saved-note">{t('common.saved')}</span>}
        {error && <p className="form-error">{error}</p>}
      </div>
    </div>
  );
}
