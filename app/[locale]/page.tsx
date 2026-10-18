import { use, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import BrowserFrame from '@/components/products/BrowserFrame';
import ShowcaseTabs from '@/components/products/ShowcaseTabs';
import VideoPlayer from '@/components/VideoPlayer';
import LinkMockup from '@/components/products/mockups/LinkMockup';
import TrackMockup from '@/components/products/mockups/TrackMockup';
import CrmMockup from '@/components/products/mockups/CrmMockup';
import CalMockup from '@/components/products/mockups/CalMockup';
import DocsMockup from '@/components/products/mockups/DocsMockup';
import ChatMockup from '@/components/products/mockups/ChatMockup';
import AgentsMockup from '@/components/products/mockups/AgentsMockup';
import FlowMockup from '@/components/products/mockups/FlowMockup';
import Icon from '@/components/site/Icon';
import CodeTabs from '@/components/site/CodeTabs';
import SuiteGrid from '@/components/site/SuiteGrid';
import SectionSign from '@/components/site/SectionSign';
import HeroVisual from '@/components/site/HeroVisual';
import CloudPricing from '@/components/site/CloudPricing';
import TypedTerminal from '@/components/site/TypedTerminal';
import { ZeroEdge } from '@/components/zero/ZeroTexture';
import ProductLinks from '@/components/site/ProductLinks';
import ProductGlyph from '@/components/brand/ProductGlyph';
import { GITHUB_URL, INCUMBENTS, PRODUCT_NAMES, annualCost } from '@/components/site/catalog';
import { PRODUCT_CONFIG } from '@/lib/products';
import '@/styles/pages.css';

const SHOWCASE = [
  { key: 'crm', Mockup: CrmMockup },
  { key: 'chat', Mockup: ChatMockup },
  { key: 'agents', Mockup: AgentsMockup },
  { key: 'flow', Mockup: FlowMockup },
  { key: 'track', Mockup: TrackMockup },
  { key: 'link', Mockup: LinkMockup },
  { key: 'cal', Mockup: CalMockup },
  { key: 'docs', Mockup: DocsMockup },
] as const;

/** Orden de la tabla de costos: de la más cara a la más barata. */
const STACK_ORDER = ['crm', 'chat', 'cal', 'docs', 'track', 'link'] as const;

const FAQ = ['1', '2', '3', '4', '5', '6', '7'] as const;

export default function HomePage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = use(props.params);
  setRequestLocale(locale);
  const t = useTranslations('common');
  const h = useTranslations('common.home');
  const v = useTranslations('videos');

  const money = new Intl.NumberFormat(locale === 'en' ? 'en-US' : locale === 'es' ? 'es-AR' : 'pt-BR', {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  });
  const totals = STACK_ORDER.map((k) => annualCost(k));
  const total = totals.reduce((a, b) => a + b, 0);
  const maxRow = Math.max(...totals);

  return (
    <main id="top" className="lp">
      {/* Primer viewport: la tesis y el plano vivo de la suite. */}
      <section className="lp-hero" aria-labelledby="lp-title">
        <div className="lp-hero-copy">
          <h1 id="lp-title" className="lp-h1">
            {h('hero.title1')}
            <br />
            <span className="lp-h1-dim">{h('hero.title2')}</span>
          </h1>
          <p className="lp-sub">{h('hero.sub')}</p>
          <div className="lp-ctas">
            <Link className="btn btn-primary btn-lg" href="/app">
              {h('hero.ctaStart')}
            </Link>
            <a className="btn btn-secondary btn-lg" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Icon name="github" size={16} /> {h('hero.ctaSelfHost')}
            </a>
          </div>
          <p className="lp-notes">
            {h('hero.note1')} · {h('hero.note2')} ·{' '}
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              {h('hero.note3')}
            </a>
          </p>
        </div>
        <HeroVisual className="lp-hero-map" caption={h('hero.fig')} hint={h('hero.figHint')} />
      </section>

      {/* La app real, grabada: 48 s por seis apps. */}
      <section className="lp-section" id="tour" aria-labelledby="h-tour">
        <SectionSign id="h-tour" title={v('embedTitleDim')} />
        <div className="container lp-tour">
          <figure className="lp-video">
            <VideoPlayer
              src="/videos/zerosoft-intro.mp4"
              poster="/videos/zerosoft-intro.jpg"
              title={v('items.zerosoft-intro.title')}
            />
            <figcaption className="fig-cap">{h('tour.fig')}</figcaption>
          </figure>
          <div className="lp-tour-side">
            <p className="lp-lede">{v('items.zerosoft-intro.desc')}</p>
            <p className="lp-video-note">
              <Link href="/videos">{v('allVideos')}</Link>
            </p>
          </div>
        </div>
      </section>

      {/* Cada línea por dentro: vistas interactivas de las apps. */}
      <section className="lp-section" id="vistas" aria-labelledby="h-proof">
        <SectionSign id="h-proof" title={h('proof.title')} />
        <div className="container">
          <ShowcaseTabs
            label={h('proof.title')}
            tabs={SHOWCASE.map((p) => ({ key: p.key, label: PRODUCT_NAMES[p.key] }))}
            panels={SHOWCASE.map((p) => (
              <div key={p.key} className={`showcase-frame card-${p.key}`}>
                <BrowserFrame url={`zerosoft.ai/app/${PRODUCT_CONFIG[p.key].path}`}>
                  <p.Mockup />
                </BrowserFrame>
                <div className="lp-proof-foot">
                  <span className="fig-cap">{h('proof.caption', { name: PRODUCT_NAMES[p.key].toLowerCase() })}</span>
                  <Link href={`/products/${p.key}`} className="lp-textlink">
                    {h('suite.explore', { name: PRODUCT_NAMES[p.key] })} <Icon name="arrow" size={14} />
                  </Link>
                </div>
              </div>
            ))}
          />
        </div>
      </section>

      {/* La suite: once apps, dos audiencias. */}
      <section className="lp-section" id="productos" aria-labelledby="h-suite">
        <SectionSign id="h-suite" title={h('suite.title')} />
        <div className="container">
          <SuiteGrid cta={{ label: t('header.allProducts'), href: '/products' }} />
        </div>
      </section>

      {/* La cuenta: lo que se paga hoy a precio de lista. */}
      <section className="lp-section" id="stack" aria-labelledby="h-stack">
        <SectionSign id="h-stack" title={h('stack.title', { total: money.format(total) })} sub={h('stack.titleDim')} />
        <div className="container">
          <p className="lp-lede lp-lede-block">{h('stack.sub')}</p>
          <div className="stack">
            <div className="table-wrap">
              <table className="table stack-table">
                <caption className="sr-only">{h('stack.sub')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{h('stack.colTool')}</th>
                    <th scope="col">{h('stack.colPrice')}</th>
                    <th scope="col" className="stack-bar-col">
                      <span className="sr-only">{h('stack.colYear')}</span>
                    </th>
                    <th scope="col" className="num">
                      {h('stack.colYear')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {STACK_ORDER.map((k, i) => {
                    const inc = INCUMBENTS[k];
                    return (
                      <tr key={k}>
                        <th scope="row">
                          <span className="stack-tool">
                            <strong>{inc.rival}</strong>
                            <span className="stack-arrow">
                              <ProductGlyph product={k} size={12} /> {PRODUCT_NAMES[k]}
                            </span>
                          </span>
                        </th>
                        <td className="data stack-price">
                          {money.format(inc.monthly)} {inc.perUser ? h('stack.perUser') : h('stack.perMonth')}
                        </td>
                        <td className="stack-bar-col" aria-hidden="true">
                          <span className="stack-bar">
                            <i style={{ '--w': `${(totals[i] / maxRow) * 100}%`, '--bar': `var(--c-${k})` } as CSSProperties} />
                          </span>
                        </td>
                        <td className="num data">{money.format(totals[i])}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="stack-total">
                    <th scope="row">{h('stack.total')}</th>
                    <td />
                    <td className="stack-bar-col" />
                    <td className="num data">{money.format(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="stack-zero">
              <p className="stack-zero-label">{h('stack.zeroTitle')}</p>
              <span className="stack-zero-num">$0</span>
              <dl className="zero-receipt">
                {(
                  [
                    [h('stack.rApps'), '$0'],
                    [h('stack.rSeats'), '$0'],
                    [h('stack.rLicense'), 'AGPLv3'],
                    [h('stack.rData'), h('stack.vData')],
                  ] as const
                ).map(([k, val]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{val}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
          <p className="lp-footnote">{h('stack.footnote')}</p>
        </div>
      </section>

      {/* Precios: la regla y los dos números. */}
      <section className="lp-section" id="precios" aria-labelledby="h-pricing">
        <SectionSign id="h-pricing" title={t('pricing.title')} sub={t('pricing.titleDim')} />
        <div className="container">
          <p className="lp-lede lp-lede-block">{t('pricing.lead')}</p>
          <CloudPricing headingId="h-pricing" />
        </div>
      </section>

      {/* Open source: un comando. */}
      <section className="lp-section" id="open-source" aria-labelledby="h-oss">
        <SectionSign id="h-oss" title={h('oss.title')} sub={h('oss.titleDim')} />
        <div className="container lp-split">
          <div className="lp-split-text">
            <p className="lp-lede">{h('oss.p')}</p>
            <ul className="lp-checks">
              {(['b1', 'b2', 'b3', 'b4'] as const).map((b) => (
                <li key={b} className={b === 'b4' ? 'is-soon' : undefined}>
                  <span className="lp-check-box" aria-hidden="true">
                    {b === 'b4' ? '[ ]' : '[x]'}
                  </span>
                  {h(`oss.${b}`)}
                </li>
              ))}
            </ul>
            <div className="lp-ctas">
              <a className="btn btn-primary" href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Icon name="github" size={16} /> {h('oss.cta')}
              </a>
              <a className="btn btn-secondary" href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Icon name="star" size={15} /> {h('hero.star')}
              </a>
            </div>
          </div>
          <div className="lp-split-code">
            <TypedTerminal
              title={h('oss.terminal')}
              lines={[
                { kind: 'cmd', text: `git clone ${GITHUB_URL}` },
                { kind: 'cmd', text: 'cd zerosoft && cp .env.example .env' },
                { kind: 'cmd', text: 'docker compose up -d' },
                { kind: 'out', text: '# → http://localhost:3000' },
              ]}
            />
            <div className="term term-file">
              <div className="term-bar">
                <span className="term-title">{h('oss.compose')}</span>
              </div>
              <pre className="lp-code">
                <code>
                  <span className="tk-k">services</span>:{'\n'}
                  {'  '}
                  <span className="tk-k">zerosoft</span>:{'\n'}
                  {'    '}
                  <span className="tk-k">build</span>: .{'\n'}
                  {'    '}
                  <span className="tk-k">restart</span>: unless-stopped{'\n'}
                  {'    '}
                  <span className="tk-k">ports</span>: [<span className="tk-s">&quot;3000:3000&quot;</span>]{'\n'}
                  {'    '}
                  <span className="tk-k">env_file</span>: .env{'\n'}
                  {'    '}
                  <span className="tk-k">volumes</span>:{'\n'}
                  {'      '}- zerosoft-data:/app/data{'\n'}
                  {'      '}- zerosoft-uploads:/app/public/uploads
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Desarrolladores: API y webhooks. */}
      <section className="lp-section" id="developers" aria-labelledby="h-dev">
        <SectionSign id="h-dev" title={h('dev.title')} sub={h('dev.titleDim')} />
        <div className="container lp-split lp-split-rev">
          <div className="lp-split-text">
            <p className="lp-lede">{h('dev.p')}</p>
            <ul className="dev-list">
              {(['b1', 'b2', 'b3'] as const).map((b) => (
                <li key={b}>
                  <strong>{h(`dev.${b}t`)}</strong>
                  <p>{h(`dev.${b}`)}</p>
                </li>
              ))}
            </ul>
            <Link className="btn btn-primary" href="/docs">
              {h('dev.cta')}
            </Link>
          </div>
          <div className="lp-split-code">
            <CodeTabs
              id="dev-code"
              title={h('dev.label')}
              tabs={[h('dev.request'), h('dev.response'), h('dev.webhook')]}
              panels={[
                <pre className="lp-code" key="req">
                  <code>
                    <span className="tk-p">$ </span>curl -X <span className="tk-k">POST</span> https://zerosoft.ai/api/v1/links \{'\n'}
                    {'  '}-H <span className="tk-s">&quot;Authorization: Bearer zs_…&quot;</span> \{'\n'}
                    {'  '}-H <span className="tk-s">&quot;Content-Type: application/json&quot;</span> \{'\n'}
                    {'  '}-d <span className="tk-s">&apos;{'{'}</span>
                    {'\n'}
                    <span className="tk-s">
                      {'    '}&quot;url&quot;: &quot;https://zerosoft.ai/blog/software-is-dead&quot;,{'\n'}
                      {'    '}&quot;slug&quot;: &quot;manifesto&quot;,{'\n'}
                      {'    '}&quot;tags&quot;: [&quot;launch&quot;, &quot;blog&quot;]{'\n'}
                      {'  '}
                      {'}'}&apos;
                    </span>
                  </code>
                </pre>,
                <pre className="lp-code" key="res">
                  <code>
                    <span className="tk-c">{'// 201 Created'}</span>
                    {'\n{\n'}
                    {'  '}<span className="tk-k">&quot;id&quot;</span>: <span className="tk-s">&quot;lnk_9f3ka2&quot;</span>,{'\n'}
                    {'  '}<span className="tk-k">&quot;slug&quot;</span>: <span className="tk-s">&quot;manifesto&quot;</span>,{'\n'}
                    {'  '}<span className="tk-k">&quot;short_url&quot;</span>: <span className="tk-s">&quot;https://zs.ai/manifesto&quot;</span>,{'\n'}
                    {'  '}<span className="tk-k">&quot;url&quot;</span>: <span className="tk-s">&quot;https://zerosoft.ai/blog/software-is-dead&quot;</span>,{'\n'}
                    {'  '}<span className="tk-k">&quot;tags&quot;</span>: [<span className="tk-s">&quot;launch&quot;</span>, <span className="tk-s">&quot;blog&quot;</span>],{'\n'}
                    {'  '}<span className="tk-k">&quot;created_at&quot;</span>: <span className="tk-s">&quot;2026-07-14T18:22:41Z&quot;</span>
                    {'\n}'}
                  </code>
                </pre>,
                <pre className="lp-code" key="hook">
                  <code>
                    <span className="tk-k">POST</span> /webhooks/zerosoft{'\n'}
                    <span className="tk-c">Zerosoft-Signature: t=1762020000,v1=5f2c…</span>
                    {'\n\n{\n'}
                    {'  '}<span className="tk-k">&quot;type&quot;</span>: <span className="tk-s">&quot;link.clicked&quot;</span>,{'\n'}
                    {'  '}<span className="tk-k">&quot;data&quot;</span>: {'{\n'}
                    {'    '}<span className="tk-k">&quot;link&quot;</span>: {'{ '}<span className="tk-k">&quot;slug&quot;</span>: <span className="tk-s">&quot;manifesto&quot;</span>, … {'}'},{'\n'}
                    {'    '}<span className="tk-k">&quot;click&quot;</span>: {'{\n'}
                    {'      '}<span className="tk-k">&quot;referrer&quot;</span>: <span className="tk-s">&quot;news.ycombinator.com&quot;</span>,{'\n'}
                    {'      '}<span className="tk-k">&quot;country&quot;</span>: <span className="tk-s">&quot;AR&quot;</span>,{'\n'}
                    {'      '}<span className="tk-k">&quot;device&quot;</span>: <span className="tk-s">&quot;mobile&quot;</span>{'\n'}
                    {'    }\n  }\n}'}
                  </code>
                </pre>,
              ]}
            />
          </div>
        </div>
      </section>

      {/* Manifiesto */}
      <section className="lp-section" id="manifiesto" aria-labelledby="h-manifesto">
        <SectionSign id="h-manifesto" title={t('manifesto.final')} />
        <div className="container lp-manifesto">
          <p>{t.rich('manifesto.p1', { strong: (chunks) => <strong>{chunks}</strong> })}</p>
          <p>{t.rich('manifesto.p2', { strong: (chunks) => <strong>{chunks}</strong> })}</p>
          <p>{t('manifesto.p3')}</p>
          <p>{t('manifesto.p4')}</p>
          <p>{t('manifesto.p5')}</p>
        </div>
      </section>

      {/* Preguntas */}
      <section className="lp-section" id="faq" aria-labelledby="h-faq">
        <SectionSign id="h-faq" title={h('faq.title')} />
        <div className="container">
          <div className="faq">
            {FAQ.map((n) => (
              <details className="faq-item" key={n}>
                <summary>
                  {h(`faq.q${n}`)}
                  <span className="faq-plus" aria-hidden="true" />
                </summary>
                <p className="faq-a">{h(`faq.a${n}`)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Cierre: la página se vuelve tinta, de a ceros, y la banda con las once apps. */}
      <ZeroEdge />
      <section className="lp-end" id="sumate" aria-labelledby="h-end">
        <div className="container lp-end-inner">
          <h2 id="h-end">
            {h('end.title1')}
            <br />
            <span>{h('end.title2')}</span>
          </h2>
          <p className="lp-end-sub">{h('end.sub')}</p>
          <div className="lp-ctas">
            <Link className="btn btn-invert-solid btn-lg" href="/app">
              {h('hero.ctaStart')}
            </Link>
            <a className="btn btn-invert btn-lg" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Icon name="github" size={16} /> {h('hero.ctaSelfHost')}
            </a>
          </div>
          <ProductLinks label={t('header.products')} />
        </div>
      </section>
    </main>
  );
}
