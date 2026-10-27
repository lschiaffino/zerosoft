'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { AgentBlockedVisitorDto } from '@/lib/agents-privacy';
import { parseDbUtc } from '@/lib/utils';
import { api, errorText } from './agents-ui';

/** Visitantes bloqueados desde Conversaciones, con "Desbloquear". */
export default function AgentBlocked({ agentId }: { agentId: string }) {
  const t = useTranslations('agents');
  const format = useFormatter();
  const [list, setList] = useState<AgentBlockedVisitorDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<{ blocked?: AgentBlockedVisitorDto[] }>(`/api/agents/${agentId}/blocked`).then((res) => {
      if (cancelled) return;
      if (res.ok) setList(res.data.blocked ?? []);
      else setError(errorText(t, res.data.error));
    });
    return () => {
      cancelled = true;
    };
  }, [agentId, t]);

  async function unblock(id: string) {
    const res = await api<{ blocked?: AgentBlockedVisitorDto[] }>(`/api/agents/${agentId}/blocked`, { method: 'POST', body: JSON.stringify({ unblock: id }) });
    if (res.ok) setList(res.data.blocked ?? []);
    else setError(errorText(t, res.data.error));
  }

  return (
    <div className="ui-field">
      <p className="label">{t('settings.blockedVisitors')}</p>
      {error ? (
        <p className="ui-error" role="alert">
          {error}
        </p>
      ) : list === null ? (
        <span className="ui-skeleton ui-skeleton-row" aria-busy="true" />
      ) : list.length === 0 ? (
        <p className="ui-help">{t('settings.blockedVisitorsEmpty')}</p>
      ) : (
        <ul className="ag-rows">
          {list.map((b) => (
            <li key={b.id} className="ag-url">
              <div className="ag-url-main">
                <span className="ag-url-title">{b.label || t('conversations.untitled')}</span>
                <span className="ui-help">
                  {t(`settings.blockKinds.${b.kind === 'chat' ? 'chat' : 'public'}`)} ·{' '}
                  {format.dateTime(parseDbUtc(b.createdAt), { dateStyle: 'medium' })}
                </span>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void unblock(b.id)}>
                {t('settings.unblock')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
