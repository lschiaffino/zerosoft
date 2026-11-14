'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { DEFAULT_DISPLAY, DISPLAY_OPTIONS, isDefaultDisplay, type ChatDisplay, type DisplayChoice } from '@/lib/chat-display';
import Avatar from '@/components/groups/wa/Avatar';
import LinkPreview from '@/components/groups/wa/LinkPreview';
import { ImageView } from '@/components/groups/wa/MediaParts';
import { PhotoIcon } from '@/components/groups/wa/icons';
import { useChatStyle } from './ChatStyle';

/** Clases de la sección: las de ui.css (Lines) o las de Inbox (ib-*), como ChatStyleSection. */
const UI = { section: 'ui-section', head: 'ui-section-head', title: 'ui-section-title', help: 'ui-help' };
const INBOX = { section: 'ib-section', head: 'ib-section-head', title: 'ib-h2', help: 'ib-help' };

const CHOICES: DisplayChoice[] = ['textSize', 'linkPreviews', 'mediaSize', 'density', 'bubbleWidth', 'wallpaper'];

/** Imágenes de muestra (se dibujan en el navegador: no salen a ningún sitio). */
function useSampleImages(): { link: string; photo: string } {
  const [src, setSrc] = useState({ link: '', photo: '' });
  useEffect(() => {
    try {
      const draw = (w: number, h: number, paint: (g: CanvasRenderingContext2D) => void) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        if (!g) return '';
        paint(g);
        return c.toDataURL('image/png');
      };
      const link = draw(480, 252, (g) => {
        const grad = g.createLinearGradient(0, 0, 480, 252);
        grad.addColorStop(0, '#128c7e');
        grad.addColorStop(1, '#4051b5');
        g.fillStyle = grad;
        g.fillRect(0, 0, 480, 252);
      });
      // Una oficina con ventanal: cielo, edificios y el piso.
      const photo = draw(400, 300, (g) => {
        const sky = g.createLinearGradient(0, 0, 0, 300);
        sky.addColorStop(0, '#9cc9e8');
        sky.addColorStop(1, '#e8d9c0');
        g.fillStyle = sky;
        g.fillRect(0, 0, 400, 300);
        g.fillStyle = '#7d8c99';
        for (const [x, w, h] of [
          [20, 60, 120],
          [95, 45, 90],
          [150, 70, 150],
          [235, 50, 100],
          [300, 80, 135],
        ])
          g.fillRect(x, 215 - h, w, h);
        g.fillStyle = '#b08a5c';
        g.fillRect(0, 215, 400, 85);
        g.fillStyle = '#3d3a36';
        g.fillRect(0, 0, 400, 10);
        for (const x of [0, 132, 264, 392]) g.fillRect(x, 0, 8, 215);
      });
      setSrc({ link, photo });
    } catch {
      setSrc({ link: '', photo: '' });
    }
  }, []);
  return src;
}

/** Una fila de la lista de ejemplo, con las clases de la lista de chats de Lines. */
function SampleRow({ name, kind, seed, time, unread, active, children }: { name: string; kind: 'dm' | 'group'; seed: string; time: string; unread?: number; active?: boolean; children: ReactNode }) {
  return (
    <li className="gr-row-item">
      <span className={`gr-row${active ? ' is-active' : ''}${unread ? ' is-unread' : ''}`}>
        <Avatar name={name} kind={kind} seed={seed} />
        <span className="gr-row-main">
          <span className="gr-row-top">
            <span className="gr-row-name">{name}</span>
            <span className={`gr-row-time${unread ? ' is-unread' : ''}`}>{time}</span>
          </span>
          <span className="gr-row-bottom">
            <span className="gr-row-preview">{children}</span>
            {unread ? (
              <span className="gr-row-icons">
                <span className="gr-unread">{unread}</span>
              </span>
            ) : null}
          </span>
        </span>
      </span>
    </li>
  );
}

/**
 * Lleva la sección arriba de su contenedor con scroll (la página, o el panel que
 * scrollea), dejando libre la banda (scroll-margin-top). scrollIntoView también
 * movería contenedores con overflow oculto y dejaría un hueco arriba.
 */
function scrollToTop(el: HTMLElement) {
  let box: HTMLElement | null = el.parentElement;
  while (box && box !== document.body) {
    const o = getComputedStyle(box).overflowY;
    if ((o === 'auto' || o === 'scroll') && box.scrollHeight > box.clientHeight) break;
    box = box.parentElement;
  }
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  if (!box || box === document.body) {
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - margin });
    return;
  }
  box.scrollTo({ top: el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - margin });
}

