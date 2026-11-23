'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { WaPersonCard } from '@/lib/wa-person';
import { sharedTotal } from '@/lib/wa-person';
import Avatar from './Avatar';
import MediaViewer, { type ViewerItem } from './MediaViewer';
import { ArrowLeft, Ban, ChatIcon, ChevronRight, Close, DocIcon, MuteIcon, PhotoIcon, StarIcon } from './icons';
import { formatWaPhone, posterFrame } from './format';

/** Un mensaje compartido en el chat 1:1 (foto, video, documento, link o destacado), igual en las dos apps. */
export interface SheetSharedItem {
  id: string;
  url: string;
  video?: boolean;
  name: string;
  body: string;
  sentAt: string;
  fromMe: boolean;
  senderName: string;
  urls?: string[];
  /** Qué es (para nombrar un destacado sin texto). */
  kind?: 'image' | 'video' | 'audio' | 'document' | 'sticker';
}

type View = 'main' | 'shared' | 'starred';
type SharedTab = 'media' | 'docs' | 'links';

/** "+54 9 11 5555-0000" (lo enmascarado queda como vino). */
function phoneText(card: Pick<WaPersonCard, 'phone'> & { masked?: boolean }): string {
  return formatWaPhone(card.phone, card.masked);
}

/**
 * "Info del contacto" de una persona de un grupo, como en WhatsApp: foto
 * grande, nombre, teléfono, "Mensaje", su "info", lo compartido y los
 * destacados del chat 1:1, silenciar, grupos en común y bloquear. Solo las
 * filas que la app puede respaldar (sin chat 1:1 no hay compartido ni
 * silencio; sin proveedor que bloquee, no hay bloquear). Modal en la
 * computadora, pantalla entera en el teléfono. La usan Inbox y Lines; cada
 * app trae los datos y hace las acciones.
 */
