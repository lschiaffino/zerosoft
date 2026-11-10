'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { AutoJoinRule, CallsSettings as Settings, Methodology } from '@/lib/calls/types';
import { api, useErrorText, useToast } from './ui';

const METHODS: Methodology[] = ['spiced', 'meddic', 'bant', 'custom'];
const RULES: AutoJoinRule[] = ['external', 'deals', 'all', 'manual'];

/** Ajustes de Calls: la regla propia de grabación y, para admins, los del workspace. */
export default function CallsSettings({ initial, autoJoin, admin, botConfigured, storageConfigured }: { initial: Settings; autoJoin: AutoJoinRule; admin: boolean; botConfigured: boolean; storageConfigured: boolean }) {
  const t = useTranslations('calls.settings');
  const tu = useTranslations('calls.upcoming');
  const tm = useTranslations('calls.methodology');
  const err = useErrorText();
  const [toast, push] = useToast();
  const [rule, setRule] = useState(autoJoin);
  const [s, setS] = useState(initial);
  const [criteria, setCriteria] = useState(initial.customCriteria.join('\n'));
  const [competitors, setCompetitors] = useState(initial.competitors.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveRule = async (r: AutoJoinRule) => {
    setRule(r);
    const res = await api('/api/calls/settings', { method: 'PUT', json: { autoJoin: r } });
    if (!res.ok) return push(err(res.data.error), 'bad');
    push(t('saved'));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await api<{ settings?: Settings }>('/api/calls/settings', {
      method: 'PUT',
      json: {
        methodology: s.methodology,
        customCriteria: criteria.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 12),
        competitors: competitors.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 50),
        visibility: s.visibility,
        botName: s.botName,
        consentMessage: s.consentMessage,
        logToCrm: s.logToCrm,
        talkChannel: s.talkChannel,
      },
    });
    setBusy(false);
    if (!res.ok || !res.data.settings) return setError(err(res.data.error));
    setS(res.data.settings);
    push(t('saved'));
  };

  return (
    <div className="app-page ui-page cl-page cl-narrow">
      {toast}
      <PageHeader title={t('title')} description={t('desc')} />
      <section className="ui-section">
        <div className="ui-section-body">
          <div className="ui-section-head">
            <h2 className="ui-section-title">{t('statusTitle')}</h2>
          </div>
          <ul className="cl-list">
            <li data-testid="calls-bot-status">{botConfigured ? t('botOk') : t('botMissing')}</li>
            <li>{storageConfigured ? t('storageOk') : t('storageMissing')}</li>
            <li>
              {t('calendarHelp')} <Link href="/app/calendar/settings">{t('calendarLink')}</Link>
            </li>
          </ul>
        </div>
      </section>

      <section className="ui-section">
        <div className="ui-section-body">
          <div className="ui-section-head">
            <h2 className="ui-section-title">{t('personalTitle')}</h2>
            <p className="ui-section-desc">{t('personalDesc')}</p>
          </div>
          <fieldset className="cl-rules">
            <legend className="sr-only">{tu('ruleLabel')}</legend>
            {RULES.map((r) => (
              <label key={r} className="cl-rule">
                <input type="radio" name="cl-settings-rule" value={r} checked={rule === r} onChange={() => void saveRule(r)} />
                <span>
                  <strong>{tu(`rules.${r}`)}</strong>
                  <small>{tu(`rulesHelp.${r}`)}</small>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      </section>

      <form onSubmit={save} className="ui-section" data-testid="calls-settings-form">
        <fieldset disabled={!admin} className="cl-fieldset">
          <div className="ui-section-body">
            <div className="ui-section-head">
              <h2 className="ui-section-title">{t('workspaceTitle')}</h2>
              <p className="ui-section-desc">{admin ? t('workspaceDesc') : t('adminOnly')}</p>
            </div>
            <div className="ui-field">
              <label htmlFor="cl-method">{t('methodology')}</label>
              <select id="cl-method" className="select" value={s.methodology} onChange={(e) => setS({ ...s, methodology: e.target.value as Methodology })} data-testid="calls-methodology">
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {tm(`name.${m}`)}
                  </option>
                ))}
              </select>
              <p className="ui-help">{tm(`help.${s.methodology}`)}</p>
            </div>
            {s.methodology === 'custom' && (
              <div className="ui-field">
                <label htmlFor="cl-criteria">{t('customCriteria')}</label>
                <textarea id="cl-criteria" className="textarea" rows={5} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
                <p className="ui-help">{t('customHelp')}</p>
              </div>
            )}
            <div className="ui-field">
              <label htmlFor="cl-competitors">{t('competitors')}</label>
              <input id="cl-competitors" className="input" value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="Gong, Chorus, Fireflies" />
              <p className="ui-help">{t('competitorsHelp')}</p>
            </div>
            <div className="ui-field">
              <label htmlFor="cl-visibility">{t('visibility')}</label>
              <select id="cl-visibility" className="select" value={s.visibility} onChange={(e) => setS({ ...s, visibility: e.target.value as Settings['visibility'] })}>
                <option value="team">{t('visibilityTeam')}</option>
                <option value="private">{t('visibilityPrivate')}</option>
              </select>
            </div>
            <div className="ui-field">
              <label htmlFor="cl-botname">{t('botName')}</label>
              <input id="cl-botname" className="input" maxLength={60} value={s.botName} onChange={(e) => setS({ ...s, botName: e.target.value })} />
            </div>
            <div className="ui-field">
              <label htmlFor="cl-consent">{t('consent')}</label>
              <textarea id="cl-consent" className="textarea" rows={3} maxLength={500} value={s.consentMessage} onChange={(e) => setS({ ...s, consentMessage: e.target.value })} placeholder={t('consentPlaceholder')} />
              <p className="ui-help">{t('consentHelp')}</p>
            </div>
            <label className="ui-check">
              <input type="checkbox" checked={s.logToCrm} onChange={(e) => setS({ ...s, logToCrm: e.target.checked })} />
              {t('logToCrm')}
            </label>
            <div className="ui-field">
              <label htmlFor="cl-channel">{t('talkChannel')}</label>
              <input id="cl-channel" className="input" maxLength={80} value={s.talkChannel} onChange={(e) => setS({ ...s, talkChannel: e.target.value })} placeholder="#sales" />
              <p className="ui-help">{t('talkHelp')}</p>
            </div>
            <p className="ui-help">
              {t('webhooksHelp')} <Link href="/app/settings/api#webhooks">{t('webhooksLink')}</Link>
            </p>
          </div>
          <div className="ui-section-foot">
            <p className="ui-section-note" role={error ? 'alert' : undefined} data-tone={error ? 'error' : undefined}>
              {error}
            </p>
            <button type="submit" className="btn btn-primary" disabled={busy} data-testid="calls-settings-save">
              {busy ? t('saving') : t('save')}
            </button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
