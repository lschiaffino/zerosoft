import { useTranslations } from 'next-intl';

const COLUMNS = [
  { k: 'col1', x: 40, notes: ['a1', 'a2'] },
  { k: 'col2', x: 270, notes: ['b1', 'b2'] },
  { k: 'col3', x: 500, notes: ['c1'] },
] as const;

/** Vista de Board: una pizarra con tres columnas de notas y flechas a mano alzada. */
export default function BoardMockup() {
  const t = useTranslations('pages.mockups.board');

  return (
    <div className="mk mk-board-canvas">
      <div className="mk-track-top">
        <span className="mk-agents-name">{t('title')}</span>
        <span className="mk-mono">{t('saved')}</span>
      </div>
      <svg viewBox="0 0 720 360" role="img" aria-label={t('title')}>
        {COLUMNS.map((col) => (
          <g key={col.k}>
            <text x={col.x} y={28} className="mk-board-h">
              {t(col.k)}
            </text>
            {col.notes.map((n, i) => (
              <g key={n}>
                <rect x={col.x} y={48 + i * 112} width={180} height={92} rx={2} className="mk-board-note" />
                <foreignObject x={col.x + 12} y={58 + i * 112} width={156} height={74}>
                  <p className="mk-board-text">{t(n)}</p>
                </foreignObject>
              </g>
            ))}
          </g>
        ))}
        <path d="M224 94 C 245 94, 250 94, 266 94" className="mk-board-arrow" />
        <path d="M454 94 C 475 94, 480 94, 496 94" className="mk-board-arrow" />
        <path d="M150 300 C 220 340, 420 340, 560 160" className="mk-board-scribble" />
      </svg>
    </div>
  );
}
