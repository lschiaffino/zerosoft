'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { ProjectDto } from '@/lib/analytics/types';
import { api, apiErrorText, notifyChanged } from '../client';

const RATES = [100, 50, 25, 10, 5, 1];

/** Session replay y heatmaps del proyecto: apagados por defecto, los prende un admin. */
export default function ReplaySettings({ project, canManage }: { project: ProjectDto; canManage: boolean }) {
  const t = useTranslations('analyticsReplay.settings');
  const tc = useTranslations('analytics.common');
  const router = useRouter();
  const initial = () => ({
    replayEnabled: project.replayEnabled,
    replaySampleRate: project.replaySampleRate,
    replayMaskText: project.replayMaskText,
    heatmapsEnabled: project.heatmapsEnabled,
  });
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setForm(initial()), [project]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/analytics/projects/${project.id}`, { method: 'PATCH', body: form });
      setMsg({ ok: true, text: t('saved') });
      notifyChanged();
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: apiErrorText(err, tc) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      id="replay"
      className="ui-section an-replay-settings"
      aria-labelledby="an-replay-settings-h"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="ui-section-head">
        <h2 id="an-replay-settings-h" className="ui-section-title">
          {t('title')}
        </h2>
        <p className="ui-section-desc">{canManage ? t('desc') : t('adminsOnly')}</p>
      </div>
      <fieldset className="ui-section-body ui-fields" disabled={!canManage}>
        <label className="ui-check">
          <input type="checkbox" data-testid="an-replay-enabled" checked={form.replayEnabled} onChange={(e) => setForm({ ...form, replayEnabled: e.target.checked })} /> {t('enable')}
        </label>
        <p className="ui-help">{t('enableHelp')}</p>
        <label className="ui-field">
          <span className="label">{t('sampleRate')}</span>
          <select className="select an-replay-rate" value={form.replaySampleRate} disabled={!form.replayEnabled} onChange={(e) => setForm({ ...form, replaySampleRate: Number(e.target.value) })}>
            {[...new Set([...RATES, form.replaySampleRate])].sort((a, b) => b - a).map((r) => (
              <option key={r} value={r}>
                {t('percent', { n: r })}
              </option>
            ))}
          </select>
          <span className="ui-help">{t('sampleRateHelp')}</span>
        </label>
        <label className="ui-check">
          <input type="checkbox" checked={form.replayMaskText} disabled={!form.replayEnabled} onChange={(e) => setForm({ ...form, replayMaskText: e.target.checked })} /> {t('maskText')}
        </label>
        <p className="ui-help">{t('maskTextHelp')}</p>
        <label className="ui-check">
          <input type="checkbox" data-testid="an-heatmaps-enabled" checked={form.heatmapsEnabled} onChange={(e) => setForm({ ...form, heatmapsEnabled: e.target.checked })} /> {t('heatmaps')}
        </label>
        <p className="ui-help">{project.autocapture ? t('heatmapsHelp') : t('heatmapsNeedsAutocapture')}</p>
        {canManage && (
          <div className="an-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {tc('save')}
            </button>
            {msg && (
              <span className={msg.ok ? 'an-saved' : 'ui-error'} role={msg.ok ? 'status' : 'alert'}>
                {msg.text}
              </span>
            )}
          </div>
        )}
      </fieldset>
    </form>
  );
}
