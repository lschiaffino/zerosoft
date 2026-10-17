import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import Logo from '@/components/brand/subte/SubteLogo';
import Station from '@/components/brand/Station';
import LineGlyph from '@/components/brand/subte/SubteLineGlyph';
import NetworkMap, { type NetworkMapLabels } from '@/components/brand/NetworkMap';
import CopyValue from '@/components/brand/CopyValue';
import { BRAND_LINES, WORDMARK } from '@/lib/brand';
import { NET_LINES, NET_STATIONS } from '@/lib/brand-network';
import { PRODUCT_CONFIG, PRODUCT_KEYS, type ProductKey } from '@/lib/products';
import { GITHUB_URL } from '@/components/site/catalog';
import '@/styles/network.css';
import '@/styles/brand-page.css';

const KIT = '/brand/zerosoft-brand-kit.zip';
const PRESS_EMAIL = 'hola@zerosoft.ai';

/** Especímenes del nombre: son la marca misma, no se traducen. */
const NAME_YES = ['zerosoft', 'zerosoft CRM', 'zerosoft.ai'];
const NAME_NO = ['ZeroSoft', 'ZEROSOFT', 'zero soft', 'Zero Software'];

const NEUTRALS = [
  { key: 'white', hex: '#ffffff', oklch: 'oklch(100% 0 0)' },
  { key: 'enamel', hex: '#f4f4f2', oklch: 'oklch(96.7% 0.003 106.4)' },
  { key: 'ink', hex: '#111111', oklch: 'oklch(17.8% 0 0)' },
  { key: 'gray1', hex: '#3d3d3d', oklch: 'oklch(36% 0 0)' },
  { key: 'gray2', hex: '#5c5c5c', oklch: 'oklch(47.5% 0 0)' },
  { key: 'gray3', hex: '#767676', oklch: 'oklch(56.6% 0 0)' },
  { key: 'rule', hex: '#d9d9d6', oklch: 'oklch(88.4% 0.004 106.5)' },
] as const;

const SCALE = [
  { key: 'display', px: 88, lh: '0.92', cls: 'is-signage', wdth: 75 },
  { key: 'h1', px: 64, lh: '0.95', cls: 'is-signage', wdth: 75 },
  { key: 'h2', px: 48, lh: '1', cls: 'is-signage', wdth: 75 },
  { key: 'h3', px: 32, lh: '1.05', cls: 'is-signage', wdth: 75 },
  { key: 'sign', px: 26, lh: '1.1', cls: 'is-signage', wdth: 75 },
  { key: 'lead', px: 20, lh: '1.45', cls: 'is-ui', wdth: 100 },
  { key: 'body', px: 17, lh: '1.55', cls: 'is-ui', wdth: 100 },
  { key: 'ui', px: 15, lh: '1.4', cls: 'is-ui', wdth: 100 },
  { key: 'data', px: 13, lh: '1.4', cls: 'is-data', wdth: 100 },
] as const;

const VOICE = ['r1', 'r2', 'r3', 'r4', 'r5'] as const;
const MISUSE = ['stretch', 'color', 'caps', 'effects', 'contrast', 'glyph'] as const;

