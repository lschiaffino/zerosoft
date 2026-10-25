'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface Split {
  ownerId: string;
  percent: number;
}

interface DealSplitsPanelProps {
  dealId: string;
  ownerId: string;
  amount: number;
  currency: string;
  locale: string;
  people: Array<{ value: string; label: string }>;
  splits: Split[];
}

const ERRORS = new Set(['sum_not_100', 'duplicate_owner', 'invalid_percent', 'invalid_owner', 'too_many']);

/**
 * Splits del deal: repartir el monto entre dueños por porcentaje (suman
 * 100%). Sin splits, todo es del owner. Los reportes por persona, las cuotas
 * y el forecast por owner cuentan a cada uno su parte.
 */
export default function DealSplitsPanel({ dealId, ownerId, amount, currency, locale, people, splits }: DealSplitsPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Array<{ ownerId: string; percent: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = (id: string) => people.find((p) => p.value === id)?.label ?? '';
  const money = (v: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(v);
  const current = splits.length ? splits : [{ ownerId, percent: 100 }];
  const total = rows.reduce((a, r) => a + (Number(r.percent) || 0), 0);

  function start() {
    const base = splits.length ? splits : [{ ownerId, percent: 100 }];
    setRows(base.map((s) => ({ ownerId: s.ownerId, percent: String(s.percent) })));
    if (!splits.length) {
      const other = people.find((p) => p.value !== ownerId);
      if (other) setRows([{ ownerId, percent: '50' }, { ownerId: other.value, percent: '50' }]);
    }
    setError(null);
    setEditing(true);
  }

  async function save(next: Split[]) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/deals/${dealId}/splits`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ splits: next }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string } | null;
      setError(t(body?.error && ERRORS.has(body.error) ? `splits.errors.${body.error}` : 'errors.generic'));
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="record-summary-block split-panel" data-testid="deal-splits">
      <h2 className="record-summary-title">{t('splits.title')}</h2>
      {!editing ? (
        <>
          <ul className="record-summary-list">
            {current.map((s) => (
              <li key={s.ownerId} data-testid="deal-split-row">
                <span>
                  {name(s.ownerId) || t('splits.unknown')} <span className="num muted">{s.percent}%</span>
                </span>
                <span className="muted num">{money((amount * s.percent) / 100)}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-small" onClick={start} data-testid="deal-splits-edit">
            {splits.length ? t('splits.edit') : t('splits.split')}
          </button>
        </>
      ) : (
        <form
          className="split-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(rows.map((r) => ({ ownerId: r.ownerId, percent: Number(r.percent) })));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(false);
            }
          }}
        >
          {rows.map((r, i) => (
            <div key={i} className="split-row">
              <select
                className="filter-select"
                value={r.ownerId}
                aria-label={t('splits.owner', { n: i + 1 })}
                onChange={(e) => setRows((prev) => prev.map((x, k) => (k === i ? { ...x, ownerId: e.target.value } : x)))}
              >
                {people.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <input
                className="input mono split-pct"
                type="number"
                min={0}
                max={100}
                step="0.01"
                inputMode="decimal"
                value={r.percent}
                aria-label={t('splits.percent', { n: i + 1 })}
                onChange={(e) => setRows((prev) => prev.map((x, k) => (k === i ? { ...x, percent: e.target.value } : x)))}
              />
              <span className="muted">%</span>
              {rows.length > 1 && (
                <button type="button" className="icon-btn danger" onClick={() => setRows((prev) => prev.filter((_, k) => k !== i))} aria-label={t('splits.remove')}>
                  ✕
                </button>
              )}
            </div>
          ))}
          <p className={`num split-total${Math.abs(total - 100) > 0.01 ? ' is-off' : ''}`} aria-live="polite">
            {t('splits.total', { total: Math.round(total * 100) / 100 })}
          </p>
          {rows.length < 10 && (
            <button
              type="button"
              className="btn btn-ghost btn-small"
              // Sin más personas del workspace que sumar, el botón no hace nada: deshabilitado y con el motivo.
              disabled={!people.some((p) => !rows.some((r) => r.ownerId === p.value))}
              title={people.some((p) => !rows.some((r) => r.ownerId === p.value)) ? undefined : t('splits.noMorePeople')}
              data-testid="deal-split-add"
              onClick={() => {
                const used = new Set(rows.map((r) => r.ownerId));
                const next = people.find((p) => !used.has(p.value));
                if (next) setRows((prev) => [...prev, { ownerId: next.value, percent: '0' }]);
              }}
            >
              {t('splits.add')}
            </button>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-solid btn-small" disabled={busy} data-testid="deal-splits-save">
              {t('common.save')}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
            {splits.length > 0 && (
              <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => void save([])}>
                {t('splits.clear')}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
