import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/chat/widget.js/route';
import { createChatWidget, getChatWidget, updateChatWidget } from '@/lib/chat-data';
import { pickWidgetLocale, WIDGET_STRINGS } from '@/lib/chat-widget-i18n';
import { makeUser } from './helpers';

describe('Chat widget: idioma', () => {
  it('elige override, idioma fijo, <html lang>, navegador y si no inglés', () => {
    expect(pickWidgetLocale('pt-BR', 'es', 'en', ['en'])).toBe('pt');
    expect(pickWidgetLocale(null, 'es', 'en', ['en'])).toBe('es');
    expect(pickWidgetLocale(null, 'auto', 'es-AR', ['en-US'])).toBe('es');
    expect(pickWidgetLocale(null, 'auto', '', ['fr-FR', 'pt_BR'])).toBe('pt');
    expect(pickWidgetLocale('xx', 'auto', 'de', 'fr')).toBe('en');
  });

  it('tiene los mismos textos en en/es/pt', () => {
    const keys = Object.keys(WIDGET_STRINGS.en).sort();
    expect(Object.keys(WIDGET_STRINGS.es).sort()).toEqual(keys);
    expect(Object.keys(WIDGET_STRINGS.pt).sort()).toEqual(keys);
    expect(WIDGET_STRINGS.es.placeholder).not.toBe(WIDGET_STRINGS.en.placeholder);
    for (const loc of ['en', 'es', 'pt'] as const) {
      for (const v of Object.values(WIDGET_STRINGS[loc])) expect(v).not.toContain('—');
    }
  });

  it('el script lleva los textos de los tres idiomas, el idioma del widget y compila', async () => {
    const owner = await makeUser('widgeti18n');
    const widget = await createChatWidget(owner.id, null, { name: 'W' });
    expect((await getChatWidget(widget.id))?.locale).toBe('auto');
    await updateChatWidget(widget.id, { locale: 'es' });
    const res = await GET(new Request(`http://localhost/api/chat/widget.js?id=${widget.id}`));
    const js = await res.text();
    expect(() => new Function(js)).not.toThrow();
    expect(js).toContain(JSON.stringify(WIDGET_STRINGS.es.placeholder));
    expect(js).toContain(JSON.stringify(WIDGET_STRINGS.pt.csatQuestion));
    expect(js).toContain('"es", htmlLang');
    // Sin textos fijos en inglés fuera del diccionario.
    const code = js.replace(/var STRINGS = .*;\n/, '');
    expect(code).not.toContain('Type a message');
    expect(code).not.toContain("We're away right now");
    expect(code).not.toContain('Hi there. How can we help?');
  });
});
