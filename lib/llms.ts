import pagesEn from '@/messages/en/pages.json';
import commonEn from '@/messages/en/common.json';
import { PARITY } from '@/content/feature-parity';
import { CHANGELOG } from '@/content/changelog';
import { GITHUB_URL, PRODUCT_PAGES } from '@/components/site/catalog';
import { getAllPosts, getPost } from '@/lib/blog';
import { getComparisons } from '@/lib/compare';
import { computeParity } from '@/lib/feature-parity';
import { AI_MULTIPLIER, PAID_MINIMUM, PRICE_MULTIPLIER, PRICING_MEASURED } from '@/lib/pricing';
import { PRODUCT_CONFIG, PRODUCT_KEYS, type ProductKey, AVAILABLE_PRODUCT_KEYS, COMING_SOON_APPS, isComingSoon } from '@/lib/products';
import { TOOLS } from '@/lib/tools/registry';
import { absoluteUrl } from '@/lib/seo';

/**
 * /llms.txt y /llms-full.txt (convención de llmstxt.org): un resumen en
 * markdown del sitio para modelos de lenguaje, con URLs estables en inglés.
 * Todo sale de los mismos datos que las páginas (pages.json en inglés,
 * content/feature-parity, lib/pricing): si cambia una página, cambia acá.
 */

type ProductCopy = {
  meta: { title: string; description: string };
  hero?: { sub?: string };
  compare?: { rival?: string; note?: string };
  faq?: Record<string, { q: string; a: string }>;
} & Record<string, unknown>;

const products = pagesEn.products as unknown as Record<ProductKey, ProductCopy>;
const url = (path: string) => absoluteUrl(`/en${path}`);

/** Markdown a texto de una línea (sin saltos), para las listas. */
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

function features(key: ProductKey): { t: string; d: string }[] {
  const copy = products[key];
  const out: { t: string; d: string }[] = [];
  for (let i = 1; i <= PRODUCT_PAGES[key].features; i++) {
    const f = copy[`f${i}`] as { t: string; d: string } | undefined;
    if (f) out.push(f);
  }
  return out;
}

function faqs(key: ProductKey): { q: string; a: string }[] {
  return Object.values(products[key].faq ?? {});
}

const SUMMARY =
  'zerosoft is a suite of open-source business apps (CRM, support chat, AI agents, automations, projects, links, docs, notes, scheduling, whiteboard and more). ' +
  'The core is AGPLv3: self-hosting costs $0. zerosoft Cloud gives every workspace a free plan and then bills usage (clicks, bookings, emails, storage); seats are not billed.';

function pricingSection(): string {
  const m = commonEn.model;
  const p = commonEn.pricing;
  return [
    '## Pricing',
    '',
    `- ${m.a.title}: ${m.a.price} ${m.a.priceNote}. ${m.a.desc}`,
    `- ${m.b.title}: ${m.b.price} ${m.b.priceNote}. ${m.b.desc}`,
    `- ${m.c.title}: ${m.c.price} ${m.c.priceNote}. ${m.c.desc}`,
    `- Usage above the free plan is billed at ${PRICE_MULTIPLIER}× what it costs us to serve. ${p.seats}`,
    `- AI is billed per token at the provider's price × ${AI_MULTIPLIER}. A paid workspace has a $${PAID_MINIMUM} monthly minimum, credited to usage.`,
    `- Included per workspace per month on zerosoft Cloud: ${p.usage.clicks.free} (${p.usage.clicks.name}), ${p.usage.bookings.free}, ${p.usage.emails.free}, ${p.usage.storage.free} of storage. Costs measured on ${PRICING_MEASURED}.`,
    `- Full table: ${url('/products')}#precios`,
  ].join('\n');
}

