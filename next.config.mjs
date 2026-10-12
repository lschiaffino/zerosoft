import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // geoip-lite reads its .dat data files from paths relative to its own
  // __dirname at require time, which breaks when webpack bundles it.
  // Keep it external so it is required from node_modules at runtime.
  serverExternalPackages: ['geoip-lite'],
  // El widget de Chat corre embebido en sitios de terceros y llama a estos
  // endpoints públicos (sin cookies). Next responde el preflight OPTIONS solo;
  // estos headers lo habilitan cross-origin.
  async headers() {
    const cors = [
      { key: 'Access-Control-Allow-Origin', value: '*' },
      { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
      { key: 'Access-Control-Allow-Headers', value: 'content-type' },
      { key: 'Access-Control-Max-Age', value: '86400' },
    ];
    return [
      {
        source: '/api/chat/:route(identify|messages|csat|read|typing)',
        headers: cors,
      },
      { source: '/api/chat/messages/upload', headers: cors },
    ];
  },
};

export default withNextIntl(nextConfig);
