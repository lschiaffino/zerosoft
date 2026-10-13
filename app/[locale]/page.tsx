import { use, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import ZeroField from '@/components/ZeroField';
import Reveal from '@/components/Reveal';
import BrowserFrame from '@/components/products/BrowserFrame';
import ShowcaseTabs from '@/components/products/ShowcaseTabs';
import LinkMockup from '@/components/products/mockups/LinkMockup';
import TrackMockup from '@/components/products/mockups/TrackMockup';
import CrmMockup from '@/components/products/mockups/CrmMockup';
import CalMockup from '@/components/products/mockups/CalMockup';
import DocsMockup from '@/components/products/mockups/DocsMockup';
import ChatMockup from '@/components/products/mockups/ChatMockup';
import Icon from '@/components/site/Icon';
import CodeTabs from '@/components/site/CodeTabs';
import SuiteGrid from '@/components/site/SuiteGrid';
import { GITHUB_URL, INCUMBENTS, PRODUCT_NAMES, SITE_PRODUCTS, annualCost } from '@/components/site/catalog';
import { PRODUCT_CONFIG } from '@/lib/products';
import '@/styles/pages.css';

const SHOWCASE = [
  { key: 'crm', path: 'crm', Mockup: CrmMockup },
  { key: 'link', path: 'links', Mockup: LinkMockup },
  { key: 'cal', path: 'calendar', Mockup: CalMockup },
  { key: 'track', path: 'track', Mockup: TrackMockup },
  { key: 'chat', path: 'chat', Mockup: ChatMockup },
  { key: 'docs', path: 'docs', Mockup: DocsMockup },
] as const;

/** Orden de la tabla de costos: de la más cara a la más barata. */
const STACK_ORDER = ['crm', 'chat', 'cal', 'docs', 'track', 'link'] as const;

const FAQ = ['1', '2', '3', '4', '5', '6'] as const;

export default function HomePage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = use(props.params);
  setRequestLocale(locale);
  const t = useTranslations('common');
  const h = useTranslations('common.home');

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
      {/* HERO */}
      <section className="lp-hero">
        <div className="lp-hero-field" aria-hidden="true">
          <ZeroField
            align="right"
            sizeFactor={0.86}
            accents={['47,107,255', '123,77,255', '14,159,110', '242,97,29', '226,61,127', '194,112,10']}
          />
        </div>
        <div className="container lp-hero-inner">
          <a className="lp-kicker" href="#manifiesto">
            <span className="lp-kicker-zero" aria-hidden="true">0</span>
            <span>{h('hero.kicker')}</span>
            <span className="lp-kicker-link">
              {h('hero.kickerLink')} <Icon name="arrow" size={14} />
            </span>
          </a>
          <h1 className="lp-h1">
            {h('hero.title1')}
            <br />
            <span className="lp-h1-dim">{h('hero.title2')}</span>
          </h1>
          <p className="lp-sub">{h('hero.sub')}</p>
          <div className="lp-ctas">
            <Link className="btn btn-solid btn-lg" href="/app">
              {h('hero.ctaStart')} <Icon name="arrow" size={16} />
            </Link>
            <a className="btn btn-ghost btn-lg" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Icon name="github" size={16} /> {h('hero.ctaSelfHost')}
            </a>
          </div>
          <ul className="lp-notes">
            <li>
              <Icon name="check" size={14} /> {h('hero.note1')}
            </li>
            <li>
              <Icon name="check" size={14} /> {h('hero.note2')}
            </li>
            <li>
              <a className="lp-gh-badge" href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Icon name="star" size={13} /> {h('hero.star')}
                <span className="lp-gh-badge-sep" aria-hidden="true" />
                {h('hero.note3')}
              </a>
            </li>
          </ul>
        </div>
      </section>

      {/* PRODUCT PROOF */}
      <section className="lp-proof container" aria-label={t('showcase.label')}>
        <ShowcaseTabs
          tabs={SHOWCASE.map((p) => ({ key: p.key, label: PRODUCT_NAMES[p.key], tag: t(`products.${p.key}.tag`) }))}
          panels={SHOWCASE.map((p) => (
            <div key={p.key} className={`showcase-frame card-${p.key}`}>
              <BrowserFrame url={`zerosoft.ai/app/${p.path}`}>
                <p.Mockup />
              </BrowserFrame>
              <div className="lp-proof-foot">
                <span>{h('proof.caption')}</span>
                <Link href={`/products/${p.key}`} className="lp-textlink">
                  {h('suite.explore', { name: PRODUCT_NAMES[p.key] })} <Icon name="arrow" size={14} />
                </Link>
              </div>
            </div>
          ))}
        />
      </section>

      {/* REPLACES */}
      <div className="lp-replaces container" aria-label={h('replaces')}>
        <span className="lp-replaces-label">{h('replaces')}</span>
        <ul>
          {SITE_PRODUCTS.map((k) => (
            <li key={k} className={`card-${k}`}>
              <s>{INCUMBENTS[k].rival}</s>
              <Icon name="arrow" size={12} />
              <span>{PRODUCT_NAMES[k]}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* SUITE */}
      <section className="lp-section container" id="productos">
        <div className="lp-head">
          <p className="section-label">{h('suite.label')}</p>
          <Reveal as="h2" className="lp-title">
            {h('suite.title')} <span className="dim">{h('suite.titleDim')}</span>
          </Reveal>
        </div>
        <SuiteGrid cta={{ label: t('header.allProducts'), href: '/products' }} />
      </section>

      {/* STACK MATH */}
      <section className="lp-section lp-section-tint" id="stack">
        <div className="container">
          <div className="lp-head">
            <p className="section-label">{h('stack.label')}</p>
            <Reveal as="h2" className="lp-title">
              {h('stack.title', { total: money.format(total) })} <span className="dim">{h('stack.titleDim')}</span>
            </Reveal>
            <p className="lp-lede">{h('stack.sub')}</p>
          </div>
          <div className="stack">
            <Reveal className="stack-table" as="div">
              <div className="stack-row stack-row-head" aria-hidden="true">
                <span>{h('stack.colTool')}</span>
                <span>{h('stack.colPrice')}</span>
                <span />
                <span>{h('stack.colYear')}</span>
              </div>
              {STACK_ORDER.map((k, i) => {
                const inc = INCUMBENTS[k];
                return (
                  <div key={k} className={`stack-row card-${k}`}>
                    <span className="stack-tool">
                      <i className="stack-dot" aria-hidden="true" />
                      <strong>{inc.rival}</strong>
                      <span className="stack-arrow">→ {PRODUCT_NAMES[k]}</span>
                    </span>
                    <span className="stack-price">
                      {money.format(inc.monthly)} {inc.perUser ? h('stack.perUser') : h('stack.perMonth')}
                    </span>
                    <span className="stack-bar" aria-hidden="true">
                      <i style={{ '--w': `${(totals[i] / maxRow) * 100}%` } as CSSProperties} />
                    </span>
                    <span className="stack-year">{money.format(totals[i])}</span>
                  </div>
                );
              })}
              <div className="stack-row stack-total">
                <span>{h('stack.total')}</span>
                <span />
                <span />
                <span className="stack-year">{money.format(total)}</span>
              </div>
            </Reveal>
            <Reveal className="stack-zero">
              <p className="stack-zero-label">{h('stack.zeroTitle')}</p>
              <span className="stack-zero-num">$0</span>
              <p className="stack-zero-note">{h('stack.zeroNote')}</p>
              <p className="stack-zero-cloud">{h('stack.cloudNote')}</p>
              <a className="btn btn-invert" href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Icon name="github" size={15} /> {h('hero.ctaSelfHost')}
              </a>
            </Reveal>
          </div>
          <p className="lp-footnote">{h('stack.footnote')}</p>
        </div>
      </section>

      {/* OPEN SOURCE */}
      <section className="lp-section lp-dark" id="open-source">
        <div className="container lp-split">
          <div className="lp-split-text">
            <p className="section-label light">{h('oss.label')}</p>
            <Reveal as="h2" className="lp-title">
              {h('oss.title')} <span className="dim">{h('oss.titleDim')}</span>
            </Reveal>
            <p className="lp-lede">{h('oss.p')}</p>
            <ul className="lp-checks">
              {(['b1', 'b2', 'b3', 'b4'] as const).map((b) => (
                <li key={b} className={b === 'b4' ? 'is-soon' : undefined}>
                  <Icon name={b === 'b4' ? 'clock' : 'check'} size={16} />
                  {h(`oss.${b}`)}
                </li>
              ))}
            </ul>
            <div className="lp-ctas">
              <a className="btn btn-invert-solid" href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Icon name="github" size={16} /> {h('oss.cta')}
              </a>
              <a className="btn btn-invert" href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Icon name="star" size={15} /> {h('hero.star')}
              </a>
            </div>
          </div>
          <div className="lp-split-code">
            <Reveal className="term">
              <div className="term-bar">
                <span className="code-win-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="term-title">{h('oss.terminal')}</span>
              </div>
              <pre className="lp-code">
                <code>
                  <span className="tk-p">$ </span>git clone {GITHUB_URL}
                  {'\n'}
                  <span className="tk-p">$ </span>cd zerosoft && cp .env.example .env
                  {'\n'}
                  <span className="tk-p">$ </span>docker compose up -d
                  {'\n'}
                  <span className="tk-c"># → http://localhost:3000</span>
                </code>
              </pre>
            </Reveal>
            <Reveal className="term term-file">
              <div className="term-bar">
                <span className="code-win-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
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
            </Reveal>
          </div>
        </div>
      </section>

      {/* DEVELOPERS */}
      <section className="lp-section container" id="developers">
        <div className="lp-split lp-split-rev">
          <div className="lp-split-text">
            <p className="section-label">{h('dev.label')}</p>
            <Reveal as="h2" className="lp-title">
              {h('dev.title')} <span className="dim">{h('dev.titleDim')}</span>
            </Reveal>
            <p className="lp-lede">{h('dev.p')}</p>
            <ul className="dev-list">
              {(
                [
                  ['b1', 'code'],
                  ['b2', 'key'],
                  ['b3', 'plug'],
                ] as const
              ).map(([b, icon]) => (
                <li key={b}>
                  <span className="dev-icon">
                    <Icon name={icon} size={18} />
                  </span>
                  <div>
                    <strong>{h(`dev.${b}t`)}</strong>
                    <p>{h(`dev.${b}`)}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Link className="btn btn-solid" href="/docs">
              {h('dev.cta')} <Icon name="arrow" size={14} />
            </Link>
          </div>
          <Reveal className="lp-split-code">
            <CodeTabs
              id="dev-code"
              title={h('dev.label')}
              tabs={[h('dev.request'), h('dev.response'), h('dev.webhook')]}
              panels={[
                <pre className="lp-code" key="req">
                  <code>
                    curl -X <span className="tk-k">POST</span> https://zerosoft.ai/api/v1/links \{'\n'}
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
          </Reveal>
        </div>
      </section>

      {/* MODEL */}
      <section className="lp-section lp-section-tint" id="modelo">
        <div className="container">
          <div className="lp-head">
            <p className="section-label">{h('model.label')}</p>
            <Reveal as="h2" className="lp-title">
              {t('model.title')} <span className="dim">{t('model.titleDim')}</span>
            </Reveal>
          </div>
          <div className="plans">
            {(['a', 'b', 'c'] as const).map((key) => (
              <Reveal key={key} className={`plan${key === 'b' ? ' plan-featured' : ''}`}>
                <div className="plan-top">
                  <span className="plan-icon">
                    <Icon name={key === 'a' ? 'server' : key === 'b' ? 'globe' : 'shield'} size={18} />
                  </span>
                  <h3>{t(`model.${key}.title`)}</h3>
                </div>
                <p className="plan-price">
                  {t(`model.${key}.price`)} <span>{t(`model.${key}.priceNote`)}</span>
                </p>
                <p className="plan-desc">{t(`model.${key}.desc`)}</p>
                {key === 'a' ? (
                  <a className="btn btn-ghost" href={GITHUB_URL} target="_blank" rel="noreferrer">
                    <Icon name="github" size={15} /> {h('hero.ctaSelfHost')}
                  </a>
                ) : key === 'b' ? (
                  <Link className="btn btn-invert-solid" href="/app">
                    {h('hero.ctaStart')} <Icon name="arrow" size={14} />
                  </Link>
                ) : (
                  <a className="btn btn-ghost" href="mailto:hola@zerosoft.ai">
                    {t(`model.c.price`)} <Icon name="arrow" size={14} />
                  </a>
                )}
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* MANIFESTO */}
      <section className="lp-section container lp-manifesto" id="manifiesto">
        <div className="lp-manifesto-side">
          <p className="section-label">{h('manifesto.label')}</p>
          <p className="lp-manifesto-final">{t('manifesto.final')}</p>
        </div>
        <div className="lp-manifesto-body">
          <Reveal as="p">{t.rich('manifesto.p1', { strong: (chunks) => <strong>{chunks}</strong> })}</Reveal>
          <Reveal as="p">{t.rich('manifesto.p2', { strong: (chunks) => <strong>{chunks}</strong> })}</Reveal>
          <Reveal as="p">{t('manifesto.p3')}</Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section className="lp-section container lp-faq" id="faq">
        <div className="lp-faq-side">
          <p className="section-label">{h('faq.label')}</p>
          <h2 className="lp-title">
            {h('faq.title')} <span className="dim">{h('faq.titleDim')}</span>
          </h2>
        </div>
        <div className="faq">
          {FAQ.map((n) => (
            <details className="faq-item" key={n}>
              <summary>
                {h(`faq.q${n}`)}
                <span className="faq-plus" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="faq-a">{h(`faq.a${n}`)}</p>
            </details>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="lp-end" id="sumate">
        <span className="lp-end-zero" aria-hidden="true">
          0
        </span>
        <div className="container lp-end-inner">
          <p className="section-label light">{h('end.label')}</p>
          <h2>
            {h('end.title1')}
            <br />
            <span>{h('end.title2')}</span>
          </h2>
          <p className="lp-end-sub">{h('end.sub')}</p>
          <div className="lp-ctas lp-ctas-center">
            <Link className="btn btn-invert-solid btn-lg" href="/app">
              {h('hero.ctaStart')} <Icon name="arrow" size={16} />
            </Link>
            <a className="btn btn-invert btn-lg" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Icon name="github" size={16} /> {h('hero.ctaSelfHost')}
            </a>
          </div>
          <ul className="lp-end-apps" aria-label={t('header.products')}>
            {SITE_PRODUCTS.map((k) => (
              <li key={k} className={`card-${k}`}>
                <Link href={PRODUCT_CONFIG[k].launch}>
                  <i aria-hidden="true" />
                  {PRODUCT_NAMES[k]}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
