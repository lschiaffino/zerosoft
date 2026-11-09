'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useChatStyle, type ChatStyle } from './ChatStyle';

/**
 * Ajuste "Estilo de chats": WhatsApp (la cara de WhatsApp Web) o zerosoft
 * (el mismo layout con los colores y la tipografía de la app). Se guarda por
 * persona y vale para Inbox y Lines. Con las clases comunes de ui.css.
 */
export default function ChatStyleSection({ className = 'ui-section' }: { className?: string }) {
  const t = useTranslations('inboxWa.chatStyle');
  const { style, setStyle } = useChatStyle();
  const [state, setState] = useState<'' | 'saved' | 'error'>('');
  const pick = async (s: ChatStyle) => {
    if (s === style) return;
    setState('');
    setState((await setStyle(s)) ? 'saved' : 'error');
  };
  return (
    <section className={className} id="chat-style" aria-labelledby="chat-style-h">
      <div className="ui-section-head">
        <h2 className="ui-section-title" id="chat-style-h">
          {t('title')}
        </h2>
        <p className="ui-help">{t('help')}</p>
      </div>
      <div role="radiogroup" aria-labelledby="chat-style-h" className="ui-fields">
        {(['whatsapp', 'zerosoft'] as const).map((s) => (
          <label key={s} className="ui-check">
            <input type="radio" name="chat-style" value={s} checked={style === s} onChange={() => void pick(s)} />
            <span>
              <strong>{t(`${s}.label`)}</strong> · <span className="ui-help">{t(`${s}.body`)}</span>
            </span>
          </label>
        ))}
      </div>
      {state === 'saved' && (
        <p className="ui-help" role="status">
          {t('saved')}
        </p>
      )}
      {state === 'error' && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
    </section>
  );
}
