import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { LinkWithDomain } from './links';
import { shortUrl } from './utils';
import linkEn from '@/messages/en/link.json';
import linkEs from '@/messages/es/link.json';
import linkPt from '@/messages/pt/link.json';

/** Texto del botón de la tarjeta: es HTML crudo (sin next-intl), sale directo de messages/. */
const CONTINUE: Record<string, string> = {
  en: linkEn.preview.continue,
  es: linkEs.preview.continue,
  pt: linkPt.preview.continue,
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** El link tiene una tarjeta social propia (og:title/description/image). */
export function hasCustomPreview(link: Pick<LinkWithDomain, 'og_title' | 'og_description' | 'og_image'>): boolean {
  return Boolean(link.og_title?.trim() || link.og_description?.trim() || link.og_image?.trim());
}

/**
 * Tarjeta OG de un link para crawlers y unfurlers (Slack, WhatsApp, iMessage).
 * No redirige sola: es para bots, que no cuentan como visita; un humano que
 * llegue acá tiene el enlace "Continue".
 */
export function linkPreviewHtml(link: LinkWithDomain, slug: string, locale: string): string {
  const title = link.og_title?.trim() || link.title?.trim() || `${slug} — zerosoft.ai`;
  const description = link.og_description?.trim() || link.url;
  const image = link.og_image?.trim() || '';

  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${escapeHtml(link.url)}">
    <meta property="og:type" content="website">
    ${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
    <meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    ${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ''}
    <style>
      html,body{height:100%;margin:0;background:#fff;color:#0d0d0d;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
      main{min-height:100%;display:flex;align-items:center;justify-content:center;padding:32px;text-align:center}
      .card{max-width:420px;border:1px solid #e6e6e6;border-radius:16px;padding:36px 32px}
      h1{font-size:1.25rem;font-weight:500;margin:0 0 10px;letter-spacing:-0.01em}
      p{margin:0 0 18px;color:#555;font-size:0.95rem;word-break:break-all}
      a{color:#0d0d0d;text-decoration:underline;text-underline-offset:3px;font-size:0.9rem}
      .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:0.8rem;color:#888;margin-top:18px}
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(description)}</p>
        <a href="${escapeHtml(link.url)}">${escapeHtml(CONTINUE[locale] ?? CONTINUE.en)}</a>
        <div class="mono">${escapeHtml(shortUrl(slug, link.domain_hostname ?? null).replace(/^https?:\/\//, ''))}</div>
      </div>
    </main>
  </body>
</html>`;
}

/**
 * Metadatos de la puerta de contraseña. Se ve sin contraseña (y es lo que
 * leen los unfurlers de Slack o WhatsApp en un link protegido): nada que
 * dependa del link (destino, título, og_*) puede salir acá.
 */
export async function gateMetadata(locale: string): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'link' });
  return {
    title: t('gate.title'),
    robots: { index: false, follow: false },
  };
}
