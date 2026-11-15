import { useTranslations } from 'next-intl';

const CARDS = [
  ['c1', 'working'],
  ['c2', 'waiting'],
  ['c3', 'done'],
] as const;
const TILES = ['t1', 't2', 't3', 't4'] as const;

const DOT: Record<string, string> = { working: 'var(--accent)', waiting: 'var(--warn-ink)', done: 'var(--ok-ink)' };
const card = { display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', background: 'var(--brand-white)', border: '1px solid var(--line)', minWidth: 0 } as const;
const small = { fontSize: 12, color: 'var(--brand-gray-2)' } as const;

/** El tablero de Fleet: cifras de ahora, tarjetas de agentes con su PR y deploy, y un chat con el agente que espera. */
export default function FleetMockup() {
  const t = useTranslations('pages.mockups.fleet');
  return (
    <div className="mk" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', border: '1px solid var(--line)' }}>
        {TILES.map((k, i) => (
          <div key={k} style={{ padding: '10px 12px', borderLeft: i ? '1px solid var(--line)' : 0, background: 'var(--brand-white)' }}>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 22, fontWeight: 600 }}>{t(`${k}n`)}</div>
            <div style={small}>{t(k)}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 10 }}>
        {CARDS.map(([c, status]) => (
          <div key={c} style={{ ...card, borderLeft: `3px solid ${DOT[status]}` }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...small }}>
              <i style={{ width: 8, height: 8, background: DOT[status], display: 'inline-block' }} />
              {t(`${c}status`)}
            </span>
            <strong style={{ fontSize: 14 }}>{t(`${c}title`)}</strong>
            <span style={{ ...small, fontFamily: 'var(--font-data)' }}>{t(`${c}branch`)}</span>
            <span style={{ ...small, borderTop: '1px solid var(--line)', paddingTop: 6 }}>{t(`${c}foot`)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, background: 'var(--brand-enamel)', border: '1px solid var(--line)' }} aria-hidden="true">
        <span style={{ alignSelf: 'flex-start', maxWidth: '80%', padding: '6px 9px', background: 'var(--brand-white)', fontSize: 13 }}>{t('agentMsg')}</span>
        <span style={{ alignSelf: 'flex-end', maxWidth: '80%', padding: '6px 9px', background: 'color-mix(in srgb, var(--accent) 18%, var(--brand-white))', fontSize: 13 }}>{t('myMsg')} ✓✓</span>
      </div>
    </div>
  );
}
