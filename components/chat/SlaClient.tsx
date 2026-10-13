'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

export interface SlaPolicyFormRow {
  priority: 'low' | 'medium' | 'high' | 'urgent';
  firstResponseMinutes: number;
  resolutionMinutes: number | null;
  isDefault: boolean;
}

interface SlaClientProps {
  widgetId: string;
  initialPolicies: SlaPolicyFormRow[];
}

const MAX_MINUTES = 43_200; // 30 días, igual que slaPoliciesUpdateSchema

function isValidMinutes(value: string, allowEmpty: boolean): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return allowEmpty;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 1 && n <= MAX_MINUTES;
}

export default function SlaClient({ widgetId, initialPolicies }: SlaClientProps) {
  const t = useTranslations('chat');
  const [rows, setRows] = useState(() =>
    initialPolicies.map((p) => ({
      priority: p.priority,
      firstResponse: String(p.firstResponseMinutes),
      resolution: p.resolutionMinutes != null ? String(p.resolutionMinutes) : '',
    })),
  );
  const [defaults, setDefaults] = useState(() => initialPolicies.map((p) => p.isDefault));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = rows.every(
    (r) => isValidMinutes(r.firstResponse, false) && isValidMinutes(r.resolution, true),
  );

  function updateRow(index: number, field: 'firstResponse' | 'resolution', value: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
    setSaved(false);
  }

  async function save() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/chat/widgets/${widgetId}/sla`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policies: rows.map((r) => ({
            priority: r.priority,
            firstResponseMinutes: Number(r.firstResponse.trim()),
            resolutionMinutes: r.resolution.trim() === '' ? null : Number(r.resolution.trim()),
          })),
        }),
      });
      if (!res.ok) throw new Error('save_failed');
      setDefaults(rows.map(() => false));
      setSaved(true);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="chat-section">
      <div className="chat-section-head">
        <p className="muted chat-section-sub">{t('sla.policiesNote')}</p>
        <div className="chat-sla-actions">
          {saved && <span className="chat-sla-saved muted">{t('sla.saved')}</span>}
          <button
            type="button"
            className="btn btn-solid btn-small"
            onClick={save}
            disabled={saving || !valid}
          >
            {saving ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="chat-sla-table-wrap">
        <table className="table chat-sla-table">
          <thead>
            <tr>
              <th>{t('sla.priority')}</th>
              <th>{t('sla.firstResponseMinutes')}</th>
              <th>{t('sla.resolutionMinutes')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.priority}>
                <td>
                  <span className="chat-sla-priority">{t(`priorities.${row.priority}`)}</span>
                  {defaults[i] && (
                    <span className="chat-sla-default muted">{t('sla.default')}</span>
                  )}
                </td>
                <td>
                  <input
                    className="input chat-sla-input"
                    type="number"
                    min={1}
                    max={MAX_MINUTES}
                    step={1}
                    value={row.firstResponse}
                    onChange={(e) => updateRow(i, 'firstResponse', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="input chat-sla-input"
                    type="number"
                    min={1}
                    max={MAX_MINUTES}
                    step={1}
                    placeholder="—"
                    value={row.resolution}
                    onChange={(e) => updateRow(i, 'resolution', e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
