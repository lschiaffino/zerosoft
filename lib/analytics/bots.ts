/**
 * Bots conocidos por su user agent. Un crawler que ejecuta el snippet inflaría
 * visitantes y páginas vistas: la ingesta del navegador no guarda sus eventos.
 * Un servidor con la key secreta no pasa por acá.
 */
const BOT_MARKERS = [
  'adsbot-google', 'ahrefsbot', 'ahrefssiteaudit', 'amazonbot', 'amazonproductbot', 'apis-google', 'app.hypefactors.com', 'applebot', 'archive.org_bot',
  'awariobot', 'backlinksextendedbot', 'baiduspider', 'better uptime bot', 'bingbot', 'bingpreview', 'bot.htm', 'bot.php', 'bytespider', 'chatgpt-user',
  'chrome-lighthouse', 'claudebot', 'crawler', 'cypress', 'dataforseobot', 'deepscan', 'duckduckbot', 'duplexweb-google', 'facebookcatalog', 'facebookexternal',
  'feedfetcher-google', 'google favicon', 'google web preview', 'google-cloudvertexbot', 'google-hoteladsverifier', 'google-inspectiontool', 'google-read-aloud',
  'googlebot', 'googleother', 'googleweblight', 'gptbot', 'hubspot', 'ia_archiver', 'leikibot', 'linkedinbot', 'mediapartners-google', 'meta-externalagent',
  'mj12bot', 'msnbot', 'nessus', 'oai-searchbot', 'perplexitybot', 'petalbot', 'pinterest', 'prerender', 'rogerbot', 'screaming frog', 'sebot-wa',
  'semrushbot', 'sentryuptimebot', 'siteauditbot', 'sitebulb', 'slackbot', 'slurp', 'splitsignalbot', 'storebot-google', 'trendictionbot', 'turnitin',
  'twitterbot', 'uptimerobot', 'vercel-screenshot', 'vercelbot', 'yandexbot', 'zoombot', '(bot;', 'bot/', 'spider/',
];

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  const s = ua.toLowerCase();
  // Los navegadores sin cabeza se tratan como bots; las pruebas de la propia app los usan a propósito.
  if (s.includes('headlesschrome') && process.env.ANALYTICS_ALLOW_HEADLESS !== '1') return true;
  return BOT_MARKERS.some((m) => s.includes(m));
}
