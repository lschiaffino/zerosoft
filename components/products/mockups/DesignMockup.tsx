import { useTranslations } from 'next-intl';

const TEMPLATES = ['t1', 't2', 't3'] as const;
/** Colores de las miniaturas y del póster: son el contenido del diseño, no la interfaz. */
const THUMB_FILL = ['#00a5c8', '#f2611d', '#111111'] as const;

/** Vista de Design: plantillas a la izquierda, un póster en el lienzo y la tira de páginas. */
export default function DesignMockup() {
  const t = useTranslations('pages.mockups.design');

  return (
    <div className="mk mk-board-canvas mk-design">
      <div className="mk-track-top">
        <span className="mk-agents-name">{t('title')}</span>
        <span className="mk-mono">{t('size')}</span>
      </div>
      <div className="mk-board-svg">
        <svg viewBox="0 0 720 380" role="img" aria-label={t('title')}>
          {/* Panel de plantillas */}
          <rect x={0} y={0} width={168} height={380} className="mk-design-panel" />
          <text x={14} y={26} className="mk-board-h">
            {t('templates')}
          </text>
          {TEMPLATES.map((k, i) => (
            <g key={k}>
              <rect x={14} y={42 + i * 106} width={140} height={78} fill={THUMB_FILL[i]} />
              <rect x={26} y={58 + i * 106} width={70} height={8} fill="#ffffff" />
              <rect x={26} y={72 + i * 106} width={46} height={5} fill="#ffffff" opacity={0.7} />
              <text x={14} y={136 + i * 106} className="mk-design-cap">
                {t(k)}
              </text>
            </g>
          ))}

          {/* Lienzo con el póster */}
          <rect x={250} y={20} width={300} height={300} fill="#0f2a3a" />
          <circle cx={490} cy={80} r={78} fill="#00a5c8" />
          <rect x={272} y={238} width={120} height={34} fill="#f2c94c" />
          <text x={272} y={150} className="mk-design-poster-h">
            {t('posterTitle')}
          </text>
          <text x={272} y={184} className="mk-design-poster-h">
            {t('posterTitle2')}
          </text>
          <text x={272} y={212} className="mk-design-poster-s">
            {t('posterSub')}
          </text>
          <text x={284} y={260} className="mk-design-poster-cta">
            {t('posterCta')}
          </text>
          {/* Selección con manijas */}
          <rect x={266} y={124} width={214} height={70} className="mk-design-sel" />
          {[
            [266, 124],
            [480, 124],
            [266, 194],
            [480, 194],
          ].map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x - 4} y={y - 4} width={8} height={8} className="mk-design-handle" />
          ))}

          {/* Tira de páginas */}
          {[0, 1, 2].map((i) => (
            <rect key={i} x={250 + i * 64} y={336} width={52} height={36} className={i === 0 ? 'mk-design-page active' : 'mk-design-page'} />
          ))}
          <text x={450} y={360} className="mk-design-cap">
            {t('pages')}
          </text>
        </svg>
      </div>
    </div>
  );
}
