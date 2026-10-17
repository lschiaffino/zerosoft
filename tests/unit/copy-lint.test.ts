import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Lint del copy del sitio público (docs/voice.md). Recorre cada string de
 * messages/<locale>/{common,pages,tools,brand}.json y falla si aparece un patrón
 * prohibido. Si un string necesita una excepción legítima, agregalo a ALLOW
 * con la ruta exacta ("es/pages:docs.algo") y el nombre de la regla.
 */

const root = join(__dirname, '..', '..');
const LOCALES = ['es', 'en', 'pt'] as const;
const NAMESPACES = ['common', 'pages', 'tools', 'brand', 'settings'] as const;

const RULES: Record<string, RegExp> = {
  'raya larga (—)': /—/,
  'para siempre / forever': /para siempre|para sempre|\bforever\b/i,
  'no es X, es Y': /\bno es [^.;:!?]{1,50}, es\b|\bnão é [^.;:!?]{1,50}, é(?=\s)|\bit'?s not [^.;:!?]{1,50}, it'?s\b|\bisn'?t [^.;:!?]{1,50}, it'?s\b/i,
  'no X, sino Y': /, sino\b/i,
  'marca en mayúscula': /Zerosoftware|Zerosoft(?!-Signature)/,
  'liberar': /\bliberad[oa]s?\b|\bliberar\b|\bliberamos\b|\bset free\b/i,
  'murió': /\bmurió|\bmurio\b|\bmorreu\b|\bis dead\b/i,
  'nuevo mundo': /nuevo mundo|novo mundo|new world/i,
  'arsenal': /\barsenal\b/i,
  'precio del aire': /precio del aire|preço do ar|price of air/i,
  'rehenes': /rehenes|reféns|hostage/i,
  'cero humo': /cero humo|zero hype/i,
  'ya está vivo / en el aire': /ya está vivo|ya está en el aire|já está no ar/i,
  'obviamente': /\bobviamente\b|\bobviously\b/i,
  'estadística inventada': /\b80 ?% (de|of|do)\b/i,
  'tríada sin X, sin Y, sin Z': /\b(sin|sem|no|without) [^.,;]{1,30}[,.] (sin|sem|no|without) [^.,;]{1,30}[,.] (sin|sem|no|without) /i,
  'cierre "por $0"': /[,:] (por|for) \$0[.!]?$/i,
  'seis herramientas': /\bseis herramientas\b|\bsix tools\b|\bseis ferramentas\b/i,
  'gratis dos veces': /(\bgratis\b|\bgrátis\b|\bfree\b)[\s\S]*(\bgratis\b|\bgrátis\b|\bfree\b)/i,
};

/** Excepciones: "<locale>/<ns>:<ruta>" → reglas que no aplican a ese string. */
const ALLOW: Record<string, string[]> = Object.fromEntries(
  // La guía de marca muestra cada patrón prohibido como ejemplo de "No".
  LOCALES.flatMap((l) => [
    [`${l}/brand:voice.rules.r2.no`, ['no es X, es Y']],
    [`${l}/brand:voice.rules.r3.no`, ['raya larga (—)']],
    [`${l}/brand:voice.rules.r4.no`, ['tríada sin X, sin Y, sin Z']],
  ]),
);

function strings(obj: unknown, prefix: string, out: [string, string][]): [string, string][] {
  if (typeof obj === 'string') out.push([prefix, obj]);
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) strings(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

describe('copy-lint', () => {
  for (const locale of LOCALES) {
    for (const ns of NAMESPACES) {
      it(`${locale}/${ns}.json no usa patrones prohibidos`, () => {
        const json = JSON.parse(readFileSync(join(root, 'messages', locale, `${ns}.json`), 'utf8')) as unknown;
        const problems: string[] = [];
        for (const [key, value] of strings(json, '', [])) {
          const id = `${locale}/${ns}:${key}`;
          for (const [rule, re] of Object.entries(RULES)) {
            if (ALLOW[id]?.includes(rule)) continue;
            if (re.test(value)) problems.push(`${id} [${rule}] ${value.slice(0, 100)}`);
          }
        }
        expect(problems).toEqual([]);
      });
    }
  }

  it('las reglas detectan los casos que tienen que detectar', () => {
    const hits = (s: string) => Object.entries(RULES).filter(([, re]) => re.test(s)).map(([n]) => n);
    expect(hits('El software murió.')).toContain('murió');
    expect(hits('Usar Link — es gratis')).toContain('raya larga (—)');
    expect(hits('Open source no es gratis, es libre')).toContain('no es X, es Y');
    expect(hits('Hostealo gratis, para siempre.')).toContain('para siempre / forever');
    expect(hits('Con Zerosoft')).toContain('marca en mayúscula');
    expect(hits('Firma Zerosoft-Signature')).not.toContain('marca en mayúscula');
    expect(hits('Sin lock-in. Sin letra chica. Sin trial.')).toContain('tríada sin X, sin Y, sin Z');
    expect(hits('Plan gratis o hostealo gratis')).toContain('gratis dos veces');
    expect(hits('Open source não é grátis, é livre')).toContain('no es X, es Y');
    expect(hits('Probar Link')).toEqual([]);
  });
});