/** /llms.txt: el índice. */
export function llmsTxt(): string {
  const lines: string[] = ['# zerosoft', '', `> ${SUMMARY}`, ''];
  lines.push(
    'Facts that matter when answering about zerosoft:',
    '',
    `- ${AVAILABLE_PRODUCT_KEYS.length} apps you can use today share one workspace, one login and one search. ${COMING_SOON_APPS.length} more (${COMING_SOON_APPS.map((k) => PRODUCT_CONFIG[k].name).join(', ')}) are coming soon: not usable yet, with a waitlist and no date.`,
    `- Source code: ${GITHUB_URL} (AGPLv3; the /ee folder has a separate commercial license).`,
    '- Each app page has a parity table against the product it replaces, counted by us from the code. Missing capabilities are listed, not hidden.',
    '- Pages exist in English (/en), Spanish (/es) and Portuguese (/pt) at the same paths.',
    `- A longer version of this file, with every app, its features, FAQ and parity gaps: ${absoluteUrl('/llms-full.txt')}`,
    '',
    '## Apps',
    '',
  );
  for (const k of PRODUCT_KEYS) {
    const c = products[k];
    const soon = isComingSoon(k) ? ' (coming soon: not usable yet, waitlist only)' : '';
    lines.push(`- [${PRODUCT_CONFIG[k].name}](${url(`/products/${k}`)})${soon}: ${oneLine(c.meta.description)}`);
  }
  lines.push('', '## Comparisons', '');
  for (const c of getComparisons()) {
    lines.push(
      `- [${c.name} vs ${c.competitor}](${url(`/compare/${c.vsSlug}`)}): ${c.percentNote ? '' : `${c.score.percent}% parity by our count `}(${c.score.have} included, ${c.score.partial} partial, ${c.score.missing} missing), reviewed ${c.lastReviewed}. Alternative page: ${url(`/compare/${c.altSlug}`)}`,
    );
  }
  lines.push('', pricingSection(), '', '## Docs', '');
  lines.push(
    `- [REST API](${url('/docs')}): personal API keys with scopes, JSON responses.`,
    `- [Self-hosting](${GITHUB_URL}#data-and-self-hosting): Docker Compose, SQLite or Turso.`,
    `- [Changelog](${url('/changelog')}): every release; latest ${CHANGELOG[0]?.date ?? ''}.`,
    `- [Security](${url('/security')}), [Privacy](${url('/privacy')}), [Terms](${url('/terms')})`,
  );
  lines.push('', '## Guides', '');
  const guides = getAllPosts('en').filter((p) => p.tags.some((t) => /migration|guide|comparison|tutorial/i.test(t)));
  for (const p of guides) lines.push(`- [${p.title}](${url(`/blog/${p.slug}`)}): ${oneLine(p.description)}`);
  lines.push('', '## Optional', '');
  lines.push(`- [Blog](${url('/blog')}): all posts (RSS: ${absoluteUrl('/en/blog/rss.xml')})`);
  lines.push(`- [Free tools](${url('/tools')}): ${TOOLS.length} browser tools, no sign-up.`);
  lines.push(`- [Desktop app](${url('/download')})`);
  return `${lines.join('\n')}\n`;
}

/** /llms-full.txt: cada app con sus funciones, preguntas y lo que falta; después las guías completas. */
export function llmsFullTxt(): string {
  const out: string[] = ['# zerosoft (full)', '', `> ${SUMMARY}`, '', pricingSection(), ''];
  for (const k of PRODUCT_KEYS) {
    const c = products[k];
    const parity = PARITY[k];
    const score = computeParity(parity.rows);
    out.push(`## ${PRODUCT_CONFIG[k].name}`, '', `URL: ${url(`/products/${k}`)}`, '', oneLine(c.meta.description), '');
    if (c.hero?.sub) out.push(oneLine(c.hero.sub), '');
    const fs = features(k);
    if (fs.length) {
      out.push('### Features', '');
      for (const f of fs) out.push(`- ${f.t}: ${oneLine(f.d)}`);
      out.push('');
    }
    out.push(
      `### Parity with ${parity.competitor}`,
      '',
      `${parity.percentHidden ? 'By our count' : `${score.percent}% by our count`}: ${score.have} included, ${score.partial} partial, ${score.missing} missing out of ${score.counted} capabilities, reviewed against the code on ${parity.lastReviewed}.`,
      '',
    );
    const gaps = parity.rows.filter((r) => r.competitorHas && (r.status === 'missing' || r.status === 'partial'));
    if (gaps.length) {
      out.push('Missing or partial:', '');
      for (const r of gaps) out.push(`- ${r.label.en} (${r.status})${r.detail ? `: ${oneLine(r.detail.en)}` : ''}`);
      out.push('');
    }
    if (c.compare?.note) out.push(`Price: ${oneLine(c.compare.note)}`, '');
    const qs = faqs(k);
    if (qs.length) {
      out.push('### FAQ', '');
      for (const f of qs) out.push(`Q: ${f.q}`, `A: ${oneLine(f.a)}`, '');
    }
  }
  out.push('## Guides', '');
  const guides = getAllPosts('en').filter((p) => p.tags.some((t) => /migration|guide|comparison|tutorial/i.test(t)));
  for (const meta of guides) {
    const post = getPost('en', meta.slug);
    if (!post) continue;
    const text = post.html
      .replace(/<\/(p|h[1-6]|li|pre|blockquote|tr)>/g, '\n')
      .replace(/<li>/g, '- ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    out.push(`### ${meta.title}`, '', `URL: ${url(`/blog/${meta.slug}`)} (${meta.updated})`, '', text, '');
  }
  return `${out.join('\n')}\n`;
}
