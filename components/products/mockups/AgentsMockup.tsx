import { useTranslations } from 'next-intl';

const TOOLS = ['tool1', 'tool2', 'tool3', 'tool4'] as const;
/** Herramientas prendidas en este agente (la cuarta queda apagada). */
const TOOLS_ON = new Set<string>(['tool1', 'tool2', 'tool3']);

/** Vista de Agents: la configuración a la izquierda y una conversación con herramientas. */
export default function AgentsMockup() {
  const t = useTranslations('pages.mockups.agents');

  return (
    <div className="mk mk-agents">
      <aside className="mk-agents-side">
        <p className="mk-agents-name">{t('name')}</p>
        <span className="mk-status is-ok">
          <i />
          {t('status')}
        </span>
        <p className="mk-agents-h">{t('toolsTitle')}</p>
        <ul className="mk-agents-tools">
          {TOOLS.map((k) => (
            <li key={k} className={TOOLS_ON.has(k) ? 'on' : undefined}>
              <span>{t(k)}</span>
              <span className="mk-toggle" aria-hidden="true" />
            </li>
          ))}
        </ul>
        <p className="mk-agents-h">{t('knowledgeTitle')}</p>
        <p className="mk-agents-know">{t('knowledge')}</p>
      </aside>

      <div className="mk-chat-main">
        <div className="mk-chat-thread">
          <div className="mk-msg mk-msg-them">{t('m1')}</div>
          <p className="mk-tool-call">{t('call1')}</p>
          <div className="mk-msg mk-msg-us">{t('m2')}</div>
          <div className="mk-msg mk-msg-them">{t('m3')}</div>
          <p className="mk-tool-call">{t('call2')}</p>
          <div className="mk-msg mk-msg-us">{t('m4')}</div>
        </div>
        <div className="mk-chat-reply">
          <span className="mk-chat-reply-hint">{t('replyHint')}</span>
          <span className="mk-chat-send" aria-hidden="true">
            →
          </span>
        </div>
      </div>
    </div>
  );
}
