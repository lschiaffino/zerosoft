import { getAllPosts, getPost, type PostMeta } from '@/lib/blog';
import { absoluteUrl, localePath } from '@/lib/seo';

/**
 * Feeds del blog por idioma: /<locale>/blog/rss.xml (RSS 2.0) y
 * /<locale>/blog/atom.xml (Atom 1.0), con el HTML completo de cada post.
 */

export const FEED_LIMIT = 30;

const TITLES: Record<string, string> = { en: 'zerosoft blog', es: 'Blog de zerosoft', pt: 'Blog da zerosoft' };

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** El HTML del post con los links relativos hechos absolutos (los lectores de feeds no conocen el sitio). */
function absoluteHtml(html: string): string {
  return html.replace(/(href|src)="\/(?!\/)/g, (_m, attr: string) => `${attr}="${absoluteUrl('/')}`);
}

function items(locale: string): { meta: PostMeta; url: string; html: string }[] {
  return getAllPosts(locale)
    .slice(0, FEED_LIMIT)
    .map((meta) => ({
      meta,
      url: absoluteUrl(localePath(locale, `/blog/${meta.slug}`)),
      html: absoluteHtml(getPost(locale, meta.slug)?.html ?? ''),
    }));
}

const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

export function rssFeed(locale: string, description: string): string {
  const list = items(locale);
  const self = absoluteUrl(`/${locale}/blog/rss.xml`);
  const last = list[0]?.meta.updated;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">\n<channel>\n' +
    `<title>${xmlEscape(TITLES[locale] ?? TITLES.en)}</title>\n` +
    `<link>${absoluteUrl(localePath(locale, '/blog'))}</link>\n` +
    `<description>${xmlEscape(description)}</description>\n` +
    `<language>${locale}</language>\n` +
    `<atom:link href="${self}" rel="self" type="application/rss+xml"/>\n` +
    (last ? `<lastBuildDate>${new Date(`${last}T00:00:00Z`).toUTCString()}</lastBuildDate>\n` : '') +
    list
      .map(
        ({ meta, url, html }) =>
          '<item>\n' +
          `<title>${xmlEscape(meta.title)}</title>\n` +
          `<link>${url}</link>\n` +
          `<guid isPermaLink="true">${url}</guid>\n` +
          `<pubDate>${new Date(`${meta.date}T00:00:00Z`).toUTCString()}</pubDate>\n` +
          `<description>${xmlEscape(meta.description)}</description>\n` +
          meta.tags.map((t) => `<category>${xmlEscape(t)}</category>\n`).join('') +
          `<content:encoded>${cdata(html)}</content:encoded>\n` +
          '</item>\n',
      )
      .join('') +
    '</channel>\n</rss>\n'
  );
}

export function atomFeed(locale: string, subtitle: string): string {
  const list = items(locale);
  const self = absoluteUrl(`/${locale}/blog/atom.xml`);
  const updated = list.reduce((max, i) => (i.meta.updated > max ? i.meta.updated : max), '1970-01-01');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${locale}">\n` +
    `<title>${xmlEscape(TITLES[locale] ?? TITLES.en)}</title>\n` +
    `<subtitle>${xmlEscape(subtitle)}</subtitle>\n` +
    `<id>${absoluteUrl(localePath(locale, '/blog'))}</id>\n` +
    `<link href="${absoluteUrl(localePath(locale, '/blog'))}"/>\n` +
    `<link rel="self" href="${self}"/>\n` +
    `<updated>${updated}T00:00:00Z</updated>\n` +
    '<author><name>zerosoft</name></author>\n' +
    list
      .map(
        ({ meta, url, html }) =>
          '<entry>\n' +
          `<title>${xmlEscape(meta.title)}</title>\n` +
          `<link href="${url}"/>\n` +
          `<id>${url}</id>\n` +
          `<published>${meta.date}T00:00:00Z</published>\n` +
          `<updated>${meta.updated}T00:00:00Z</updated>\n` +
          `<summary>${xmlEscape(meta.description)}</summary>\n` +
          meta.tags.map((t) => `<category term="${xmlEscape(t)}"/>\n`).join('') +
          `<content type="html">${xmlEscape(html)}</content>\n` +
          '</entry>\n',
      )
      .join('') +
    '</feed>\n'
  );
}
