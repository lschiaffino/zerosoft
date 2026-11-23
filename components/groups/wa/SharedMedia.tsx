'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import MediaViewer, { type ViewerItem } from './MediaViewer';
import { DocIcon } from './icons';
import { posterFrame } from './format';
import type { SheetSharedItem } from './ContactSheet';

type Kind = 'media' | 'docs' | 'links' | 'starred';

/**
 * Lo compartido en un chat, para la pestaña Archivos del panel (Lines e Inbox): fotos y videos, documentos y
 * links (sub-pestañas, como la info de WhatsApp) y los mensajes destacados. Cada lista se pide la primera vez que
 * se mira; `starredKey` cambia cuando se destaca algo en la conversación y vuelve a pedir esa lista.
 */
export default function SharedMedia({
  load,
  chatName,
  starredKey = '',
  onJumpToMessage,
}: {
  load: (kind: Kind) => Promise<SheetSharedItem[] | null>;
  /** Autor de lo que llegó sin nombre (un 1:1). */
  chatName: string;
  starredKey?: string;
  onJumpToMessage?: (id: string) => void;
}) {
  const t = useTranslations('groups.wa.details');
  const ts = useTranslations('groups.wa.contactSheet');
  const locale = useLocale();
  const [tab, setTab] = useState<'media' | 'docs' | 'links'>('media');
  const [items, setItems] = useState<Partial<Record<Kind, SheetSharedItem[] | null>>>({});
  const [failed, setFailed] = useState<Partial<Record<Kind, boolean>>>({});
  const [viewerAt, setViewerAt] = useState<string | null>(null);

  const fetchKind = (kind: Kind) => {
    setItems((s) => ({ ...s, [kind]: null }));
    setFailed((s) => ({ ...s, [kind]: false }));
    void load(kind).then((list) => {
      setItems((s) => ({ ...s, [kind]: list ?? [] }));
      setFailed((s) => ({ ...s, [kind]: list === null }));
    });
  };

  useEffect(() => {
    if (items[tab] === undefined) fetchKind(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  // Destacados: al montar y cada vez que cambian en la conversación.
  const starredSeen = useRef<string | null>(null);
  useEffect(() => {
    if (starredSeen.current === starredKey) return;
    starredSeen.current = starredKey;
    fetchKind('starred');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starredKey]);

  const when = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const media = (items.media ?? []).filter((m) => m.url);
  const viewerItems: ViewerItem[] = media.map((m) => ({
    id: m.id,
    url: m.url,
    type: m.video ? 'video/mp4' : 'image/jpeg',
    name: m.name,
    caption: m.body,
    author: m.fromMe ? ts('you') : m.senderName || chatName,
    createdAt: m.sentAt,
  }));
  const viewerIndex = viewerAt ? viewerItems.findIndex((v) => v.id === viewerAt) : -1;
  const list = items[tab];
  const starred = items.starred;

  const errorRow = (kind: Kind) => (
    <p className="wa-sheet-muted wa-sheet-empty" role="alert">
      {t('loadError')}{' '}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => fetchKind(kind)}>
        {t('retry')}
      </button>
    </p>
  );

  return (
    <div className="wa-shared" data-testid="details-shared">
      <section className="gr-detail-section">
        <div className="wa-sheet-tabs" role="tablist" aria-label={t('tabs.media')}>
          {(['media', 'docs', 'links'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>
              {ts(`tabs.${k}`)}
            </button>
          ))}
        </div>
        {failed[tab] ? (
          errorRow(tab)
        ) : list === null || list === undefined ? (
          <div className="wa-sheet-grid" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className="ui-skeleton wa-sheet-thumb" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <p className="wa-sheet-muted wa-sheet-empty">{t(`empty.${tab}`)}</p>
        ) : tab === 'media' ? (
          <ul className="wa-sheet-grid" data-testid="details-media">
            {media.slice(0, 60).map((m) => (
              <li key={m.id}>
                <button type="button" className="wa-sheet-thumb" onClick={() => setViewerAt(m.id)} aria-label={m.body || m.name || ts(m.video ? 'video' : 'photo')}>
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
        ) : tab === 'docs' ? (
          <ul className="wa-sheet-list">
            {list.map((m) => (
              <li key={m.id}>
                <a className="wa-sheet-row" href={m.url || undefined} download target="_blank" rel="noopener noreferrer">
                  <DocIcon size={20} />
                  <span className="wa-sheet-row-main">
                    <span className="wa-sheet-row-name">{m.name || ts('document')}</span>
                    <span className="wa-sheet-muted">{when(m.sentAt)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
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
        )}
      </section>

      <section className="gr-detail-section" data-testid="chat-starred">
        <h3 className="gr-detail-title">{ts('starred')}</h3>
        {failed.starred ? (
          errorRow('starred')
        ) : starred === null || starred === undefined ? (
          <span className="ui-skeleton ui-skeleton-row" />
        ) : starred.length === 0 ? (
          <p className="ui-help">{ts('empty.starred')}</p>
        ) : (
          <ul className="gr-mini-list gr-starred-list">
            {starred.slice(0, 20).map((m) => (
              <li key={m.id}>
                <button type="button" className="gr-starred-item" data-testid="chat-starred-item" onClick={() => onJumpToMessage?.(m.id)} disabled={!onJumpToMessage}>
                  <span className="ui-help">
                    {m.fromMe ? ts('you') : m.senderName || chatName} · {when(m.sentAt)}
                  </span>
                  <span className="gr-starred-text" dir="auto">
                    {m.body || m.name || ts('document')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {viewerIndex >= 0 && <MediaViewer items={viewerItems} index={viewerIndex} onIndex={(i) => setViewerAt(viewerItems[i]?.id ?? null)} onClose={() => setViewerAt(null)} />}
    </div>
  );
}
