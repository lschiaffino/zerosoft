import { getRequestConfig } from 'next-intl/server';
import type { AbstractIntlMessages } from 'next-intl';
import { routing } from './routing';

// Namespaces cargados por idioma. Cada feature puede agregar el suyo
// (messages/<locale>/<namespace>.json); si no existe, se omite sin romper.
const NAMESPACES = ['common', 'link', 'crm', 'docs', 'calendar', 'track', 'trackPlanning', 'chat', 'flow', 'agents', 'robots', 'groups', 'voice', 'rec', 'talk', 'shop', 'design', 'analytics', 'social', 'people', 'hiring', 'books', 'forms', 'notes', 'board', 'pages', 'legal', 'feedback', 'changelog', 'videos', 'roadmap', 'tools', 'feedbackBoard', 'brand', 'settings', 'trackTriage', 'assistant'];

async function loadNamespace(locale: string, ns: string) {
  try {
    const mod = await import(`../messages/${locale}/${ns}.json`);
    return mod.default;
  } catch {
    return {};
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const current = routing.locales.includes(requested as never)
    ? (requested as string)
    : routing.defaultLocale;

  const messages: Record<string, AbstractIntlMessages> = {};
  for (const ns of NAMESPACES) {
    messages[ns] = await loadNamespace(current, ns);
  }

  return { locale: current, messages };
});
