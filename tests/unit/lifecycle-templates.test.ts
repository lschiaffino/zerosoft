import { describe, expect, it } from 'vitest';
import en from '@/messages/en/lifecycleEmails.json';
import es from '@/messages/es/lifecycleEmails.json';
import pt from '@/messages/pt/lifecycleEmails.json';
import { ctaPath, renderLifecycleEmail, sampleRenderInput } from '@/lib/lifecycle/templates';
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
        expect(out.ctaUrl.startsWith(`https://zerosoft.ai/${locale}/`)).toBe(true);
        expect(out.html).toContain(out.ctaUrl);
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

  it('cada botón lleva a donde se hace lo que pide', () => {
    expect(ctaPath('setup_import', { tool: 'hubspot' })).toBe('/app/crm/settings?tab=import&from=hubspot');
    expect(ctaPath('setup_first_item', { app: 'track' })).toBe('/app/track');
    expect(ctaPath('setup_calendar', {})).toBe('/app/calendar/settings?tab=connections');
    expect(ctaPath('team_invite', {})).toBe('/app/settings/members');
    expect(ctaPath('feature_desktop', {})).toBe('/download');
    expect(ctaPath('feature_mcp', {})).toBe('/docs/mcp');
  });
});
