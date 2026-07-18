import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // geoip-lite reads its .dat data files from paths relative to its own
    // __dirname at require time, which breaks when webpack bundles it.
    // Keep it external so it is required from node_modules at runtime.
    serverComponentsExternalPackages: ['geoip-lite'],
  },
};

export default withNextIntl(nextConfig);
