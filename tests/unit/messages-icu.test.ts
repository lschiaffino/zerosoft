import fs from 'fs';
import path from 'path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { API_ENDPOINTS, API_SECTIONS } from '../../lib/api-docs';
import { icuPlainText } from '../../lib/icu-text';

const LOCALES = ['en', 'es', 'pt'] as const;
const DIR = path.join(process.cwd(), 'messages');

/** Se leen con t.raw (son plantillas con {{variables}} que se guardan tal cual). */
const RAW_KEYS = new Set(['calendar.workflows.defaultSubject', 'calendar.workflows.defaultBody']);

function leaves(obj: Record<string, unknown>, prefix = ''): Array<[string, string]> {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') return [[key, v] as [string, string]];
    return v && typeof v === 'object' ? leaves(v as Record<string, unknown>, key) : [];
  });
}

describe('messages/*.json', () => {
  for (const locale of LOCALES) {
    it(`${locale}: todo mensaje es ICU válido (si no, la página muestra la clave en lugar del texto)`, () => {
      const broken: string[] = [];
      for (const file of fs.readdirSync(path.join(DIR, locale)).filter((f) => f.endsWith('.json'))) {
        const ns = file.replace(/\.json$/, '');
        const messages = { [ns]: JSON.parse(fs.readFileSync(path.join(DIR, locale, file), 'utf8')) };
        for (const [key] of leaves(messages[ns])) {
          const full = `${ns}.${key}`;
          if (RAW_KEYS.has(full)) continue;
          const t = createTranslator({
            locale,
            messages,
            onError: (e) => {
              if (e.code === 'INVALID_MESSAGE') broken.push(`${locale}/${full}`);
            },
          });
          t(full as never);
        }
      }
      expect(broken, "Escapá '{', '}', '<' y '>' literales entre apóstrofos: '{{name}}', '<key>'").toEqual([]);
    });
  }
});

describe('textos de /docs (API)', () => {
  // EndpointSection y ApiDocsLayout llaman t(key) sin valores: un {x} literal sin
  // comillas es una variable que falta y la página muestra la clave.
  const keys = [
    ...API_SECTIONS.flatMap((s) => [s.titleKey, s.descKey ?? '']),
    ...API_ENDPOINTS.flatMap((e) => [e.titleKey, e.descKey, ...(e.params ?? []).map((p) => p.descriptionKey)]),
  ].filter(Boolean);

  for (const locale of LOCALES) {
    it(`${locale}: se muestran sin valores`, () => {
      const docs = JSON.parse(fs.readFileSync(path.join(DIR, locale, 'pages.json'), 'utf8')).docs;
      const failed: string[] = [];
      const t = createTranslator({ locale, messages: { docs }, onError: (e) => failed.push(e.message.slice(0, 120)) });
      for (const key of new Set(keys)) t(`docs.${key}` as never);
      expect(failed).toEqual([]);
    });
  }
});

describe('icuPlainText', () => {
  it('saca las comillas ICU y deja los apóstrofos sueltos', () => {
    expect(icuPlainText("like '{{name}}' or builtin:'<key>'")).toBe('like {{name}} or builtin:<key>');
    expect(icuPlainText("it's {x} ''quoted''")).toBe("it's {x} 'quoted'");
  });

  it('da el mismo texto que next-intl para los textos de la API', () => {
    const docs = JSON.parse(fs.readFileSync(path.join(DIR, 'en', 'pages.json'), 'utf8')).docs as Record<string, unknown>;
    const t = createTranslator({ locale: 'en', messages: { docs }, onError: () => {} });
    for (const [key, value] of Object.entries(docs)) {
      if (typeof value !== 'string' || /\{\s*\w+\s*[,}]/.test(icuPlainText(value).replace(/\{\{[^}]*\}\}/g, ''))) continue;
      expect(icuPlainText(value), key).toBe(t(`docs.${key}` as never));
    }
  });
});
