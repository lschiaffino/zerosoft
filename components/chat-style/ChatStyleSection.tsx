'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useChatStyle, type ChatStyle } from './ChatStyle';

/**
 * Ajuste "Estilo de chats": WhatsApp (la cara de WhatsApp Web) o zerosoft
 * (el mismo layout con los colores y la tipografía de la app). Se guarda por
 * persona y vale para Inbox y Lines. Con las clases comunes de ui.css.
 */
/** Clases de la sección: por defecto las de ui.css; Inbox pasa las suyas (ib-*) para verse igual que sus otras secciones. */
const UI = { section: 'ui-section', head: 'ui-section-head', title: 'ui-section-title', help: 'ui-help', list: 'ui-fields' };
const INBOX = { section: 'ib-section', head: 'ib-section-head', title: 'ib-h2', help: 'ib-help', list: 'ib-style-options' };

export default function ChatStyleSection({ variant = 'ui' }: { variant?: 'ui' | 'inbox' }) {
  const c = variant === 'inbox' ? INBOX : UI;
  const t = useTranslations('inboxWa.chatStyle');
  const { style, setStyle } = useChatStyle();
  const [state, setState] = useState<'' | 'saved' | 'error'>('');
  const pick = async (s: ChatStyle) => {
    if (s === style) return;
    setState('');
    setState((await setStyle(s)) ? 'saved' : 'error');
  };
  return (
    <section className={c.section} id="chat-style" aria-labelledby="chat-style-h">
      <div className={variant === 'inbox' ? 'wa-contents' : 'ui-section-body'}>
        <div className={c.head}>
          <h2 className={c.title} id="chat-style-h">
            {t('title')}
          </h2>
        </div>
        <p className={c.help}>{t('help')}</p>
        <div role="radiogroup" aria-labelledby="chat-style-h" className={c.list}>
          {(['whatsapp', 'zerosoft'] as const).map((s) => (
            <label key={s} className="ui-check">
              <input type="radio" name="chat-style" value={s} checked={style === s} onChange={() => void pick(s)} />
              <span>
                <strong>{t(`${s}.label`)}</strong> · <span className={c.help}>{t(`${s}.body`)}</span>
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
      </div>
    </section>
  );
}
