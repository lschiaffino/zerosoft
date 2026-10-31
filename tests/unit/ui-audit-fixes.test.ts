import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiErrorText, ApiError } from '@/components/analytics/client';
import { APP_SECTIONS, isAppSection, sectionTakesId } from '@/lib/app-sections';
import { notificationTitle, type NotificationTextLabels } from '@/lib/notification-text';
import { PRODUCT_CONFIG, PRODUCT_KEYS, productSettingsHref } from '@/lib/products';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const LOCALES = ['es', 'en', 'pt'] as const;

describe('Ajustes: cada producto listado tiene página', () => {
  it('las apps de una sola ruta manejan la sección settings', () => {
    for (const key of PRODUCT_KEYS) {
      const app = PRODUCT_CONFIG[key].launch.replace('/app/', '');
      const page = `app/[locale]/app/${app}/[[...zs]]/page.tsx`;
      if (!existsSync(join(root, page))) continue;
      expect(read(page), productSettingsHref(key)).toMatch(/'settings'/);
    }
  });
});

describe('Secciones de las apps de una sola ruta (404 real)', () => {
  it('toda sección que maneja la página está permitida por el layout', () => {
    for (const app of Object.keys(APP_SECTIONS) as Array<keyof typeof APP_SECTIONS>) {
      const page = read(`app/[locale]/app/${app}/[[...zs]]/page.tsx`);
      // Solo el switch de arriba: los case anidados (reportes de Books) no son secciones.
      const top = page.slice(page.indexOf('switch (section)'));
      const cases = [...top.matchAll(/^ {4}case '([a-z-]+)':/gm)].map((m) => m[1]);
      expect(cases.length).toBeGreaterThan(0);
      for (const section of cases) expect(isAppSection(app, section), `${app}/${section}`).toBe(true);
    }
  });

  it('una pantalla única no acepta id', () => {
    expect(sectionTakesId('sign', 'settings', 'x')).toBe(false);
    expect(sectionTakesId('sign', 'envelopes', 'x')).toBe(true);
    expect(sectionTakesId('sign', 'settings', undefined)).toBe(true);
  });

  it('sin sección es la home; una desconocida no pasa', () => {
    expect(isAppSection('books', undefined)).toBe(true);
    expect(isAppSection('books', 'zzz')).toBe(false);
    expect(isAppSection('people', 'emp_abc')).toBe(true);
    expect(isAppSection('people', 'zzz')).toBe(false);
    expect(isAppSection('sign', 'settings')).toBe(true);
  });
});

describe('Errores para la persona', () => {
  const t = (k: 'error' | 'errorInvalid') => k;

  it('Analytics nunca muestra el código crudo', () => {
    expect(apiErrorText(new ApiError('server_error', 500), t)).toBe('error');
    expect(apiErrorText(new ApiError('invalid_body', 400), t)).toBe('errorInvalid');
    expect(apiErrorText(new Error('x'), t)).toBe('error');
    for (const loc of LOCALES) expect(read(`messages/${loc}/analytics.json`)).not.toContain('{code}');
  });

  it('el español usa voseo en el mensaje genérico', () => {
    for (const file of ['chat', 'track']) {
      const text = read(`messages/es/${file}.json`);
      expect(text).not.toContain('Inténtalo de nuevo');
      expect(text).not.toContain('Algo salió mal. Intentá de nuevo');
    }
  });

  it('Voice distingue una respuesta de error de no llegar al servidor', () => {
    for (const f of ['VoiceSettingsMore', 'VoiceSettingsView', 'MeetingView', 'EnhancedNotes', 'DictationHost', 'useDictation']) {
      const file = existsSync(join(root, `components/voice/${f}.tsx`)) ? `components/voice/${f}.tsx` : `components/voice/${f}.ts`;
      expect(read(file), f).not.toContain("data?.error ?? 'network'");
    }
  });
});

describe('Textos que faltaban', () => {
  it('voice.settings.desktop.step2Link existe en los tres idiomas', () => {
    for (const loc of LOCALES) {
      const voice = JSON.parse(read(`messages/${loc}/voice.json`));
      expect(voice.settings.desktop.step2Link).toBeTruthy();
    }
  });

  it('las acciones del registro de Books tienen texto', () => {
    const actions = ['bank.create', 'item.create', 'recurring.create', 'contact.update', 'po.create', 'expense.post', 'settings.update'];
    for (const loc of LOCALES) {
      const books = JSON.parse(read(`messages/${loc}/books.json`));
      for (const a of actions) expect(books.audit[a.replace(/\./g, '_')], `${loc} ${a}`).toBeTruthy();
    }
  });

  it('los datos de ejemplo no llevan raya larga', () => {
    expect(read('lib/seed.ts')).not.toContain('—');
  });

  it('el aviso de un mensaje de chat se lee en el idioma de la UI, también los viejos', () => {
    const L = { someone: 'Alguien', chatMessage: 'Mensaje nuevo de {actor}' } as NotificationTextLabels;
    const meta = { type: 'chat_message', title: 'New message from Ana', source_type: 'chat_conversation', meta: { actorName: 'Ana' } };
    expect(notificationTitle(meta, L)).toBe('Mensaje nuevo de Ana');
    expect(notificationTitle({ ...meta, meta: null }, L)).toBe('Mensaje nuevo de Ana');
  });
});

describe('CSS compartido', () => {
  it('el aire de <section> es solo del sitio público', () => {
    const css = read('styles/globals.css');
    expect(css).toContain('section:not(:where(.app-frame *))');
    expect(css).not.toMatch(/^\s*section \{ padding-top/m);
  });

  it('un <th scope="row"> se ve como una celda', () => {
    expect(read('styles/ui.css')).toMatch(/\.table :where\(tbody\) th \{[^}]*white-space: normal/);
  });
});
