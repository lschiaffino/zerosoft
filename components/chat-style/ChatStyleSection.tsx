'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useChatStyle, type ChatStyle } from './ChatStyle';

/**
 * Ajuste "Estilo de chats": WhatsApp (la cara de WhatsApp Web) o zerosoft
 * (el mismo layout con los colores y la tipografía de la app). Se guarda por
 * persona y vale para Inbox y Lines.
 */
export default function ChatStyleSection({ className = 'ib-section' }: { className?: string }) {
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
      <h2 className="ib-h2" id="chat-style-h">
        {t('title')}
      </h2>
      <fieldset className="ib-fieldset">
        <legend className="ib-help">{t('help')}</legend>
        {(['whatsapp', 'zerosoft'] as const).map((s) => (
          <label key={s} className="ui-check">
            <input type="radio" name="chat-style" value={s} checked={style === s} onChange={() => void pick(s)} />
            <span>
              <strong>{t(`${s}.label`)}</strong> <span className="ib-dim">{t(`${s}.body`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {state === 'saved' && (
        <p className="ib-ok" role="status">
          {t('saved')}
        </p>
      )}
      {state === 'error' && (
        <p className="ib-error" role="alert">
          {t('error')}
        </p>
      )}
    </section>
  );
}
