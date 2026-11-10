import { useTranslations } from 'next-intl';

const ROWS = ['r1', 'r2', 'r3'] as const;
const LINES = [
  ['l1', 'rep'],
  ['l2', 'buyer'],
  ['l3', 'rep'],
  ['l4', 'buyer'],
] as const;
// Tramos de cada voz sobre la duración de la llamada, en porcentaje: [desde, hasta].
const TRACKS = {
  rep: [[0, 9], [21, 27], [44, 52], [66, 71], [86, 92]],
  buyer: [[9, 21], [27, 44], [52, 66], [71, 86], [92, 100]],
} as const;
const SCORE = [
  ['s1', 'is-ok'],
  ['s2', 'is-ok'],
  ['s3', 'is-warn'],
  ['s4', 'is-bad'],
] as const;
const REP_SHARE = 42;
const PLAYHEAD = 31;

const panel = { display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', background: 'var(--brand-white)', border: '1px solid var(--line)' } as const;
const label = { fontSize: 12, fontWeight: 600, color: 'var(--brand-gray-2)' } as const;

/** Una llamada abierta: video, las pistas de cada voz, la transcripción con tiempos y el panel con resumen, talk ratio y scorecard. */
export default function CallsMockup() {
  const t = useTranslations('pages.mockups.calls');

  return (
    <div className="mk mk-chat">
      <aside className="mk-chat-list">
        <div className="mk-chat-list-head">
          <h4>{t('listTitle')}</h4>
        </div>
        {ROWS.map((r, i) => (
          <div className={`mk-chat-row${i === 0 ? ' active' : ''}`} key={r}>
            <span className="mk-chat-row-main">
              <span className="mk-chat-row-top">
                <span className="mk-chat-name">{t(`${r}name`)}</span>
                <span className="mk-chat-time">{t(`${r}time`)}</span>
              </span>
              <span className="mk-chat-snippet">{t(`${r}meta`)}</span>
            </span>
          </div>
        ))}
      </aside>

      <div className="mk-chat-main">
        <div className="mk-chat-conv-head" style={{ flexWrap: 'wrap', rowGap: 6 }}>
          <span className="mk-chat-name">{t('r1name')}</span>
          <span className="mk-status is-accent">
            <i />
            {t('deal')}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 16, marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <div className="mk-rec-frame" aria-hidden="true" style={{ marginTop: 0, gridTemplateColumns: '1fr 1fr', gap: 8, padding: 8, placeItems: 'stretch' }}>
              <span style={{ display: 'grid', placeItems: 'center', background: 'var(--brand-white)', border: '1px solid var(--line)', fontSize: 12, color: 'var(--brand-gray-2)' }}>{t('rep')}</span>
              <span style={{ display: 'grid', placeItems: 'center', background: 'var(--brand-white)', border: '2px solid var(--accent)', fontSize: 12, color: 'var(--brand-gray-2)' }}>{t('buyer')}</span>
              <span className="mk-rec-bar">
                <i style={{ width: `${PLAYHEAD}%` }} />
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} aria-hidden="true">
              {(['rep', 'buyer'] as const).map((who) => (
                <div key={who} style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr)', gap: 8, alignItems: 'center', fontSize: 12 }}>
                  <span style={{ color: 'var(--brand-gray-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(who)}</span>
                  <span style={{ position: 'relative', display: 'block', height: 8, background: 'var(--line)' }}>
                    {TRACKS[who].map(([from, to]) => (
                      <span
                        key={from}
                        style={{ position: 'absolute', top: 0, bottom: 0, left: `${from}%`, width: `${to - from}%`, background: who === 'rep' ? 'var(--accent)' : 'var(--brand-gray-2)' }}
                      />
                    ))}
                    <span style={{ position: 'absolute', top: -3, bottom: -3, left: `${PLAYHEAD}%`, width: 2, background: 'var(--ink)' }} />
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {LINES.map(([l, who], i) => (
                <div
                  key={l}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '40px minmax(0, 1fr)',
                    gap: 8,
                    padding: '6px 8px',
                    fontSize: 13,
                    lineHeight: 1.45,
                    background: i === 1 ? 'var(--brand-enamel)' : undefined,
                    boxShadow: i === 1 ? 'inset 2px 0 0 var(--accent)' : undefined,
                  }}
                >
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--brand-gray-2)' }}>{t(`${l}time`)}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--brand-gray-1)' }}>{t(who)}</span>
                    {t(l)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <div style={panel}>
              <span style={label}>{t('summaryTitle')}</span>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }}>{t('summary')}</p>
            </div>
            <div style={panel}>
              <span style={{ ...label, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{t('ratioTitle')}</span>
                <span style={{ fontFamily: 'var(--mono)' }}>
                  {REP_SHARE} / {100 - REP_SHARE}
                </span>
              </span>
              <span style={{ display: 'flex', height: 8, background: 'var(--line)' }} aria-hidden="true">
                <span style={{ width: `${REP_SHARE}%`, background: 'var(--accent)' }} />
              </span>
              <span style={{ fontSize: 12, color: 'var(--brand-gray-2)' }}>{t('ratioNote')}</span>
            </div>
            <div style={panel}>
              <span style={label}>{t('scoreTitle')}</span>
              {SCORE.map(([s, tone]) => (
                <span key={s} className={`mk-status ${tone}`} style={{ whiteSpace: 'normal', fontWeight: 500 }}>
                  <i />
                  {t(s)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
