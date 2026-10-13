import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setAiModelOverride } from '@/lib/ai';
import { RESERVED_SLUGS } from '@/lib/reserved';
import { computeInvoice, currencyDigits } from '@/lib/tools/invoice';
import { generatePolicy, policyToHtml, policyToMarkdown, type PolicyInput } from '@/lib/tools/privacy-policy';
import { fallbackBlogIdeas, fallbackBusinessNames, runAiTool, TOOLS_AI_LIMIT_PER_HOUR } from '@/lib/tools/ai-tools';
import { analyzePage, gradeWebsite, GradeError, type Fetcher } from '@/lib/tools/website-grader';
import { qrPayload, EMPTY_QR_FIELDS } from '@/lib/tools/qr-payload';
import { renderSignature, SIGNATURE_TEMPLATES } from '@/lib/tools/signature';
import { SAAS_TOOLS, totalYearly } from '@/lib/tools/saas-costs';
import { TOOLS } from '@/lib/tools/registry';
import { failingModel, mockModel } from './ai-mock';

const ROOT = path.resolve(__dirname, '../..');

// ---------- Facturas ----------

describe('invoice math', () => {
  it('suma líneas, impuestos por alícuota y redondea a centavos', () => {
    const r = computeInvoice([
      { description: 'A', qty: 3, price: 19.99, taxRate: 21 },
      { description: 'B', qty: 1, price: 0.1, taxRate: 21 },
      { description: 'C', qty: 2, price: 10, taxRate: 10.5 },
    ]);
    expect(r.subtotal).toBe(80.07); // 59.97 + 0.10 + 20
    // 21% de 59.97 = 12.5937 → 12.59; de 0.10 = 0.021 → 0.02; 10.5% de 20 = 2.10
    expect(r.taxes).toEqual([
      { rate: 10.5, base: 20, amount: 2.1 },
      { rate: 21, base: 60.07, amount: 12.61 },
    ]);
    expect(r.tax).toBe(14.71);
    expect(r.total).toBe(94.78);
  });

  it('descuento porcentual antes de impuestos, repartido entre líneas', () => {
    const r = computeInvoice(
      [
        { description: 'A', qty: 1, price: 100, taxRate: 20 },
        { description: 'B', qty: 1, price: 50, taxRate: 0 },
      ],
      { type: 'percent', value: 10 },
    );
    expect(r.subtotal).toBe(150);
    expect(r.discount).toBe(15);
    expect(r.lines.map((l) => l.discount)).toEqual([10, 5]);
    expect(r.tax).toBe(18); // 20% de 90
    expect(r.total).toBe(153);
  });

  it('descuento fijo no supera el subtotal y el reparto cierra exacto', () => {
    const r = computeInvoice(
      [
        { description: 'A', qty: 1, price: 33.33, taxRate: 0 },
        { description: 'B', qty: 1, price: 33.33, taxRate: 0 },
        { description: 'C', qty: 1, price: 33.34, taxRate: 0 },
      ],
      { type: 'amount', value: 10 },
    );
    expect(r.lines.reduce((a, l) => a + Math.round(l.discount * 100), 0)).toBe(1000);
    expect(r.total).toBe(90);
    const capped = computeInvoice([{ description: 'A', qty: 1, price: 5, taxRate: 10 }], { type: 'amount', value: 50 });
    expect(capped.discount).toBe(5);
    expect(capped.total).toBe(0);
  });

  it('respeta los decimales de la moneda (JPY sin centavos) y evita errores de float', () => {
    expect(currencyDigits('JPY')).toBe(0);
    expect(currencyDigits('USD')).toBe(2);
    const jpy = computeInvoice([{ description: 'A', qty: 3, price: 333.5, taxRate: 10 }], undefined, 0);
    expect(jpy.subtotal).toBe(1001); // 1000.5 → 1001
    expect(jpy.tax).toBe(100);
    expect(computeInvoice([{ description: 'x', qty: 1, price: 1.005, taxRate: 0 }]).subtotal).toBe(1.01);
    expect(computeInvoice([{ description: 'x', qty: 3, price: 0.1, taxRate: 0 }]).subtotal).toBe(0.3);
  });

  it('valores inválidos cuentan como 0', () => {
    const r = computeInvoice([{ description: 'x', qty: Number.NaN, price: 10, taxRate: Number.NaN }]);
    expect(r.total).toBe(0);
  });
});

