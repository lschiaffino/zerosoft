import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// La lista de mensajes es enfocable para el teclado, pero no muestra un recuadro alrededor de todo el chat.
describe('lista de mensajes sin recuadro de foco', () => {
  it('Inbox y Lines la dejan sin outline', () => {
    const css = readFileSync('styles/groups-wa.css', 'utf8');
    expect(css).toMatch(/\.ib-app \.gr-messages:focus-visible \{ outline: none; \}/);
    expect(css).toMatch(/\.gr-inbox \.gr-messages:focus-visible/);
  });
});