function kitSize(locale: string): string {
  try {
    const bytes = statSync(join(process.cwd(), 'public', KIT)).size;
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(bytes / 1024)} KB`;
  } catch {
    return '';
  }
}

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'brand.meta' });
  return { title: t('title'), description: t('description') };
}

export default async function BrandPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'brand' });
  const size = kitSize(locale);

  const mapLabels: NetworkMapLabels = {
    title: t('map.title'),
    hint: t('map.hint'),
    hintTouch: t('map.hintTouch'),
    lines: Object.fromEntries(PRODUCT_KEYS.map((k) => [k, t(`map.lines.${k}`)])) as Record<ProductKey, string>,
    stations: Object.fromEntries(
      NET_STATIONS.map((s) => [s.id, { name: t(`map.stations.${s.id}.name`), desc: t(`map.stations.${s.id}.desc`) }]),
    ),
  };

  const nav = [
    { id: 'logo', label: t('nav.logo') },
    { id: 'lineas', label: t('nav.lines') },
    { id: 'tipografia', label: t('nav.type') },
    { id: 'voz', label: t('nav.voice') },
    { id: 'red', label: t('nav.network') },
    { id: 'prensa', label: t('nav.press') },
  ];

  return (
    <div className="bp">
      <header className="bp-band">
        <a className="bp-band-home" href={`/${locale}`} aria-label={t('nav.home')}>
          <Logo tone="white" height={26} title="" />
        </a>
        <nav className="bp-band-nav" aria-label={t('nav.label')}>
          {nav.map((n) => (
            <a key={n.id} href={`#${n.id}`}>
              {n.label}
            </a>
          ))}
        </nav>
        <a className="bp-btn bp-btn-white" href={KIT} download>
          {t('nav.download')}
        </a>
      </header>

      <main>
        {/* Primer viewport: la tesis y el plano vivo. */}
        <section className="bp-hero" aria-labelledby="bp-title">
          <div className="bp-hero-copy">
            <h1 id="bp-title" className="bp-display">
              {t('hero.title1')}
              <br />
              {t('hero.title2')}
            </h1>
            <p className="bp-hero-sub">{t('hero.sub')}</p>
            <div className="bp-hero-foot">
              <p className="bp-hero-kit">{t('hero.kit')}</p>
              <p className="bp-meta data">
                <a href={KIT} download className="bp-link">
                  zerosoft-brand-kit.zip
                </a>
                {size ? ` · ${size}` : ''}
              </p>
              <p className="bp-meta">{t('hero.edition')}</p>
            </div>
          </div>
          <NetworkMap locale={locale} labels={mapLabels} className="bp-hero-map" />
        </section>

        {/* El nombre. */}
        <section className="bp-section" aria-labelledby="h-name">
          <SectionSign id="h-name" title={t('name.title')} />
          <div className="bp-wrap bp-cols">
            <p className="bp-lead">{t('name.lead')}</p>
            <div className="bp-yesno">
              <div>
                <h3 className="bp-tag">{t('name.yes')}</h3>
                <ul className="bp-specimens">
                  {NAME_YES.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="bp-tag">{t('name.no')}</h3>
                <ul className="bp-specimens is-no">
                  {NAME_NO.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <div className="bp-wrap bp-products">
            <div>
              <h3 className="bp-h3">{t('name.productsTitle')}</h3>
              <p className="bp-body">{t('name.productsBody')}</p>
            </div>
            <table className="bp-table bp-names">
              <thead>
                <tr>
                  <th scope="col">{t('name.productsInside')}</th>
                  <th scope="col">{t('name.productsOutside')}</th>
                </tr>
              </thead>
              <tbody>
                {PRODUCT_KEYS.map((k) => (
                  <tr key={k}>
                    <td>
                      <span className="bp-name-cell">
                        <LineGlyph product={k} size={18} />
                        {PRODUCT_CONFIG[k].name}
                      </span>
                    </td>
                    <td>zerosoft {PRODUCT_CONFIG[k].name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* El logo. */}
        <section className="bp-section" id="logo" aria-labelledby="h-logo">
          <SectionSign id="h-logo" title={t('logo.title')} />
          <div className="bp-wrap">
            <p className="bp-lead">{t('logo.lead')}</p>
            <div className="bp-logo-grid">
              <figure className="bp-plate">
                <div className="bp-plate-art">
                  <Logo tone="ink" height={72} title="zerosoft" />
                </div>
                <figcaption>{t('logo.onLight')} · <span className="data">logo-dark.svg</span></figcaption>
              </figure>
              <figure className="bp-plate is-ink">
                <div className="bp-plate-art">
                  <Logo tone="white" height={72} title="zerosoft" />
                </div>
                <figcaption>{t('logo.onDark')} · <span className="data">logo-light.svg</span></figcaption>
              </figure>
              <figure className="bp-plate is-symbol">
                <div className="bp-plate-art">
                  <span>
                    <Logo variant="symbol" height={72} title="" />
                  </span>
                  <span className="bp-plate-ink">
                    <Logo variant="symbol" tone="white" height={72} title="" />
                  </span>
                </div>
                <figcaption>
                  {t('logo.symbol')} · <span className="data">{t('logo.symbolFile')}</span>
                </figcaption>
              </figure>
            </div>

            <div className="bp-measure">
              <div>
                <h3 className="bp-h3">{t('logo.clearTitle')}</h3>
                <p className="bp-body">{t('logo.clearBody')}</p>
                <ClearSpace unit={t('logo.unit')} />
              </div>
              <div>
                <h3 className="bp-h3">{t('logo.minTitle')}</h3>
                <p className="bp-body">{t('logo.minBody')}</p>
                <div className="bp-min">
                  <div className="bp-min-item">
                    <Logo height={Math.round((80 * WORDMARK.height) / WORDMARK.width)} title="" />
                    <span className="data">80 px</span>
                  </div>
                  <div className="bp-min-item">
                    <Logo variant="symbol" height={16} title="" />
                    <span className="data">16 px</span>
                  </div>
                </div>
              </div>
            </div>

            <h3 className="bp-h3">{t('logo.misuseTitle')}</h3>
            <ul className="bp-misuse">
              {MISUSE.map((m) => (
                <li key={m} className={`bp-misuse-item is-${m}`}>
                  <div className="bp-misuse-art" aria-hidden="true">
                    <MisuseArt kind={m} />
                    <svg className="bp-misuse-x" viewBox="0 0 24 24" width="24" height="24">
                      <path d="M4 4L20 20M20 4L4 20" stroke="currentColor" strokeWidth="4" />
                    </svg>
                  </div>
                  <p>{t(`logo.misuse.${m}`)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Las estaciones. */}
        <section className="bp-section" aria-labelledby="h-stations">
          <SectionSign id="h-stations" title={t('stations.title')} />
          <div className="bp-wrap">
            <p className="bp-lead">{t('stations.lead')}</p>
            <div className="bp-station-grid">
              <figure>
                <div className="bp-station-art">
                  <StationAnatomy />
                </div>
                <figcaption>
                  <strong className="bp-h4">{t('stations.single')}</strong>
                  <span>{t('stations.singleBody')}</span>
                </figcaption>
              </figure>
              <figure>
                <div className="bp-station-art">
                  <Station interchange size={72} />
                </div>
                <figcaption>
                  <strong className="bp-h4">{t('stations.interchange')}</strong>
                  <span>{t('stations.interchangeBody')}</span>
                </figcaption>
              </figure>
              <figure>
                <div className="bp-station-art bp-glyph-row">
                  {PRODUCT_KEYS.map((k) => (
                    <LineGlyph key={k} product={k} size={30} title={PRODUCT_CONFIG[k].name} />
                  ))}
                </div>
                <figcaption>
                  <strong className="bp-h4">{t('stations.product')}</strong>
                  <span>{t('stations.productBody')}</span>
                </figcaption>
              </figure>
            </div>
            <h3 className="bp-h3">{t('stations.weightsTitle')}</h3>
            <ul className="bp-weights">
              <li>
                <span className="bp-weight" style={{ height: 16 }} />
                <span>{t('stations.w16')}</span>
              </li>
              <li>
                <span className="bp-weight" style={{ height: 8 }} />
                <span>{t('stations.w8')}</span>
              </li>
              <li>
                <span className="bp-weight" style={{ height: 4 }} />
                <span>{t('stations.w4')}</span>
              </li>
            </ul>
            <p className="bp-body">{t('stations.corners')}</p>
          </div>
        </section>

        {/* Las once líneas. */}
        <section className="bp-section" id="lineas" aria-labelledby="h-lines">
          <SectionSign id="h-lines" title={t('lines.title')} />
          <div className="bp-wrap">
            <p className="bp-lead">{t('lines.lead')}</p>
            <table className="bp-table bp-lines">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">{t('lines.colApp')}</span>
                  </th>
                  <th scope="col">{t('lines.colLine')}</th>
                  <th scope="col">{t('lines.colInk')}</th>
                  <th scope="col">{t('lines.colOn')}</th>
                </tr>
              </thead>
              <tbody>
                {BRAND_LINES.map((l) => (
                  <tr key={l.key}>
                    <th scope="row">
                      <span className="bp-line-name">
                        <svg className="bp-line-strip" viewBox="0 0 120 40" width="120" height="40" aria-hidden="true">
                          <line x1="20" y1="20" x2="112" y2="20" stroke={l.line} strokeWidth="16" strokeLinecap="round" />
                          <circle cx="20" cy="20" r="14" fill="#ffffff" stroke="#111111" strokeWidth="8" />
                        </svg>
                        <span className="bp-sign" style={{ color: l.ink }}>
                          {l.name}
                        </span>
                      </span>
                    </th>
                    <td>
                      <span className="bp-cell-label">{t('lines.colLine')}</span>
                      <CopyValue value={l.line} label={t('lines.copy', { value: l.line })} copied={t('lines.copied')} />
                      <CopyValue value={l.lineOklch} label={t('lines.copy', { value: l.lineOklch })} copied={t('lines.copied')} />
                    </td>
                    <td>
                      <span className="bp-cell-label">{t('lines.colInk')}</span>
                      <CopyValue value={l.ink} label={t('lines.copy', { value: l.ink })} copied={t('lines.copied')} />
                      <CopyValue value={l.inkOklch} label={t('lines.copy', { value: l.inkOklch })} copied={t('lines.copied')} />
                    </td>
                    <td>
                      <span className="bp-on" style={{ background: l.line, color: l.on }}>
                        {l.on === '#ffffff' ? t('lines.onWhite') : t('lines.onInk')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className="bp-h3">{t('lines.neutralsTitle')}</h3>
            <ul className="bp-neutrals">
              {NEUTRALS.map((n) => (
                <li key={n.key}>
                  <span className="bp-swatch" style={{ background: n.hex }} />
                  <strong className="bp-h4">{t(`lines.neutrals.${n.key}`)}</strong>
                  <span className="bp-small">{t(`lines.neutralUse.${n.key}`)}</span>
                  <CopyValue value={n.hex} label={t('lines.copy', { value: n.hex })} copied={t('lines.copied')} />
                  <CopyValue value={n.oklch} label={t('lines.copy', { value: n.oklch })} copied={t('lines.copied')} />
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Tipografía. */}
        <section className="bp-section" id="tipografia" aria-labelledby="h-type">
          <SectionSign id="h-type" title={t('type.title')} />
          <div className="bp-wrap">
            <p className="bp-lead">{t('type.lead')}</p>
            <div className="bp-type-grid">
              <div className="bp-type-spec">
                <h3 className="bp-tag">{t('type.signage')}</h3>
                <p className="data bp-small">{t('type.signageSpec')}</p>
                <div className="bp-wdth-ramp" aria-hidden="true">
                  {[62, 75, 88, 100].map((w) => (
                    <span key={w} style={{ fontStretch: `${w}%` }}>
                      <span className="bp-wdth-sample">{t('type.signageSample')}</span>
                      <span className="data bp-small">wdth {w}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="bp-type-spec">
                <h3 className="bp-tag">{t('type.ui')}</h3>
                <p className="data bp-small">{t('type.uiSpec')}</p>
                <p className="bp-ui-sample">{t('type.uiSample')}</p>
                <h3 className="bp-tag">{t('type.data')}</h3>
                <p className="data bp-small">{t('type.dataSpec')}</p>
                <p className="data bp-data-sample">#7b4dff · 0,0083 × 3 = 0,025 · 2026-10-16 10:00</p>
              </div>
            </div>

            <h3 className="bp-h3">{t('type.scaleTitle')}</h3>
            <table className="bp-table bp-scale">
              <tbody>
                {SCALE.map((s) => (
                  <tr key={s.key}>
                    <th scope="row">
                      {t(`type.scale.${s.key}`)}
                      <span className="bp-small data">
                        {s.px}/{s.lh}
                        {s.cls === 'is-signage' ? ` · wdth ${s.wdth} · 800` : ''}
                      </span>
                    </th>
                    <td>
                      <span className={`bp-scale-sample ${s.cls}`} style={{ fontSize: `min(${s.px}px, ${(s.px / 4.2).toFixed(1)}vw + 12px)` }}>
                        {s.key === 'data' ? '#111111 · 0,44 R' : t('hero.title1')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="bp-actions">
              <a className="bp-btn" href="https://fonts.google.com/specimen/Archivo" target="_blank" rel="noreferrer">
                {t('type.download', { font: 'Archivo' })}
              </a>
              <a className="bp-btn bp-btn-quiet" href="https://fonts.google.com/specimen/JetBrains+Mono" target="_blank" rel="noreferrer">
                {t('type.download', { font: 'JetBrains Mono' })}
              </a>
            </div>
            <p className="bp-body bp-small">{t('type.license')}</p>
          </div>
        </section>

        {/* Voz. */}
        <section className="bp-section" id="voz" aria-labelledby="h-voice">
          <SectionSign id="h-voice" title={t('voice.title')} />
          <div className="bp-wrap">
            <p className="bp-lead">{t('voice.lead')}</p>
            <ol className="bp-voice">
              {VOICE.map((r) => (
                <li key={r}>
                  <div className="bp-voice-rule">
                    <h3 className="bp-h3">{t(`voice.rules.${r}.title`)}</h3>
                    <p className="bp-body">{t(`voice.rules.${r}.body`)}</p>
                  </div>
                  <div className="bp-voice-ex">
                    <p>
                      <span className="bp-tag">{t('voice.yes')}</span>
                      <span className="bp-ex">{t(`voice.rules.${r}.yes`)}</span>
                    </p>
                    <p className="is-no">
                      <span className="bp-tag">{t('voice.no')}</span>
                      <span className="bp-ex">{t(`voice.rules.${r}.no`)}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* La red, en texto. */}
        <section className="bp-section" id="red" aria-labelledby="h-network">
          <SectionSign id="h-network" title={t('network.title')} />
          <div className="bp-wrap">
            <p className="bp-lead">{t('network.lead')}</p>
            <div className="bp-map-scroll">
              <NetworkMap locale={locale} labels={mapLabels} className="bp-map-wide" />
            </div>
            <table className="bp-table bp-network">
              <thead>
                <tr>
                  <th scope="col">{t('network.colStation')}</th>
                  <th scope="col">{t('network.colLines')}</th>
                  <th scope="col">{t('network.colWhat')}</th>
                </tr>
              </thead>
              <tbody>
                {NET_STATIONS.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">
                      <a className="bp-station-link" href={`/${locale}/products/${s.href}`}>
                        <Station interchange={!s.external} size={18} />
                        {mapLabels.stations[s.id].name}
                      </a>
                    </th>
                    <td>
                      <span className="bp-line-list">
                        {s.lines.map((k) => (
                          <span key={k} className="bp-line-chip">
                            <LineGlyph product={k} size={14} />
                            {PRODUCT_CONFIG[k].name}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td>{mapLabels.stations[s.id].desc}</td>
                  </tr>
                ))}
                {NET_LINES.filter((l) => !NET_STATIONS.some((s) => s.lines.includes(l.key))).map((l) => (
                  <tr key={l.key}>
                    <th scope="row">
                      <a className="bp-station-link" href={`/${locale}/products/${l.key}`}>
                        <Station size={18} />
                        {PRODUCT_CONFIG[l.key].name}
                      </a>
                    </th>
                    <td>
                      <span className="bp-line-chip">
                        <LineGlyph product={l.key} size={14} />
                        {PRODUCT_CONFIG[l.key].name}
                      </span>
                    </td>
                    <td>{mapLabels.lines[l.key]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Prensa. */}
        <section className="bp-press" id="prensa" aria-labelledby="h-press">
          <div className="bp-wrap">
            <h2 id="h-press" className="bp-h2">
              {t('press.title')}
            </h2>
            <p className="bp-press-body">{t('press.body')}</p>
            <a className="bp-press-mail" href={`mailto:${PRESS_EMAIL}`}>
              {PRESS_EMAIL}
            </a>
            <div className="bp-actions">
              <a className="bp-btn bp-btn-white" href={KIT} download>
                {t('nav.download')}
              </a>
              <a className="bp-btn bp-btn-outline" href={GITHUB_URL} target="_blank" rel="noreferrer">
                {t('press.github')}
              </a>
            </div>
            <div className="bp-press-foot">
              <a href={`/${locale}`} aria-label={t('press.site')}>
                <Logo tone="white" height={20} title="" />
              </a>
              <span className="data">zerosoft.ai</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

/** Cartel de sección: la banda negra de señalética con su estación. */
function SectionSign({ id, title }: { id: string; title: string }) {
  return (
    <div className="bp-sign-band">
      <div className="bp-wrap bp-sign-inner">
        <Station size={28} ring="#ffffff" fill="#111111" />
        <h2 id={id} className="bp-h2">
          {title}
        </h2>
      </div>
    </div>
  );
}

/** El wordmark con su área de resguardo marcada en unidades de estación. */
function ClearSpace({ unit }: { unit: string }) {
  const d = WORDMARK.station.r * 2;
  const w = WORDMARK.width + d * 2;
  const h = WORDMARK.height + d * 2;
  const st = WORDMARK.station;
  return (
    <figure className="bp-clear">
      <svg viewBox={`-4 -4 ${w + 8} ${h + 8}`} role="img" aria-label={unit}>
        <rect x="0" y="0" width={w} height={h} className="bp-clear-zone" />
        <rect x={d} y={d} width={WORDMARK.width} height={WORDMARK.height} className="bp-clear-box" />
        <g transform={`translate(${d} ${d})`}>
          <path d={WORDMARK.letters} fill="#111111" />
          <circle cx={st.cx} cy={st.cy} r={st.r - st.ring / 2} fill="#ffffff" stroke="#111111" strokeWidth={st.ring} />
        </g>
        {/* Una estación por lado, como unidad de medida. */}
        {[
          [d / 2, h / 2],
          [w - d / 2, h / 2],
          [d + st.cx, d / 2],
          [d + st.cx, h - d / 2],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={st.r - st.ring / 2} className="bp-clear-unit" strokeWidth={st.ring} />
        ))}
      </svg>
      <figcaption>{unit} = ⌀ o</figcaption>
    </figure>
  );
}

/** La estación con su anillo acotado: 0,44 del radio. */
function StationAnatomy() {
  // Radio exterior 52, anillo 22,9 (0,44 R): el círculo se traza en el medio del anillo.
  return (
    <svg viewBox="0 0 240 132" width="240" height="132" role="img" aria-label="R · 0,44 R">
      <circle cx="64" cy="66" r="40.55" fill="#ffffff" stroke="#111111" strokeWidth="22.9" />
      <g className="bp-dim">
        <line x1="93.1" y1="10" x2="93.1" y2="58" />
        <line x1="116" y1="10" x2="116" y2="58" />
        <line x1="93.1" y1="16" x2="116" y2="16" />
        <line x1="64" y1="66" x2="116" y2="66" />
        <line x1="64" y1="118" x2="116" y2="118" />
        <line x1="64" y1="112" x2="64" y2="124" />
        <line x1="116" y1="112" x2="116" y2="124" />
      </g>
      <text x="126" y="21" className="bp-anatomy-label">0,44 R</text>
      <text x="126" y="123" className="bp-anatomy-label">R</text>
    </svg>
  );
}

/** Ejemplos de lo que no se hace con el logo (dibujados, no capturas). */
function MisuseArt({ kind }: { kind: (typeof MISUSE)[number] }) {
  const st = WORDMARK.station;
  const box = `0 0 ${WORDMARK.width} ${WORDMARK.height}`;
  switch (kind) {
    case 'stretch':
      return (
        <svg viewBox={box} preserveAspectRatio="none" className="bp-misuse-svg is-stretched">
          <path d={WORDMARK.letters} fill="#111111" />
          <circle cx={st.cx} cy={st.cy} r={st.r - st.ring / 2} fill="#ffffff" stroke="#111111" strokeWidth={st.ring} />
        </svg>
      );
    case 'color':
      return (
        <svg viewBox={box} className="bp-misuse-svg">
          <path d={WORDMARK.letters} fill="#111111" />
          <circle cx={st.cx} cy={st.cy} r={st.r - st.ring / 2} fill="#ffffff" stroke="var(--c-chat)" strokeWidth={st.ring} />
        </svg>
      );
    case 'caps':
      return <span className="bp-misuse-text is-serif">ZeroSoft</span>;
    case 'effects':
      return (
        <svg viewBox={box} className="bp-misuse-svg is-effects">
          <defs>
            <linearGradient id="misuse-grad" x1="0" x2="1">
              <stop offset="0" stopColor="#7b4dff" />
              <stop offset="1" stopColor="#e23d7f" />
            </linearGradient>
          </defs>
          <path d={WORDMARK.letters} fill="url(#misuse-grad)" />
          <circle cx={st.cx} cy={st.cy} r={st.r - st.ring / 2} fill="#ffffff" stroke="url(#misuse-grad)" strokeWidth={st.ring} />
        </svg>
      );
    case 'contrast':
      return (
        <span className="bp-misuse-contrast">
          <Logo tone="white" height={30} title="" />
        </span>
      );
    case 'glyph':
      return <span className="bp-misuse-text">zer0soft</span>;
  }
}
