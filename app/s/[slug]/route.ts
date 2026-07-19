import { NextRequest, NextResponse } from 'next/server';
import {
  gateCookieName,
  getLinkBySlug,
  isExpired,
  isValidGateToken,
} from '@/lib/links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOCALES = new Set(['en', 'es', 'pt']);

function localeFrom(req: NextRequest): string {
  const cookie = req.cookies.get('NEXT_LOCALE')?.value;
  return cookie && LOCALES.has(cookie) ? cookie : 'en';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const { slug } = params;
  const locale = localeFrom(req);
  const gone = (reason: string) =>
    NextResponse.redirect(new URL(`/${locale}/gone?reason=${reason}`, req.url));

  const link = await getLinkBySlug(slug);
  if (!link || link.archived === 1) return gone('notfound');
  if (isExpired(link)) return gone('expired');
  if (link.max_clicks !== null && link.clicks >= link.max_clicks) return gone('limit');

  if (link.password_hash) {
    const token = req.cookies.get(gateCookieName(slug))?.value;
    if (!isValidGateToken(slug, link.password_hash, token)) {
      return NextResponse.redirect(new URL(`/${locale}/gate/${slug}`, req.url));
    }
  }

  const title = link.og_title?.trim() || link.title?.trim() || `${slug} — zerosoft.ai`;
  const description = link.og_description?.trim() || link.url;
  const image = link.og_image?.trim() || '';

  const html = `<!doctype html>
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
    <meta http-equiv="refresh" content="0;url=${escapeHtml(link.url)}">
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
        <a href="${escapeHtml(link.url)}">Continue →</a>
        <div class="mono">zerosoft.ai/${escapeHtml(slug)}</div>
      </div>
    </main>
    <script>window.location.replace(${JSON.stringify(link.url)});</script>
  </body>
</html>`;

  return new NextResponse(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
