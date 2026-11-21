import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// La cita es un <button>: dentro de una burbuja con foto (contain: inline-size) necesita un ancho explícito,
// si no se achica a 0 y el nombre sale letra por letra.
describe('cita en burbuja con foto', () => {
  it('tiene ancho explícito', () => {
    const css = readFileSync('styles/groups-wa.css', 'utf8');
    const rule = css.match(/\.gr-inbox \.gr-bubble\.is-media > \.gr-quote \{([^}]*)\}/);
    // El marco de 3px lo pone la burbuja: la cita ocupa todo su ancho.
    expect(rule?.[1]).toMatch(/width:\s*100%/);
  });
});
