import { safeFetch } from './safe-fetch';
import { cleanExternalUrl, linkSite } from './docs-embeds';
import type { DocsLinkPreview } from './docs-types';

/**
 * Metadatos de un link para el bookmark de Docs (título, descripción, imagen,
 * favicon), leídos en el servidor con safeFetch (solo hosts públicos, timeout,
 * redirecciones validadas). Se lee hasta 512 KB del HTML.
 *
 * DOCS_UNFURL_FAKE=1 (tests) no sale a internet: arma un HTML fijo con el
 * dominio del link y pasa por el mismo parser.
 */

const MAX_BYTES = 512 * 1024;

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function clean(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined;
  // eslint-disable-next-line no-control-regex
  const out = decodeEntities(s).replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return out ? out.slice(0, max) : undefined;
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
}

function absolute(raw: string | undefined, base: string): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(decodeEntities(raw.trim()), base);
    return cleanExternalUrl(u.toString()) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Lee <title>, og:/twitter: y el ícono del HTML de una página. Puro. */
export function parseLinkMeta(html: string, url: string): DocsLinkPreview {
  const head = html.slice(0, MAX_BYTES);
  const metas = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase();
    const content = attr(tag, 'content');
    if (key && content !== undefined && !metas.has(key)) metas.set(key, content);
  }
  let icon: string | undefined;
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    if (/(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(rel)) {
      icon = attr(tag, 'href');
      if (rel.includes('apple-touch-icon')) break;
    }
  }
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = clean(metas.get('og:title') ?? metas.get('twitter:title') ?? titleTag, 300);
  const description = clean(metas.get('og:description') ?? metas.get('twitter:description') ?? metas.get('description'), 500);
  const image = absolute(metas.get('og:image') ?? metas.get('og:image:url') ?? metas.get('twitter:image'), url);
  const site = clean(metas.get('og:site_name'), 120) ?? linkSite(url);
  const favicon = absolute(icon ?? '/favicon.ico', url);
  const out: DocsLinkPreview = { url };
  if (title) out.title = title;
  if (description) out.description = description;
  if (image) out.image = image;
  if (site) out.site = site;
  if (favicon) out.favicon = favicon;
  return out;
}

function fakeHtml(url: string): string {
  const site = linkSite(url);
  return `<html><head><title>${site} page</title><meta property="og:description" content="Preview of ${site}"><meta property="og:image" content="https://${site}/cover.png"><link rel="icon" href="/favicon.png"></head><body></body></html>`;
}

/** Metadatos de un link (si el sitio no responde, solo la URL y el dominio). */
export async function unfurlLink(raw: string): Promise<DocsLinkPreview | null> {
  const url = cleanExternalUrl(raw);
  if (!url) return null;
  if (process.env.DOCS_UNFURL_FAKE === '1') return parseLinkMeta(fakeHtml(url), url);
  try {
    const res = await safeFetch(
      url,
      { headers: { 'User-Agent': 'zerosoft-docs-bot/1.0 (+link preview)', Accept: 'text/html,application/xhtml+xml' } },
      6000,
      { maxRedirects: 4 },
    );
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/html|xml/i.test(type) || !res.body) {
      await res.body?.cancel().catch(() => {});
      return { url, site: linkSite(url) };
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
    await reader.cancel().catch(() => {});
    const html = new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    return parseLinkMeta(html, url);
  } catch {
    return { url, site: linkSite(url) };
  }
}
