import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

// El host de nuestro Blob no es secreto (está en cada URL pública) y el Markdown lo necesita en el navegador.
const blobStore = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(process.env.BLOB_READ_WRITE_TOKEN ?? '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_OWN_BLOB_HOST: blobStore ? `${blobStore[1].toLowerCase()}.public.blob.vercel-storage.com` : '' },
  // El <title> va siempre en el <head>: con metadata en streaming cae en el <body> y compite
  // con la hidratación (error #418 intermitente en rutas con loading.tsx).
  htmlLimitedBots: /.*/,
  reactStrictMode: true,
  // geoip-lite reads its .dat data files from paths relative to its own
  // __dirname at require time, which breaks when webpack bundles it.
  // Keep it external so it is required from node_modules at runtime.
  // playwright-core (runner local de Robots) se carga de node_modules en runtime.
  serverExternalPackages: ['geoip-lite', 'playwright-core', '@napi-rs/canvas'],
  // La descarga de la extensión de Chrome arma el zip leyendo extensions/chrome en runtime.
  outputFileTracingIncludes: {
    // Send: pdf.js (worker y fuentes estándar) y el lienzo nativo se cargan en runtime.
    '/api/send/**': ['./node_modules/pdfjs-dist/package.json', './node_modules/pdfjs-dist/legacy/build/**/*', './node_modules/pdfjs-dist/standard_fonts/**/*', './node_modules/pdfjs-dist/cmaps/**/*', './node_modules/pdfjs-dist/wasm/**/*', './node_modules/@napi-rs/canvas*/**/*'],
    '/api/cron/minute': ['./node_modules/pdfjs-dist/package.json', './node_modules/pdfjs-dist/legacy/build/**/*', './node_modules/pdfjs-dist/standard_fonts/**/*', './node_modules/pdfjs-dist/cmaps/**/*', './node_modules/pdfjs-dist/wasm/**/*', './node_modules/@napi-rs/canvas*/**/*'],
    '/api/crm/extension/download': ['./extensions/chrome/**/*'],
    // Imágenes OG (lib/og-card.tsx): las fuentes de la marca y los posts del blog, leídos en runtime.
    '/api/og/[...card]': ['./lib/og-fonts/*.ttf', './content/blog/**/*.md'],
  },
  // El widget de Chat corre embebido en sitios de terceros y llama a estos
  // endpoints públicos (sin cookies). Next responde el preflight OPTIONS solo;
  // estos headers lo habilitan cross-origin.
  // Slugs de blog renombrados: el viejo redirige para siempre al nuevo.
  async redirects() {
    const renamed = [['open-source-no-es-gratis-es-libre', 'gratis-vs-libre']];
    return [
      // Los lectores de feeds prueban estas rutas en la raíz: el feed real vive en /en/blog.
      // Solo rutas con punto: una sin punto (como /feed) puede ser el slug de un link corto en cualquier dominio.
      ...['/rss.xml', '/feed.xml'].map((source) => ({ source, destination: '/en/blog/rss.xml', permanent: true })),
      { source: '/atom.xml', destination: '/en/blog/atom.xml', permanent: true },
      ...renamed.flatMap(([from, to]) => [
        { source: `/:locale(en|es|pt)/blog/${from}`, destination: `/:locale/blog/${to}`, permanent: true },
        { source: `/blog/${from}`, destination: `/blog/${to}`, permanent: true },
      ]),
    ];
  },
  // Subidas locales (sin Blob): /uploads/* siempre pasa por la ruta que
  // chequea carpeta y pone headers seguros. beforeFiles corre antes de mirar
  // public/, así que un archivo viejo en public/uploads nunca sale estático.
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/uploads/:path*', destination: '/api/uploads/:path*' },
        // sitemap.xml de cada tienda de Shop (lib/shop-storefront.ts).
        { source: '/store/:handle/sitemap.xml', destination: '/api/shop/public/:handle/sitemap' },
        // sitemap.xml de cada página de empleos de Hiring (lib/hiring/careers.ts).
        { source: '/careers/:handle/sitemap.xml', destination: '/api/hiring/public/:handle/sitemap' },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    const cors = [
      { key: 'Access-Control-Allow-Origin', value: '*' },
      { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
      { key: 'Access-Control-Allow-Headers', value: 'content-type' },
      { key: 'Access-Control-Max-Age', value: '86400' },
    ];
    return [
      // Pantallas de permisos de OAuth: nunca dentro de un iframe (clickjacking).
      {
        source: '/:locale(en|es|pt)/oauth/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      // Visor de Send: un documento confidencial, sin iframes ajenos, sin referer y sin recursos de otros orígenes salvo el logo.
      {
        source: '/:locale(en|es|pt)/send/:token',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          {
            key: 'Content-Security-Policy',
            value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"}; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self'; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
          },
        ],
      },
      {
        source: '/api/chat/:route(identify|messages|csat|read|typing|help|history|outbound|visitor)',
        headers: cors,
      },
      { source: '/api/chat/messages/upload', headers: cors },
      // Reproductor de grabaciones: lo grabado puede apuntar a cualquier URL, y el visor no la pide.
      {
        source: '/:locale(en|es|pt)/app/analytics/replay/:id',
        headers: [{ key: 'Content-Security-Policy', value: "img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-src 'self' about:" }],
      },
      // Snippet de Analytics: se importa como módulo desde sitios de terceros.
      { source: '/:file(zs\\.js|zs\\.mjs)', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }, { key: 'Cache-Control', value: 'public, max-age=3600' }] },
    ];
  },
};

export default withNextIntl(nextConfig);
