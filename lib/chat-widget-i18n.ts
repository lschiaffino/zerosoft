/**
 * Chat: textos del widget embebido (app/api/chat/widget.js) en en/es/pt.
 * Salen de messages/<locale>/chat.json (chat.visitorWidget) y viajan dentro
 * del script; el idioma se elige en el navegador del visitante.
 */
import en from '@/messages/en/chat.json';
import es from '@/messages/es/chat.json';
import pt from '@/messages/pt/chat.json';

import extra from './chat-widget-i18n-extra.json';

export const WIDGET_LOCALES = ['en', 'es', 'pt', 'fr', 'de', 'it', 'nl', 'pl', 'sv', 'ru', 'tr', 'ja', 'ko', 'zh', 'id'] as const;
export type WidgetLocale = (typeof WIDGET_LOCALES)[number];
export type WidgetLocaleSetting = 'auto' | WidgetLocale;

export type WidgetStrings = typeof en.visitorWidget;

export const WIDGET_STRINGS: Record<WidgetLocale, WidgetStrings> = {
  en: en.visitorWidget,
  es: { ...en.visitorWidget, ...es.visitorWidget },
  pt: { ...en.visitorWidget, ...pt.visitorWidget },
  fr: { ...en.visitorWidget, ...extra.fr },
  de: { ...en.visitorWidget, ...extra.de },
  it: { ...en.visitorWidget, ...extra.it },
  nl: { ...en.visitorWidget, ...extra.nl },
  pl: { ...en.visitorWidget, ...extra.pl },
  sv: { ...en.visitorWidget, ...extra.sv },
  ru: { ...en.visitorWidget, ...extra.ru },
  tr: { ...en.visitorWidget, ...extra.tr },
  ja: { ...en.visitorWidget, ...extra.ja },
  ko: { ...en.visitorWidget, ...extra.ko },
  zh: { ...en.visitorWidget, ...extra.zh },
  id: { ...en.visitorWidget, ...extra.id },
};

/**
 * Idioma del widget. Orden: override explícito del sitio (data-locale o
 * zsChatSettings.locale), idioma fijo del widget, <html lang> de la página,
 * idiomas del navegador; si nada coincide, inglés.
 *
 * Se inyecta en el script con toString(): ES5 puro, sin dependencias.
 */
export function pickWidgetLocale(override: unknown, setting: unknown, htmlLang: unknown, browser: unknown): string {
  var supported = ['en', 'es', 'pt', 'fr', 'de', 'it', 'nl', 'pl', 'sv', 'ru', 'tr', 'ja', 'ko', 'zh', 'id'];
  function norm(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    var base = v.trim().toLowerCase().split(/[-_]/)[0];
    return supported.indexOf(base) >= 0 ? base : null;
  }
  var fixed = norm(override) || (setting !== 'auto' ? norm(setting) : null);
  if (fixed) return fixed;
  var page = norm(htmlLang);
  if (page) return page;
  var list = Array.isArray(browser) ? browser : [browser];
  for (var i = 0; i < list.length; i++) {
    var b = norm(list[i]);
    if (b) return b;
  }
  return 'en';
}
