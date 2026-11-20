'use client';

import { useTranslations } from 'next-intl';

/**
 * Mensajes fijados, arriba del hilo (Lines e Inbox, como WhatsApp): clic va al
 * mensaje, × lo desfija. `mediaOf`: qué es un mensaje sin texto (Foto, Audio...).
 * Solo lee `groups.thread`, para que Inbox no cargue los textos de Lines.
 */
export default function PinnedBar<M extends { id: string; body: string }>({
  pinned,
  onJump,
  onUnpin,
  textOf = (m) => m.body,
  mediaOf,
}: {
  pinned: M[];
  onJump: (m: M) => void;
  onUnpin: (m: M) => void;
  /** El texto con las menciones nombradas ("@Nombre" en lugar de "@<dígitos>"). */
  textOf?: (m: M) => string;
  mediaOf: (m: M) => string;
}) {
  const t = useTranslations('groups.thread');
  if (pinned.length === 0) return null;
  return (
    <div className="gr-pinned" role="region" aria-label={t('pinnedTitle')} data-testid="pinned-bar">
      {pinned.map((m) => (
        <div key={m.id} className="gr-pinned-row" data-testid="pinned-row">
          <button type="button" className="gr-pinned-jump" onClick={() => onJump(m)}>
            <span className="gr-pinned-tag">{t('pinned')}</span>
            <span className="gr-pinned-text">{textOf(m).slice(0, 120) || mediaOf(m)}</span>
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onUnpin(m)} aria-label={t('unpinLabel')} data-testid="pinned-unpin">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
