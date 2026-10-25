import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { mergeMessages, pickMessages, type MessageTree } from '@/lib/i18n-messages';
import { checkRoutes, fileInfo, ROOT } from './i18n-client-scope';

function covered(need: string, provided: Set<string>): boolean {
  for (const p of provided) if (need === p || need.startsWith(p + '.')) return true;
  return false;
}

function loadLocale(locale: string): MessageTree {
  const dir = path.join(ROOT, 'messages', locale);
  const out: MessageTree = {};
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.json')) out[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  return out;
}

describe('pickMessages / mergeMessages', () => {
  const all: MessageTree = {
    common: { ok: 'OK', nav: { home: 'Home' } },
    crm: { title: 'CRM', formsPublic: { submit: 'Send', error: 'Oops' }, quotes: { print: 'Print' } },
  };

  it('trae namespaces enteros y ramas sueltas con sus padres', () => {
    expect(pickMessages(all, ['common', 'crm.formsPublic'])).toEqual({
      common: all.common,
      crm: { formsPublic: { submit: 'Send', error: 'Oops' } },
    });
  });

  it('ignora rutas que no existen y junta ramas del mismo namespace', () => {
    expect(pickMessages(all, ['crm.quotes', 'crm.nope', 'nope', 'crm.title'])).toEqual({
      crm: { quotes: { print: 'Print' }, title: 'CRM' },
    });
  });

  it('mezcla en profundidad sin pisar hermanos ni mutar la entrada', () => {
    const a: MessageTree = { crm: { quotes: { print: 'Print' } }, common: { ok: 'OK' } };
    const b: MessageTree = { crm: { title: 'CRM', quotes: { send: 'Send' } } };
    const merged = mergeMessages(a, b);
    expect(merged).toEqual({ crm: { quotes: { print: 'Print', send: 'Send' }, title: 'CRM' }, common: { ok: 'OK' } });
    expect(a).toEqual({ crm: { quotes: { print: 'Print' } }, common: { ok: 'OK' } });
  });
});

describe('mensajes i18n por ruta', () => {
  const routes = checkRoutes();

  it('encuentra las rutas y los layouts que proveen mensajes', () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(fileInfo(path.join(ROOT, 'app/[locale]/layout.tsx')).provides).toContain('common');
    expect(fileInfo(path.join(ROOT, 'app/[locale]/app/crm/layout.tsx')).provides).toEqual(['crm', 'trackTriage.customers']);
  });

  it('cada componente cliente lee solo namespaces que su ruta le manda', () => {
    const missing: string[] = [];
    for (const r of routes) {
      for (const [ns, who] of r.needs) {
        if (ns === '*') missing.push(`${r.file}: ${who} usa useTranslations() sin namespace o con uno calculado`);
        else if (!covered(ns, r.provided)) missing.push(`${r.file}: falta '${ns}' (lo usa ${who})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('las páginas públicas no reciben los mensajes de las apps', () => {
    const bio = routes.find((r) => r.file === 'app/[locale]/bio/[handle]/page.tsx')!;
    expect([...bio.provided].sort()).toEqual(['common', 'feedback.form', 'feedbackBoard']);
    const book = routes.find((r) => r.file === 'app/[locale]/book/[handle]/[slug]/page.tsx')!;
    expect(book.provided.has('crm')).toBe(false);
    expect(book.provided.has('calendar')).toBe(false);
  });

  it('cada namespace que provee un layout existe en los tres idiomas', () => {
    const provided = new Set<string>();
    for (const r of routes) for (const p of r.provided) provided.add(p);
    for (const locale of ['en', 'es', 'pt']) {
      const all = loadLocale(locale);
      for (const p of provided) {
        const picked = pickMessages(all, [p]);
        expect(Object.keys(picked), `${locale}: ${p}`).not.toHaveLength(0);
      }
    }
  });
});