/**
 * Ajuste "Visualización" de los chats (Inbox y Lines), por persona: tamaño
 * del texto, vista previa de links, fotos y videos, densidad de la lista,
 * ancho de los mensajes, fondo y avatares en grupos. Cada opción se ve en la
 * vista previa (una lista y un chat de grupo con las mismas clases que los
 * chats) y en los chats al instante, y se guarda sola. Se llega también desde
 * el menú ⋯ de un chat (#chat-display).
 */
export default function DisplaySection({ variant = 'ui' }: { variant?: 'ui' | 'inbox' }) {
  const c = variant === 'inbox' ? INBOX : UI;
  const t = useTranslations('inboxWa.display');
  const { style, display, setDisplay } = useChatStyle();
  const [state, setState] = useState<'' | 'saved' | 'error'>('');
  const sample = useSampleImages();
  const sectionRef = useRef<HTMLElement>(null);
  // Desde el menú de un chat se llega con #chat-display: la sección queda a la vista (también si la página carga después).
  useEffect(() => {
    if (window.location.hash !== '#chat-display') return;
    const id = requestAnimationFrame(() => sectionRef.current && scrollToTop(sectionRef.current));
    return () => cancelAnimationFrame(id);
  }, []);
  const pick = async (patch: Partial<ChatDisplay>) => {
    setState('');
    setState((await setDisplay(patch)) ? 'saved' : 'error');
  };
  return (
    <section ref={sectionRef} className={`${c.section} wa-display`} id="chat-display" aria-labelledby="chat-display-h">
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
          {/* Vista previa con las mismas clases y componentes que los chats: lo que cambia cada opción se ve acá. */}
          <div className="wa-display-preview">
            <p className="wa-display-preview-label" aria-hidden="true">
              {t('sample.preview')}
            </p>
            <div
              className="gr-inbox wa-display-sample"
              data-testid="display-sample"
              data-chat-style={style}
              data-text-size={display.textSize}
              data-density={display.density}
              data-link-previews={display.linkPreviews}
              data-media-size={display.mediaSize}
              data-bubble-width={display.bubbleWidth}
              data-wallpaper={display.wallpaper}
              data-group-avatars={display.groupAvatars ? 'on' : 'off'}
              aria-hidden="true"
              inert
            >
              <ul className="gr-rows wa-display-list">
                <SampleRow name={t('sample.group')} kind="group" seed="sample-group" time="10:42" unread={3} active>
                  <span className="gr-row-sender">{t('sample.author')}:</span>
                  <span>{t('sample.in')}</span>
                </SampleRow>
                <SampleRow name={t('sample.dm1')} kind="dm" seed="sample-bruno" time="09:15" unread={1}>
                  <PhotoIcon size={15} />
                  <span>{t('sample.dm1Preview')}</span>
                </SampleRow>
                <SampleRow name={t('sample.dm2')} kind="dm" seed="sample-carla" time={t('sample.yesterday')}>
                  <span>{t('sample.dm2Preview')}</span>
                </SampleRow>
              </ul>
              <div className="wa-messages">
                <div className="gr-msg gr-msg-in has-tail has-avatar" data-testid="display-sample-in">
                  <span className="wa-sender-avatar" aria-hidden="true">
                    <Avatar name={t('sample.author')} kind="dm" size={26} seed="sample-ana" />
                  </span>
                  <div className="gr-bubble">
                    <p className="gr-msg-author wa-n3">{t('sample.author')}</p>
                    <p className="gr-pre wa-text" data-testid="display-sample-text">
                      {t('sample.in')}
                    </p>
                  </div>
                </div>
                <div className="gr-msg gr-msg-in has-tail has-avatar">
                  <span className="wa-sender-avatar" aria-hidden="true">
                    <Avatar name={t('sample.photoAuthor')} kind="dm" size={26} seed="sample-bruno" />
                  </span>
                  <div className="gr-bubble is-media">
                    <p className="gr-msg-author wa-n1">{t('sample.photoAuthor')}</p>
                    {sample.photo && (
                      <div className="gr-media" data-testid="display-sample-photo">
                        <ImageView url={sample.photo} alt={t('sample.photoCaption')} width={400} height={300} />
                      </div>
                    )}
                  </div>
                </div>
                <div className="gr-msg gr-msg-out has-tail">
                  <div className="gr-bubble">
                    {sample.link && (
                      <LinkPreview
                        url="https://example.com/pricing"
                        given={{ url: 'https://example.com/pricing', title: t('sample.linkTitle'), description: t('sample.linkDesc'), image: sample.link, imageWidth: 1200, imageHeight: 630 }}
                      />
                    )}
                    <p className="gr-pre wa-text">{t('sample.out')} https://example.com/pricing</p>
                  </div>
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
