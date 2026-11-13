'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DEFAULT_DISPLAY, DISPLAY_OPTIONS, isDefaultDisplay, type ChatDisplay, type DisplayChoice } from '@/lib/chat-display';
import Avatar from '@/components/groups/wa/Avatar';
import LinkPreview from '@/components/groups/wa/LinkPreview';
import { useChatStyle } from './ChatStyle';

/** Clases de la sección: las de ui.css (Lines) o las de Inbox (ib-*), como ChatStyleSection. */
const UI = { section: 'ui-section', head: 'ui-section-head', title: 'ui-section-title', help: 'ui-help' };
const INBOX = { section: 'ib-section', head: 'ib-section-head', title: 'ib-h2', help: 'ib-help' };

const CHOICES: DisplayChoice[] = ['textSize', 'linkPreviews', 'mediaSize', 'density', 'bubbleWidth', 'wallpaper'];

/** Imagen de muestra para la tarjeta del ejemplo (se dibuja en el navegador: no sale a ningún sitio). */
function useSampleImage(): string {
  const [src, setSrc] = useState('');
  useEffect(() => {
    try {
      const c = document.createElement('canvas');
      c.width = 480;
      c.height = 252;
      const g = c.getContext('2d');
      if (!g) return;
      const grad = g.createLinearGradient(0, 0, 480, 252);
      grad.addColorStop(0, '#128c7e');
      grad.addColorStop(1, '#4051b5');
      g.fillStyle = grad;
      g.fillRect(0, 0, 480, 252);
      setSrc(c.toDataURL('image/png'));
    } catch {
      setSrc('');
    }
  }, []);
  return src;
}

/**
 * Ajuste "Visualización" de los chats (Inbox y Lines), por persona: tamaño
 * del texto, vista previa de links, fotos y videos, densidad de la lista,
 * ancho de los mensajes, fondo y avatares en grupos. Cada cambio se ve en el
 * ejemplo de abajo y en los chats al instante, y se guarda solo.
 */
export default function DisplaySection({ variant = 'ui' }: { variant?: 'ui' | 'inbox' }) {
  const c = variant === 'inbox' ? INBOX : UI;
  const t = useTranslations('inboxWa.display');
  const { style, display, setDisplay } = useChatStyle();
  const [state, setState] = useState<'' | 'saved' | 'error'>('');
  const sample = useSampleImage();
  const pick = async (patch: Partial<ChatDisplay>) => {
    setState('');
    setState((await setDisplay(patch)) ? 'saved' : 'error');
  };
  return (
    <section className={`${c.section} wa-display`} id="chat-display" aria-labelledby="chat-display-h">
      <div className={variant === 'inbox' ? 'wa-contents' : 'ui-section-body'}>
        <div className={`${c.head} wa-display-head`}>
          <h2 className={c.title} id="chat-display-h">
            {t('title')}
          </h2>
          {!isDefaultDisplay(display) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void pick(DEFAULT_DISPLAY)}>
              {t('reset')}
            </button>
          )}
        </div>
        <p className={c.help}>{t('help')}</p>
        <div className="wa-display-grid">
          <div className="wa-display-options">
            {CHOICES.map((key) => (
              <div key={key} className="wa-display-row" role="group" aria-labelledby={`wa-display-${key}`}>
                <span className="wa-display-label" id={`wa-display-${key}`}>
                  {t(`${key}.label`)}
                </span>
                <span className="btn-group wa-display-seg">
                  {(DISPLAY_OPTIONS[key] as readonly string[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      className="btn btn-secondary btn-sm"
                      aria-pressed={display[key] === v}
                      data-option={`${key}-${v}`}
                      onClick={() => display[key] !== v && void pick({ [key]: v } as Partial<ChatDisplay>)}
                    >
                      {t(`${key}.${v}`)}
                    </button>
                  ))}
                </span>
              </div>
            ))}
            <label className="ui-check wa-display-check">
              <input type="checkbox" checked={display.groupAvatars} onChange={(e) => void pick({ groupAvatars: e.target.checked })} />
              <span>{t('groupAvatars')}</span>
            </label>
          </div>
          {/* Ejemplo en vivo con las mismas clases que los chats. */}
          <div className="gr-inbox wa-display-sample" data-chat-style={style} aria-hidden="true" inert>
            <div className="wa-messages">
              <div className="gr-msg gr-msg-in has-tail has-avatar">
                <span className="wa-sender-avatar" aria-hidden="true">
                  <Avatar name={t('sample.author')} kind="dm" size={26} seed="sample-ana" />
                </span>
                <div className="gr-bubble">
                  <p className="gr-msg-author wa-n3">{t('sample.author')}</p>
                  <p className="gr-pre wa-text">{t('sample.in')}</p>
                </div>
              </div>
              <div className="gr-msg gr-msg-out has-tail">
                <div className="gr-bubble">
                  {sample && (
                    <LinkPreview
                      url="https://example.com/pricing"
                      given={{ url: 'https://example.com/pricing', title: t('sample.linkTitle'), description: t('sample.linkDesc'), image: sample, imageWidth: 1200, imageHeight: 630 }}
                    />
                  )}
                  <p className="gr-pre wa-text">{t('sample.out')} https://example.com/pricing</p>
                </div>
              </div>
            </div>
          </div>
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
