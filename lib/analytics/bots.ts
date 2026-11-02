/**
 * Bots conocidos por su user agent. Un crawler que ejecuta el snippet inflaría
 * visitantes y páginas vistas: la ingesta del navegador no guarda sus eventos.
 * Un servidor con la key secreta no pasa por acá.
 */
const BOT_TOKENS = [
  'anthropic-ai', 'google-extended', 'coccocbot', 'duckassistbot', 'imagesiftbot', 'facebookbot', 'ccbot', 'dotbot', 'discordbot', 'seznambot', 'mail.ru_bot', 'mail.ru/', '360spider', 'yisouspider',
  'adsbot-google', 'ahrefsbot', 'ahrefssiteaudit', 'amazonbot', 'amazonproductbot', 'apis-google', 'app.hypefactors.com', 'applebot', 'archive.org_bot',
  'awariobot', 'backlinksextendedbot', 'baiduspider', 'better uptime bot', 'bingbot', 'bingpreview', 'bytespider', 'chatgpt-user', 'chrome-lighthouse',
  'claudebot', 'cypress', 'dataforseobot', 'deepscan', 'duckduckbot', 'duplexweb-google', 'facebookcatalog', 'facebookexternalhit', 'feedfetcher-google',
  'google favicon', 'google web preview', 'google-cloudvertexbot', 'google-hoteladsverifier', 'google-inspectiontool', 'googlebot', 'googleother',
  'googleweblight', 'gptbot', 'hubspot crawler', 'hubspot connect', 'hubspot links crawler', 'ia_archiver', 'leikibot', 'linkedinbot', 'mediapartners-google',
  'meta-externalagent', 'mj12bot', 'msnbot', 'nessus', 'oai-searchbot', 'perplexitybot', 'petalbot', 'pinterestbot', 'prerender', 'rogerbot', 'screaming frog',
  'sebot-wa', 'semrushbot', 'sentryuptimebot', 'siteauditbot', 'sitebulb', 'slackbot', 'yahoo! slurp', 'splitsignalbot', 'storebot-google', 'trendictionbot',
  'turnitin', 'twitterbot', 'uptimerobot', 'vercel-screenshot', 'vercelbot', 'yandexbot', 'zoombot',
];
/** La palabra sola como producto ("bot/1.0", "(bot;") o un crawler genérico. No toca teléfonos como "CUBOT/" ni apps. */
const GENERIC = /(^|[\s(;,])(bot|spider|crawler)([\/;,)\s]|$)|[a-z0-9_-]crawler\b|[a-z0-9_-]+spider\/|(?<!cu)bot\/|(?<!cu)bot[;),]|pinterest\/0\.\d|bot\.(html?|php)/i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  const s = ua.toLowerCase();
  // Los navegadores sin cabeza se tratan como bots; las pruebas de la propia app los usan a propósito.
  if (s.includes('headlesschrome') && process.env.ANALYTICS_ALLOW_HEADLESS !== '1') return true;
  return BOT_TOKENS.some((m) => s.includes(m)) || GENERIC.test(s);
}
