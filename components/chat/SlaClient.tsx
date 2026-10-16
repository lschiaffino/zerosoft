'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import { SLA_MAX_MINUTES as MAX_MINUTES, isValidMinutes } from './widget-form-model';

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

/** Objetivos de SLA por prioridad: una tabla de minutos con un solo Guardar. */
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

  function updateRow(index: number, field: 'firstResponse' | 'resolution', value: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  async function save(): Promise<string | void> {
    const valid = rows.every((r) => isValidMinutes(r.firstResponse, false) && isValidMinutes(r.resolution, true));
    if (!valid) return t('sla.invalid', { max: MAX_MINUTES });
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
    }).catch(() => null);
    if (!res?.ok) return t('errors.generic');
    setDefaults(rows.map(() => false));
  }

  return (
    <FormSection title={t('sla.policies')} description={t('sla.policiesNote')} note={t('sla.minutesNote')} onSubmit={save}>
      <div className="table-wrap">
        <table className="table chat-sla-table">
          <thead>
            <tr>
              <th scope="col">{t('sla.priority')}</th>
              <th scope="col">{t('sla.firstResponseMinutes')}</th>
              <th scope="col">{t('sla.resolutionMinutes')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const label = t(`priorities.${row.priority}`);
              const badFirst = !isValidMinutes(row.firstResponse, false);
              const badRes = !isValidMinutes(row.resolution, true);
              return (
                <tr key={row.priority}>
                  <th scope="row" className="chat-sla-priority">
                    {label}
                    {defaults[i] && <span className="badge badge-outline">{t('sla.default')}</span>}
                  </th>
                  <td>
                    <input
                      className="input data chat-sla-input"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_MINUTES}
                      step={1}
                      required
                      aria-label={`${label}: ${t('sla.firstResponseMinutes')}`}
                      aria-invalid={badFirst || undefined}
                      value={row.firstResponse}
                      onChange={(e) => updateRow(i, 'firstResponse', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="input data chat-sla-input"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_MINUTES}
                      step={1}
                      placeholder={t('sla.noTarget')}
                      aria-label={`${label}: ${t('sla.resolutionMinutes')}`}
                      aria-invalid={badRes || undefined}
                      value={row.resolution}
                      onChange={(e) => updateRow(i, 'resolution', e.target.value)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </FormSection>
  );
}
