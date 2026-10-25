'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import EmptyState from '@/components/ui/EmptyState';
import { HOUSEKEEPING_MONTHS } from '@/lib/track-planning-schema';
import { api, fmtWhen, LoadingRows } from './shared';

interface Automation {
  autoCloseMonths: number;
  autoCloseStatusId: string | null;
  autoArchiveMonths: number;
  closeStatuses: Array<{ id: string; name: string; category: string }>;
  archived: { rows: Array<{ id: string; identifier: string; title: string; status_name: string | null; archived_at: string }>; total: number };
  staleCount: number;
}

/** Ajustes › Automatizaciones: auto-cierre y auto-archivo por proyecto (team) y el archivo para restaurar. */
export default function AutomationSettings({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations('trackPlanning');
  const [teams, setTeams] = useState<Array<{ id: string; name: string }> | null>(null);
  const [team, setTeam] = useState('');
  useEffect(() => {
    void api<{ teams: Array<{ id: string; name: string }> }>('/api/track/plans?meta=only').then((r) => {
      const list = r.ok ? r.data.teams : [];
      setTeams(list);
      setTeam(list[0]?.id ?? '');
    });
  }, []);
  return (
    <div data-testid="tp-automation">
      <FormSection title={t('automation.title')} description={t('automation.help')} footer={!isAdmin ? <span className="ui-section-note">{t('automation.adminOnly')}</span> : undefined}>
        {teams === null ? (
          <LoadingRows rows={2} />
        ) : teams.length === 0 ? (
          <EmptyState quiet title={t('automation.noTeams')} action={{ label: t('cycles.goTeams'), href: '/app/track/projects' }} />
        ) : (
          <>
            <div className="ui-field">
              <label className="label" htmlFor="tp-auto-team">
                {t('automation.team')}
              </label>
              <select id="tp-auto-team" className="select" value={team} onChange={(e) => setTeam(e.target.value)}>
                {teams.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            {team && <TeamAutomation key={team} projectId={team} isAdmin={isAdmin} />}
          </>
        )}
      </FormSection>
    </div>
  );
}

function TeamAutomation({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  const t = useTranslations('trackPlanning');
  const locale = useLocale();
  const [data, setData] = useState<Automation | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<Automation>(`/api/track/projects/${projectId}/automation`);
    setFailed(!res.ok);
    if (res.ok) setData(res.data);
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (body: Record<string, unknown>) => {
    setError(null);
    const res = await api<Automation>(`/api/track/projects/${projectId}/automation`, 'PUT', body);
    if (!res.ok) return setError(res.status === 403 ? t('automation.adminOnly') : t('common.saveError'));
    setData(res.data);
    setNotice(t('automation.saved'));
  };

  const restore = async (ids: string[]) => {
    const res = await api<{ restored: number }>('/api/track/archive', 'POST', { issueIds: ids });
    if (!res.ok) return setError(t('common.saveError'));
    setNotice(t('automation.restored', { count: res.data.restored }));
    await load();
  };

  if (failed)
    return (
      <EmptyState
        quiet
        title={t('common.loadError')}
        action={
          <button type="button" className="btn btn-primary" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        }
      />
    );
  if (!data) return <LoadingRows rows={3} />;
  const monthLabel = (m: number) => (m === 0 ? t('automation.off') : t('automation.months', { count: m }));
  return (
    <div className="tp-automation">
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="ui-help" role="status">
          {notice}
        </p>
      )}
      <div className="tp-form-grid">
        <div className="ui-field">
          <label className="label" htmlFor="tp-auto-close">
            {t('automation.autoClose')}
          </label>
          <select id="tp-auto-close" className="select" value={data.autoCloseMonths} disabled={!isAdmin} onChange={(e) => void save({ autoCloseMonths: Number(e.target.value) })} data-testid="tp-auto-close">
            {HOUSEKEEPING_MONTHS.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <p className="ui-help">{t('automation.autoCloseHelp')}</p>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="tp-auto-status">
            {t('automation.closeStatus')}
          </label>
          <select
            id="tp-auto-status"
            className="select"
            value={data.autoCloseStatusId ?? ''}
            disabled={!isAdmin || data.autoCloseMonths === 0}
            onChange={(e) => void save({ autoCloseStatusId: e.target.value || null })}
          >
            <option value="">{t('automation.firstCancelled')}</option>
            {data.closeStatuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {data.autoCloseMonths > 0 && <p className="ui-help" data-testid="tp-stale-count">{t('automation.staleCount', { count: data.staleCount })}</p>}
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="tp-auto-archive">
            {t('automation.autoArchive')}
          </label>
          <select id="tp-auto-archive" className="select" value={data.autoArchiveMonths} disabled={!isAdmin} onChange={(e) => void save({ autoArchiveMonths: Number(e.target.value) })} data-testid="tp-auto-archive">
            {HOUSEKEEPING_MONTHS.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <p className="ui-help">{t('automation.autoArchiveHelp')}</p>
        </div>
      </div>
      <p className="ui-help">{t('automation.cyclesHelp')}</p>

      <h3 className="tp-card-title">{t('automation.archived', { count: data.archived.total })}</h3>
      {data.archived.rows.length === 0 ? (
        <p className="ui-help">{t('automation.archivedEmpty')}</p>
      ) : (
        <>
          <ul className="tp-issue-rows" role="list" data-testid="tp-archived">
            {data.archived.rows.map((i) => (
              <li key={i.id} className="tp-issue-row">
                <span className="track-identifier">{i.identifier}</span>
                <span className="tp-issue-title">{i.title}</span>
                <span className="tp-issue-meta">{i.status_name}</span>
                <span className="tp-issue-meta">{fmtWhen(i.archived_at, locale)}</span>
                <button type="button" className="btn btn-sm" onClick={() => void restore([i.id])}>
                  {t('automation.restore')}
                </button>
              </li>
            ))}
          </ul>
          {data.archived.rows.length > 1 && (
            <button type="button" className="btn btn-sm" onClick={() => void restore(data.archived.rows.map((r) => r.id))}>
              {t('automation.restoreAll')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
