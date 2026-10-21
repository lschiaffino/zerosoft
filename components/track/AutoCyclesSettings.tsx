'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TrackProjectRow } from '@/lib/db';

interface AutoCyclesSettingsProps {
  project: TrackProjectRow;
  isAdmin: boolean;
  /** El proyecto guardado (y, si se activó, los cycles nuevos ya creados). */
  onSaved: (project: TrackProjectRow) => void | Promise<void>;
}

const WEEKS = [1, 2, 3, 4, 6, 8];

/**
 * Cycles automáticos del proyecto (arriba del panel de ciclos): activar,
 * duración en semanas y nombre. Al activarlos el server crea ya el actual y
 * el próximo; después el tick diario los mantiene y arrastra lo sin terminar.
 */
export default function AutoCyclesSettings({ project, isAdmin, onSaved }: AutoCyclesSettingsProps) {
  const t = useTranslations('track');
  const [enabled, setEnabled] = useState(Boolean(project.cycle_auto));
  const [weeks, setWeeks] = useState(project.cycle_weeks ?? 2);
  const [prefix, setPrefix] = useState(project.cycle_name || t('autoCycles.defaultPrefix'));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'saved' | 'error' | null>(null);
  const dirty =
    enabled !== Boolean(project.cycle_auto) ||
    weeks !== (project.cycle_weeks ?? 2) ||
    prefix.trim() !== (project.cycle_name || t('autoCycles.defaultPrefix'));

  async function save(nextEnabled = enabled) {
    if (!isAdmin || busy) return;
    setBusy(true);
    setStatus(null);
    const res = await fetch(`/api/track/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cycleAuto: nextEnabled,
        cycleWeeks: weeks,
        cycleName: prefix.trim() || t('autoCycles.defaultPrefix'),
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setStatus('error');
      return;
    }
    setStatus('saved');
    await onSaved((await res.json()) as TrackProjectRow);
  }

  return (
    <div className="track-auto-cycles" data-testid="track-auto-cycles">
      <label className="ui-switch">
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={!isAdmin || busy}
          onChange={(e) => {
            setEnabled(e.target.checked);
            void save(e.target.checked);
          }}
          aria-describedby="track-auto-cycles-help"
          data-testid="track-auto-cycles-toggle"
        />
        {t('autoCycles.enable')}
      </label>
      <p className="ui-help" id="track-auto-cycles-help">
        {t('autoCycles.help')}
      </p>
      {enabled && (
        <div className="ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor="track-auto-cycles-weeks">
              {t('autoCycles.length')}
            </label>
            <select
              id="track-auto-cycles-weeks"
              className="select"
              value={weeks}
              disabled={!isAdmin}
              onChange={(e) => setWeeks(Number(e.target.value))}
            >
              {WEEKS.map((w) => (
                <option key={w} value={w}>
                  {t('autoCycles.weeks', { count: w })}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="track-auto-cycles-prefix">
              {t('autoCycles.prefix')}
            </label>
            <input
              id="track-auto-cycles-prefix"
              className="input"
              value={prefix}
              maxLength={40}
              disabled={!isAdmin}
              onChange={(e) => setPrefix(e.target.value)}
              aria-describedby="track-auto-cycles-prefix-help"
            />
            <p className="ui-help" id="track-auto-cycles-prefix-help">
              {t('autoCycles.prefixHelp')}
            </p>
          </div>
        </div>
      )}
      {enabled && isAdmin && dirty && (
        <div className="track-inline-form-actions">
          <button type="button" className="btn btn-sm" onClick={() => void save()} aria-busy={busy || undefined}>
            {t('autoCycles.save')}
          </button>
        </div>
      )}
      <p className="ui-help" role="status">
        {status === 'saved' ? t('autoCycles.saved') : status === 'error' ? t('autoCycles.error') : !isAdmin ? t('autoCycles.adminOnly') : ''}
      </p>
    </div>
  );
}
