import { describe, expect, it } from 'vitest';
import en from '@/messages/en/lifecycleEmails.json';
import es from '@/messages/es/lifecycleEmails.json';
import pt from '@/messages/pt/lifecycleEmails.json';
import { ctaPath, lifecycleCopy, renderLifecycleEmail, sampleRenderInput } from '@/lib/lifecycle/templates';
import { LIFECYCLE_TEMPLATES, type LifecycleLocale } from '@/lib/lifecycle/types';

const LOCALES: LifecycleLocale[] = ['en', 'es', 'pt'];

function keys(obj: unknown, prefix = ''): string[] {
  if (typeof obj === 'string') return [prefix];
  if (Array.isArray(obj)) return [`${prefix}[${obj.length}]`, ...obj.flatMap((v, i) => keys(v, `${prefix}[${i}]`))];
  if (obj && typeof obj === 'object') return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
  return [];
}

describe('plantillas de ciclo de vida', () => {
  it('los tres idiomas tienen las mismas claves', () => {
    expect(keys(es).sort()).toEqual(keys(en).sort());
    expect(keys(pt).sort()).toEqual(keys(en).sort());
  });

  for (const locale of LOCALES) {
    for (const template of LIFECYCLE_TEMPLATES) {
      it(`${template} se arma en ${locale}`, () => {
        const out = renderLifecycleEmail(sampleRenderInput(template, locale));
        expect(out.subject.length).toBeGreaterThan(5);
        expect(out.subject.length).toBeLessThanOrEqual(70);
        expect(out.preheader.length).toBeGreaterThan(5);
        // Nada sin reemplazar ni vacío.
        for (const part of [out.subject, out.preheader, out.text, out.html]) {
          expect(part).not.toMatch(/\{[a-zA-Z]+\}/);
          expect(part).not.toContain('undefined');
          expect(part).not.toContain('null');
        }
        expect(out.html).toContain(`<html lang="${locale}"`);
        expect(out.html).toContain('<title>');
        // Un solo botón, a la pantalla de la app con el idioma.
        expect(out.html.match(/class="lc-btn"/g)).toHaveLength(1);
        // La app de escritorio pasa por el contador de clics (placement email) y termina en /download.
        if (template === 'feature_desktop') expect(out.ctaUrl).toBe(`https://zerosoft.ai/api/desktop/download?from=email&locale=${locale}`);
        else expect(out.ctaUrl.startsWith(`https://zerosoft.ai/${locale}/`)).toBe(true);
        expect(out.html).toContain(out.ctaUrl.replace(/&/g, "&amp;"));
        expect(out.text).toContain(out.ctaUrl);
        // Baja y preferencias en el pie, en HTML y en texto.
        for (const part of [out.html, out.text]) {
          expect(part).toContain('/email/unsubscribe?t=sample');
          expect(part).toContain('/app/settings/notifications');
        }
        // Reglas de voz (docs/voice.md).
        for (const part of [out.subject, out.text]) {
          expect(part).not.toMatch(/—/);
          expect(part).not.toMatch(/Zerosoft/);
          expect(part).not.toMatch(/\bno es [^.]{1,50}, es\b|\bit'?s not [^.]{1,50}, it'?s\b|\bnão é [^.]{1,50}, é\b/i);
        }
      });
    }
  }

  it('el saludo usa el nombre de pila y escapa HTML', () => {
    const out = renderLifecycleEmail({ ...sampleRenderInput('welcome', 'es'), name: '<b>Ana</b> García', team: '<script>x</script>' });
    expect(out.html).toContain('Hola &lt;b&gt;Ana&lt;/b&gt;,');
    expect(out.html).not.toContain('<b>Ana</b>');
    const digest = renderLifecycleEmail({ ...sampleRenderInput('digest', 'en'), team: '<script>x</script>' });
    expect(digest.html).not.toContain('<script>x</script>');
    expect(digest.html).toContain('&lt;script&gt;');
  });

  it('sin nombre saluda genérico', () => {
    expect(renderLifecycleEmail({ ...sampleRenderInput('tip_search', 'pt'), name: null }).text).toContain('Olá,');
  });

  it('el digest muestra solo lo que pasó', () => {
    const out = renderLifecycleEmail({ ...sampleRenderInput('digest', 'es'), digest: { docs: 2, issues: 0, deals: 0, members: 1 } });
    expect(out.text).toContain('Páginas nuevas en Docs: 2');
    expect(out.text).toContain('Personas nuevas en el workspace: 1');
    expect(out.text).not.toContain('Issues creados');
  });

  it('modo oscuro: automático con media query, o fijo para la vista previa', () => {
    expect(renderLifecycleEmail(sampleRenderInput('welcome', 'en')).html).toContain('prefers-color-scheme: dark');
    const dark = renderLifecycleEmail({ ...sampleRenderInput('welcome', 'en'), theme: 'dark' }).html;
    expect(dark).not.toContain('prefers-color-scheme');
    expect(dark).toContain('background:#111111');
  });

  it('la línea de la app de escritorio va en el pie, salvo en su propio email o si ya la tiene', () => {
    for (const locale of LOCALES) {
      const url = `https://zerosoft.ai/api/desktop/download?from=email&amp;locale=${locale}`;
      const welcome = renderLifecycleEmail(sampleRenderInput('welcome', locale));
      expect(welcome.html).toContain(url);
      expect(welcome.html).toContain(lifecycleCopy(locale).common.desktopLine.text);
      expect(welcome.text).toContain(`${lifecycleCopy(locale).common.desktopLine.link}: https://zerosoft.ai/api/desktop/download?from=email&locale=${locale}`);
      // Ya instalada: nada.
      const installed = renderLifecycleEmail({ ...sampleRenderInput('digest', locale), desktopInstalled: true });
      expect(installed.html).not.toContain('/api/desktop/download');
      expect(installed.text).not.toContain('/api/desktop/download');
      // Su propio email: el botón ya es la descarga, sin repetirla en el pie.
      const own = renderLifecycleEmail(sampleRenderInput('feature_desktop', locale));
      expect(own.html.match(/api\/desktop\/download/g)).toHaveLength(3); // botón, y href y texto del link de respaldo
      expect(own.html).not.toContain(lifecycleCopy(locale).common.desktopLine.text);
    }
  });

  it('cada botón lleva a donde se hace lo que pide', () => {
    expect(ctaPath('setup_import', { tool: 'hubspot' })).toBe('/app/crm/settings?tab=import&from=hubspot');
    expect(ctaPath('setup_first_item', { app: 'track' })).toBe('/app/track');
    expect(ctaPath('setup_calendar', {})).toBe('/app/calendar/settings?tab=connections');
    expect(ctaPath('team_invite', {})).toBe('/app/settings/members');
    expect(ctaPath('feature_desktop', {})).toBe('/download');
    expect(ctaPath('feature_mcp', {})).toBe('/docs/mcp');
  });
});