// ---------- Política de privacidad ----------

const BASE_POLICY: PolicyInput = {
  company: 'Acme Inc.',
  website: 'acme.com',
  email: 'privacy@acme.com',
  address: '',
  jurisdiction: 'other',
  effectiveDate: '2026-10-01',
  data: ['contact'],
  cookies: false,
  analytics: false,
  ads: false,
  newsletter: false,
  thirdParties: [],
  noChildren: false,
};

describe('privacy policy generator', () => {
  it('incluye solo las secciones que corresponden a lo elegido', () => {
    const minimal = generatePolicy(BASE_POLICY, 'en');
    const ids = minimal.sections.map((s) => s.id);
    expect(ids).toContain('collect');
    expect(ids).toContain('contact');
    expect(ids).not.toContain('cookies');
    expect(ids).not.toContain('third');
    expect(ids).not.toContain('children');
    expect(ids).not.toContain('legalBasis');

    const full = generatePolicy(
      {
        ...BASE_POLICY,
        jurisdiction: 'eu',
        data: ['contact', 'payment', 'location'],
        cookies: true,
        analytics: true,
        ads: true,
        newsletter: true,
        thirdParties: ['stripe', 'google-analytics'],
        noChildren: true,
      },
      'en',
    );
    const fids = full.sections.map((s) => s.id);
    for (const id of ['cookies', 'third', 'children', 'newsletter', 'legalBasis', 'transfers', 'juris-eu']) {
      expect(fids).toContain(id);
    }
    const md = policyToMarkdown(full);
    expect(md).toContain('Stripe: payment processing.');
    expect(md).toContain('Google Analytics');
    expect(md).toContain('payment details');
    expect(md).toContain('GDPR');
    expect(md).toContain('not legal advice');
  });

  it('sale en el idioma de la página, con la jurisdicción elegida', () => {
    const es = generatePolicy({ ...BASE_POLICY, jurisdiction: 'ar', cookies: true }, 'es');
    expect(es.title).toBe('Política de privacidad — Acme Inc.');
    expect(es.sections.find((s) => s.id === 'cookies')?.title).toBe('Cookies y tecnologías similares');
    expect(policyToMarkdown(es)).toContain('Ley 25.326');
    const pt = generatePolicy({ ...BASE_POLICY, jurisdiction: 'br' }, 'pt');
    expect(policyToMarkdown(pt)).toContain('LGPD');
    expect(pt.sections.map((s) => s.id)).toContain('legalBasis');
  });

  it('el HTML escapa lo que escribe la persona', () => {
    const html = policyToHtml(generatePolicy({ ...BASE_POLICY, company: '<script>x</script>' }, 'en'));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ---------- Website grader ----------

const GOOD_HTML = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acme — Accounting software for small teams</title>
<meta name="description" content="Acme helps small teams send invoices, track expenses and close the books in minutes, not days.">
<link rel="canonical" href="https://acme.test/"><link rel="icon" href="/favicon.ico">
<meta property="og:title" content="Acme"><meta property="og:description" content="Accounting"><meta property="og:image" content="https://acme.test/og.png">
<script src="/app.js" defer></script>
</head><body><h1>Accounting, simplified</h1>
<img src="/a.png" alt="Dashboard"><a href="/pricing">Pricing</a>
<label for="email">Email</label><input id="email" type="email">
</body></html>`;

const BAD_HTML = `<html><head><script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script></head>
<body><img src="/x.png"><img src="/y.png"><a href="/"><span></span></a><input type="text"><input type="email"></body></html>`;

function headers(obj: Record<string, string>) {
  return new Headers(obj);
}

describe('website grader', () => {
  it('una página bien armada saca 100', () => {
    const r = analyzePage({
      url: 'https://acme.test/',
      finalUrl: 'https://acme.test/',
      status: 200,
      html: GOOD_HTML,
      bytes: 20_000,
      ms: 250,
      headers: headers({
        'content-encoding': 'br',
        'cache-control': 'public, max-age=300',
        'strict-transport-security': 'max-age=63072000',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin',
      }),
      robotsTxt: true,
      sitemap: true,
    });
    expect(r.checks.filter((c) => c.status !== 'pass').map((c) => c.id)).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.categories.every((c) => c.score === 100)).toBe(true);
    expect(r.checks.reduce((a, c) => a + c.weight, 0)).toBe(100);
  });

  it('una página floja pierde puntos donde corresponde', () => {
    const r = analyzePage({
      url: 'http://slow.test/',
      finalUrl: 'http://slow.test/',
      status: 200,
      html: BAD_HTML,
      bytes: 900_000,
      ms: 3500,
      headers: headers({}),
      robotsTxt: false,
      sitemap: false,
    });
    const byId = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
    expect(byId).toMatchObject({
      https: 'fail',
      responseTime: 'fail',
      pageWeight: 'fail',
      compression: 'fail',
      renderBlocking: 'fail',
      title: 'fail',
      metaDescription: 'fail',
      h1: 'fail',
      viewport: 'fail',
      lang: 'fail',
      imageAlt: 'fail',
      linkText: 'warn',
      formLabels: 'fail',
      indexable: 'pass',
    });
    expect(r.score).toBeLessThan(15);
  });

  it('detecta noindex', () => {
    const html = GOOD_HTML.replace('<title>', '<meta name="robots" content="noindex"><title>');
    const r = analyzePage({
      url: 'https://a.test/', finalUrl: 'https://a.test/', status: 200, html, bytes: 1000, ms: 100,
      headers: headers({}), robotsTxt: true, sitemap: true,
    });
    expect(r.checks.find((c) => c.id === 'indexable')?.status).toBe('fail');
  });

  it('gradeWebsite sigue redirects, mira robots.txt/sitemap y usa el fetcher (mock)', async () => {
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      calls.push(url);
      if (url === 'https://acme.test/') {
        return new Response(null, { status: 301, headers: { location: 'https://www.acme.test/' } });
      }
      if (url === 'https://www.acme.test/') {
        return new Response(GOOD_HTML, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip', etag: 'x' },
        });
      }
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nSitemap: https://www.acme.test/sm.xml', { status: 200 });
      return new Response('not found', { status: 404 });
    };
    const r = await gradeWebsite('acme.test', fetcher);
    expect(r.finalUrl).toBe('https://www.acme.test/');
    expect(calls).toContain('https://www.acme.test/robots.txt');
    expect(r.checks.find((c) => c.id === 'robotsTxt')?.status).toBe('pass');
    expect(r.checks.find((c) => c.id === 'sitemap')?.status).toBe('pass'); // declarado en robots.txt
    expect(r.checks.find((c) => c.id === 'compression')?.status).toBe('pass');
    expect(r.pagespeed).toBeNull();
    expect(r.score).toBeGreaterThan(80);
  });

  it('errores: URL inválida, no-HTML y hosts privados (safeFetch real)', async () => {
    await expect(gradeWebsite('not a url')).rejects.toMatchObject({ code: 'invalid_url' });
    const pdf: Fetcher = async () => new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } });
    await expect(gradeWebsite('https://a.test/file', pdf)).rejects.toMatchObject({ code: 'not_html' });
    const err = await gradeWebsite('http://127.0.0.1/').catch((e) => e);
    expect(err).toBeInstanceOf(GradeError);
    expect(err.code).toBe('private_host');
  });
});

// ---------- Herramientas con AI ----------

describe('AI tools: rate limit y fallback', () => {
  const saved: Record<string, string | undefined> = {};
  const KEYS = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'VERCEL', 'AI_ENABLED', 'RATE_LIMIT_DISABLED'];
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    setAiModelOverride(null);
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const ip = () => `203.0.113.${Math.floor(Math.random() * 250)}-${crypto.randomUUID().slice(0, 6)}`;

  it('con AI usa el modelo y devuelve el objeto validado', async () => {
    const model = mockModel(JSON.stringify({ names: [{ name: 'Brewly', tagline: 'Coffee, fast.', domain: 'brewly.com' }] }));
    setAiModelOverride(model);
    const r = await runAiTool('business-names', { keywords: 'coffee delivery' }, ip());
    expect(r).toMatchObject({ status: 'ok', source: 'ai', data: { names: [{ name: 'Brewly' }] } });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0].maxOutputTokens).toBe(700);
  });

  it('sin AI configurada: nombres y blog caen al generador sin AI; emails avisan', async () => {
    const names = await runAiTool('business-names', { keywords: 'coffee delivery', language: 'es' }, ip());
    expect(names.status).toBe('ok');
    if (names.status === 'ok') {
      expect(names.source).toBe('fallback');
      expect(names.data.names.length).toBeGreaterThan(3);
    }
    const blog = await runAiTool('blog-ideas', { topic: 'facturación', language: 'es' }, ip());
    expect(blog).toMatchObject({ status: 'ok', source: 'fallback', reason: 'ai_disabled' });
    const copy = await runAiTool('copy', { mode: 'email', goal: 'book a demo' }, ip());
    expect(copy).toEqual({ status: 'unavailable', reason: 'ai_disabled' });
  });

  it('si el modelo falla, fallback con reason ai_error', async () => {
    setAiModelOverride(failingModel());
    const r = await runAiTool('blog-ideas', { topic: 'invoicing' }, ip());
    expect(r).toMatchObject({ status: 'ok', source: 'fallback', reason: 'ai_error' });
  });

  it(`límite estricto por IP (${TOOLS_AI_LIMIT_PER_HOUR}/hora): después no llama al modelo`, async () => {
    const model = mockModel(JSON.stringify({ ideas: [{ title: 'T', angle: 'A' }] }));
    setAiModelOverride(model);
    const addr = ip();
    for (let i = 0; i < TOOLS_AI_LIMIT_PER_HOUR; i++) {
      const r = await runAiTool('blog-ideas', { topic: 'seo' }, addr);
      expect(r).toMatchObject({ source: 'ai' });
    }
    const blocked = await runAiTool('blog-ideas', { topic: 'seo' }, addr);
    expect(blocked).toMatchObject({ status: 'ok', source: 'fallback', reason: 'rate_limited' });
    const persona = await runAiTool('persona', { product: 'CRM for dentists' }, addr);
    expect(persona).toEqual({ status: 'unavailable', reason: 'rate_limited' });
    expect(model.doGenerateCalls).toHaveLength(TOOLS_AI_LIMIT_PER_HOUR);
    // Otra IP sigue pudiendo.
    expect(await runAiTool('blog-ideas', { topic: 'seo' }, ip())).toMatchObject({ source: 'ai' });
  });

  it('valida la entrada (sin llamar al modelo)', async () => {
    const model = mockModel('{}');
    setAiModelOverride(model);
    expect(await runAiTool('business-names', { keywords: '' }, ip())).toEqual({ status: 'invalid' });
    expect(await runAiTool('copy', { mode: 'sms', goal: 'x'.repeat(10) }, ip())).toEqual({ status: 'invalid' });
    expect(await runAiTool('blog-ideas', { topic: 'x'.repeat(500) }, ip())).toEqual({ status: 'invalid' });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('fallbacks deterministas', () => {
    let seed = 1;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const out = fallbackBusinessNames({ keywords: 'café verde', industry: '', style: 'modern', language: 'en' }, rand);
    expect(out.names.length).toBeGreaterThan(3);
    for (const n of out.names) {
      expect(n.domain).toMatch(/^[a-z0-9]+\.(com|io|co|app|ai)$/);
    }
    const ideas = fallbackBlogIdeas({ topic: 'invoicing', audience: 'freelancers', language: 'en' });
    expect(ideas.ideas).toHaveLength(10);
    expect(ideas.ideas[0].title).toContain('invoicing');
  });
});

// ---------- Otras utilidades ----------

describe('otras herramientas', () => {
  it('QR: Wi-Fi escapa caracteres y vCard arma el formato', () => {
    expect(qrPayload('wifi', { ...EMPTY_QR_FIELDS, ssid: 'My;Net', password: 'p:a"ss', security: 'WPA' })).toBe(
      'WIFI:T:WPA;S:My\\;Net;P:p\\:a\\"ss;;',
    );
    const v = qrPayload('vcard', { ...EMPTY_QR_FIELDS, firstName: 'Ana', lastName: 'Pérez', org: 'Acme, Inc' });
    expect(v).toContain('FN:Ana Pérez');
    expect(v).toContain('ORG:Acme\\, Inc');
    expect(qrPayload('url', { ...EMPTY_QR_FIELDS, url: 'acme.com' })).toBe('https://acme.com');
    expect(qrPayload('email', { ...EMPTY_QR_FIELDS, to: 'a@b.co', subject: 'Hola mundo' })).toBe('mailto:a@b.co?subject=Hola%20mundo');
  });

  it('firma: escapa HTML, filtra URLs peligrosas y sigue el idioma', () => {
    const data = {
      name: '<b>Ana</b>',
      title: 'CEO',
      company: 'Acme',
      phone: '+54 11 5555-5555',
      email: 'ana@acme.com',
      website: 'javascript:alert(1)',
      photoUrl: '',
      accent: 'red;background:url(x)',
      meetingUrl: 'zerosoft.ai/book/ana',
      socials: { linkedin: 'linkedin.com/in/ana' },
    };
    for (const tpl of SIGNATURE_TEMPLATES) {
      const html = renderSignature(tpl, data, 'es');
      expect(html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
      expect(html).not.toContain('javascript:');
      expect(html).not.toContain('url(x)');
      expect(html).toContain('Agendá una reunión');
      expect(html).toContain('https://linkedin.com/in/ana');
      expect(html).toMatch(/^<table/);
    }
  });

  it('calculadora SaaS: usa los precios del catálogo y suma por asientos', () => {
    const hubspot = SAAS_TOOLS.find((t) => t.id === 'hubspot');
    expect(hubspot).toMatchObject({ monthly: 50, perUser: true, replacedBy: 'CRM' });
    expect(SAAS_TOOLS.map((t) => t.id)).toEqual(['hubspot', 'intercom', 'calendly', 'notion', 'linear', 'bitly', 'zapier', 'miro', 'evernote']);
    // HubSpot 50×12×10 + Bitly plano 35×12
    expect(totalYearly([{ id: 'hubspot', seats: 10 }, { id: 'bitly', seats: 10 }])).toBe(6420);
  });
});

// ---------- Slugs reservados y mensajes ----------

describe('slugs reservados', () => {
  it('middleware.ts y lib/reserved.ts tienen la misma lista (e incluye tools)', () => {
    const src = readFileSync(path.join(ROOT, 'middleware.ts'), 'utf8');
    const block = src.match(/const RESERVED = new Set\(\[([\s\S]*?)\]\)/);
    expect(block).not.toBeNull();
    const fromMiddleware = new Set([...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
    expect([...fromMiddleware].sort()).toEqual([...RESERVED_SLUGS].sort());
    expect(RESERVED_SLUGS.has('tools')).toBe(true);
  });
});

describe('mensajes de tools', () => {
  type Tree = { [k: string]: Tree | string | Tree[] };
  const keys = (o: Tree | Tree[] | string, prefix = ''): string[] =>
    typeof o === 'string'
      ? [prefix]
      : Array.isArray(o)
        ? o.flatMap((v, i) => keys(v, `${prefix}[${i}]`))
        : Object.entries(o).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
  const load = (l: string) => JSON.parse(readFileSync(path.join(ROOT, `messages/${l}/tools.json`), 'utf8')) as Tree;

  it('en/es/pt tienen las mismas claves y cada herramienta tiene textos', () => {
    const en = load('en');
    const enKeys = keys(en).sort();
    for (const l of ['es', 'pt']) expect(keys(load(l)).sort()).toEqual(enKeys);
    for (const tool of TOOLS) {
      const item = (en.items as Tree)[tool.slug] as Tree;
      expect(item, tool.slug).toBeDefined();
      for (const k of ['name', 'short', 'metaTitle', 'metaDescription', 'title', 'sub', 'ctaTitle', 'ctaBody']) {
        expect(typeof item[k], `${tool.slug}.${k}`).toBe('string');
      }
      expect((item.faq as Tree[]).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('sin "<" (next-intl lo parsea como rich text)', () => {
    for (const l of ['en', 'es', 'pt']) {
      expect(readFileSync(path.join(ROOT, `messages/${l}/tools.json`), 'utf8')).not.toContain('<');
    }
  });
});