export default function ContactSheet({
  card,
  error,
  fallbackName,
  fallbackPicture,
  busy,
  onClose,
  onRetry,
  onMessage,
  onOpenGroup,
  onMute,
  onBlock,
  loadShared,
}: {
  /** null mientras carga. */
  card: (WaPersonCard & { masked?: boolean }) | null;
  error?: string;
  /** Lo que ya se sabe mientras carga (el nombre y la foto del mensaje). */
  fallbackName: string;
  fallbackPicture?: string;
  /** "Mensaje" en curso. */
  busy?: boolean;
  onClose: () => void;
  onRetry: () => void;
  onMessage: () => void;
  onOpenGroup: (id: string) => void;
  onMute?: (on: boolean) => void;
  onBlock?: (on: boolean) => void;
  loadShared: (kind: SharedTab | 'starred') => Promise<SheetSharedItem[] | null>;
}) {
  const t = useTranslations('groups.wa.contactSheet');
  const locale = useLocale();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [view, setView] = useState<View>('main');
  const [tab, setTab] = useState<SharedTab>('media');
  const [items, setItems] = useState<Record<string, SheetSharedItem[] | null | undefined>>({});
  const [viewerAt, setViewerAt] = useState<string | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const key = view === 'starred' ? 'starred' : tab;
  useEffect(() => {
    if (view === 'main' || items[key] !== undefined) return;
    setItems((s) => ({ ...s, [key]: null }));
    void loadShared(key).then((list) => setItems((s) => ({ ...s, [key]: list ?? [] })));
  }, [view, key, items, loadShared]);

  const name = card ? card.name || phoneText(card) : fallbackName;
  const picture = card ? card.picture : fallbackPicture;
  const phone = card && card.name ? phoneText(card) : '';
  const media = (items.media ?? []).filter((m) => m.url);
  const viewerItems: ViewerItem[] = media.map((m) => ({
    id: m.id,
    url: m.url,
    type: m.video ? 'video/mp4' : 'image/jpeg',
    name: m.name,
    caption: m.body,
    author: m.fromMe ? t('you') : m.senderName || name,
    createdAt: m.sentAt,
  }));
  const viewerIndex = viewerAt ? viewerItems.findIndex((v) => v.id === viewerAt) : -1;
  const when = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const list = items[key];

  const back = () => setView('main');

  return (
    <dialog
      ref={ref}
      className="ui-modal wa-contact-sheet"
      aria-labelledby={titleId}
      data-testid="wa-contact-sheet"
      onCancel={(e) => {
        e.preventDefault();
        if (viewerAt || photoOpen) return;
        if (confirmBlock) setConfirmBlock(false);
        else if (view !== 'main') back();
        else onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ui-modal-head wa-sheet-head">
        {view === 'main' ? (
          <button type="button" className="wa-icon-btn" onClick={onClose} aria-label={t('close')} title={t('close')}>
            <Close size={20} />
          </button>
        ) : (
          <button type="button" className="wa-icon-btn" onClick={back} aria-label={t('back')} title={t('back')} data-testid="wa-sheet-back">
            <ArrowLeft size={20} />
          </button>
        )}
        <h2 id={titleId} className="ui-modal-title">
          {view === 'main' ? t('title') : view === 'shared' ? t('shared') : t('starred')}
        </h2>
      </div>
      <div className="ui-modal-body wa-sheet-body">
        {view === 'main' && (
          <>
            <section className="wa-sheet-hero">
              <button
                type="button"
                className="wa-sheet-photo"
                onClick={() => picture && setPhotoOpen(true)}
                disabled={!picture}
                aria-label={t('viewPhoto')}
                data-testid="wa-sheet-photo"
              >
                <Avatar name={name} kind="dm" src={picture || undefined} seed={card?.phone || fallbackName} size={132} />
              </button>
              <p className="wa-sheet-name" dir="auto" data-testid="wa-sheet-name">
                {card?.me ? t('you') : name}
              </p>
              {phone && <p className="wa-sheet-phone">{phone}</p>}
              {card?.role && card.role !== 'member' && <span className="wa-sheet-badge">{t('admin')}</span>}
              {card && !card.me && (
                <div className="wa-sheet-actions">
                  <button type="button" className="wa-sheet-action" onClick={onMessage} disabled={busy} aria-busy={busy || undefined} data-testid="wa-sheet-message">
                    <ChatIcon size={22} />
                    <span>{t('message')}</span>
                  </button>
                </div>
              )}
            </section>

            {error ? (
              <div className="wa-sheet-card" role="alert">
                <p className="wa-sheet-muted">{error}</p>
                <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
                  {t('retry')}
                </button>
              </div>
            ) : !card ? (
              <div className="wa-sheet-card" aria-busy="true">
                <span className="ui-skeleton ui-skeleton-row" />
                <span className="ui-skeleton ui-skeleton-row" />
              </div>
            ) : (
              <>
                {card.about && (
                  <section className="wa-sheet-card">
                    <h3 className="wa-sheet-label">{t('about')}</h3>
                    <p className="wa-sheet-about" dir="auto">
                      {card.about}
                    </p>
                  </section>
                )}

                {card.dm && (sharedTotal(card) > 0 || card.shared.starred > 0 || onMute) && (
                  <section className="wa-sheet-card wa-sheet-rows">
                    {sharedTotal(card) > 0 && (
                      <button type="button" className="wa-sheet-row" onClick={() => {
                          // Como WhatsApp, en la pestaña que tiene algo (fotos, si no documentos, si no enlaces).
                          setTab(card.shared.media > 0 ? 'media' : card.shared.docs > 0 ? 'docs' : 'links');
                          setView('shared');
                        }}
                        data-testid="wa-sheet-shared">
                        <PhotoIcon size={20} />
                        <span className="wa-sheet-row-main">{t('shared')}</span>
                        <span className="wa-sheet-count">{sharedTotal(card)}</span>
                        <ChevronRight size={18} />
                      </button>
                    )}
                    {card.shared.starred > 0 && (
                      <button type="button" className="wa-sheet-row" onClick={() => setView('starred')} data-testid="wa-sheet-starred">
                        <StarIcon size={20} />
                        <span className="wa-sheet-row-main">{t('starred')}</span>
                        <span className="wa-sheet-count">{card.shared.starred}</span>
                        <ChevronRight size={18} />
                      </button>
                    )}
                    {onMute && (
                      <label className="wa-sheet-row">
                        <MuteIcon size={20} />
                        <span className="wa-sheet-row-main">{t('mute')}</span>
                        <span className="ui-switch">
                          <input type="checkbox" role="switch" checked={card.dm.muted} onChange={(e) => onMute(e.target.checked)} data-testid="wa-sheet-mute" />
                        </span>
                      </label>
                    )}
                  </section>
                )}

                {card.commonGroups.length > 0 && (
                  <section className="wa-sheet-card wa-sheet-rows">
                    <h3 className="wa-sheet-label">{t('commonGroups', { n: card.commonGroups.length })}</h3>
                    <ul className="wa-sheet-list">
                      {card.commonGroups.map((g) => (
                        <li key={g.id}>
                          <button type="button" className="wa-sheet-row" onClick={() => onOpenGroup(g.id)}>
                            <Avatar name={g.name || t('group')} kind="group" src={g.picture || undefined} seed={g.id} size={36} />
                            <span className="wa-sheet-row-main" dir="auto">
                              {g.name || t('group')}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {card.canBlock && card.dm && onBlock && (
                  <section className="wa-sheet-card wa-sheet-rows">
                    {confirmBlock ? (
                      <div className="wa-sheet-confirm" role="alertdialog" aria-label={t('blockTitle', { name })}>
                        <p>{t('blockBody', { name })}</p>
                        <div className="wa-sheet-confirm-actions">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmBlock(false)} autoFocus>
                            {t('cancel')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            data-testid="wa-sheet-block-confirm"
                            onClick={() => {
                              setConfirmBlock(false);
                              onBlock(true);
                            }}
                          >
                            {t('block')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="wa-sheet-row is-danger"
                        onClick={() => (card.dm!.blocked ? onBlock(false) : setConfirmBlock(true))}
                        data-testid="wa-sheet-block"
                        data-blocked={card.dm.blocked ? 'true' : undefined}
                      >
                        <Ban size={20} />
                        <span className="wa-sheet-row-main">{card.dm.blocked ? t('unblockName', { name }) : t('blockName', { name })}</span>
                      </button>
                    )}
                  </section>
                )}
              </>
            )}
          </>
        )}

        {view === 'shared' && (
          <div className="wa-sheet-tabs" role="tablist" aria-label={t('shared')}>
            {(['media', 'docs', 'links'] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>
                {t(`tabs.${k}`)}
              </button>
            ))}
          </div>
        )}

        {view !== 'main' &&
          (list === null || list === undefined ? (
            <div className="wa-sheet-grid" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <span key={i} className="ui-skeleton wa-sheet-thumb" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <p className="wa-sheet-muted wa-sheet-empty">{t(`empty.${key}`)}</p>
          ) : key === 'media' ? (
            <ul className="wa-sheet-grid" data-testid="wa-sheet-media">
              {media.map((m) => (
                <li key={m.id}>
                  <button type="button" className="wa-sheet-thumb" onClick={() => setViewerAt(m.id)} aria-label={m.body || m.name || t(m.video ? 'video' : 'photo')}>
                    {m.video ? (
                      <video src={posterFrame(m.url)} muted preload="metadata" tabIndex={-1} aria-hidden="true" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.url} alt="" loading="lazy" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : key === 'docs' ? (
            <ul className="wa-sheet-list">
              {list.map((m) => (
                <li key={m.id}>
                  <a className="wa-sheet-row" href={m.url || undefined} download target="_blank" rel="noopener noreferrer">
                    <DocIcon size={20} />
                    <span className="wa-sheet-row-main">
                      <span className="wa-sheet-row-name">{m.name || t('document')}</span>
                      <span className="wa-sheet-muted">{when(m.sentAt)}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : key === 'links' ? (
            <ul className="wa-sheet-list">
              {list.flatMap((m) =>
                (m.urls ?? []).map((u, i) => (
                  <li key={`${m.id}-${i}`}>
                    <a className="wa-sheet-row" href={u} target="_blank" rel="noopener noreferrer nofollow">
                      <span className="wa-sheet-row-main">
                        <span className="wa-sheet-row-name wa-sheet-link">{u.replace(/^https?:\/\//, '')}</span>
                        <span className="wa-sheet-muted">{when(m.sentAt)}</span>
                      </span>
                    </a>
                  </li>
                )),
              )}
            </ul>
          ) : (
            <ul className="wa-sheet-list" data-testid="wa-sheet-starred-list">
              {list.map((m) => (
                <li key={m.id} className="wa-sheet-starred">
                  <span className="wa-sheet-muted">{`${m.fromMe ? t('you') : m.senderName || name} · ${when(m.sentAt)}`}</span>
                  <span dir="auto">{m.body || m.name || t('document')}</span>
                </li>
              ))}
            </ul>
          ))}
      </div>
      {viewerIndex >= 0 && <MediaViewer items={viewerItems} index={viewerIndex} onIndex={(i) => setViewerAt(viewerItems[i]?.id ?? null)} onClose={() => setViewerAt(null)} container={ref.current} />}
      {photoOpen && picture && (
        <MediaViewer
          items={[{ id: 'photo', url: picture, type: 'image/jpeg', name, caption: '', author: name, createdAt: new Date().toISOString() }]}
          index={0}
          onIndex={() => undefined}
          onClose={() => setPhotoOpen(false)}
          container={ref.current}
        />
      )}
    </dialog>
  );
}
