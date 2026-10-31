'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatAgent } from '@/lib/chat-data';

/** Permisos de la bandeja: abierta a todo el workspace o solo admins y una lista de personas. */
export default function WidgetAccessClient(props: {
  widgetId: string;
  agents: ChatAgent[];
  initialRestricted: boolean;
  initialMembers: string[];
  canManage: boolean;
}) {
  const t = useTranslations('chat');
  const [restricted, setRestricted] = useState(props.initialRestricted);
  const [members, setMembers] = useState(props.initialMembers);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function save() {
    setState('saving');
    try {
      const res = await fetch(`/api/chat/widgets/${props.widgetId}/access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restricted, memberIds: members }),
      });
      setState(res.ok ? 'saved' : 'error');
    } catch {
      setState('error');
    }
  }

  return (
    <section className="chat-pane" aria-labelledby="chat-access-title">
      <h2 id="chat-access-title" className="ui-section-title">
        {t('access.title')}
      </h2>
      <p className="ui-help">{t('access.sub')}</p>
      {!props.canManage && <p className="ui-help">{t('access.adminOnly')}</p>}
      <div className="ui-fields chat-stack">
        <label className="ui-switch">
          <input
            type="checkbox"
            role="switch"
            disabled={!props.canManage}
            checked={restricted}
            onChange={(e) => {
              setRestricted(e.target.checked);
              setState('idle');
            }}
          />
          {t('access.restricted')}
        </label>
        {restricted && (
          <fieldset className="ui-field chat-team-members">
            <legend className="label">{t('access.members')}</legend>
            <p className="ui-help">{t('access.membersHelp')}</p>
            {props.agents.map((a) => (
              <label key={a.id} className="ui-check">
                <input
                  type="checkbox"
                  disabled={!props.canManage}
                  checked={members.includes(a.id)}
                  onChange={(e) => {
                    setMembers((m) => (e.target.checked ? [...m, a.id] : m.filter((x) => x !== a.id)));
                    setState('idle');
                  }}
                />
                {a.name || a.email}
              </label>
            ))}
          </fieldset>
        )}
        {props.canManage && (
          <div>
            <button type="button" className="btn btn-primary" disabled={state === 'saving'} onClick={() => void save()}>
              {t('common.save')}
            </button>
          </div>
        )}
        <p className={state === 'error' ? 'ui-error' : 'ui-help chat-ok'} role="status" aria-live="polite">
          {state === 'saved' ? t('access.saved') : state === 'error' ? t('errors.generic') : ''}
        </p>
      </div>
    </section>
  );
}
