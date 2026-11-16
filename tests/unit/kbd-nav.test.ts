import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RELEASE, modeAfterFocus, modeAfterKey } from '@/lib/kbd-nav';

// Foco tranquilo de Inbox y Lines: el anillo aparece con Tab o dentro de un diálogo abierto con un atajo.
describe('modalidad de teclado', () => {
  it('solo Tab prende los anillos; una letra, una flecha o Enter no', () => {
    expect(modeAfterKey('pointer', { key: 'Tab' })).toBe('tab');
    expect(modeAfterKey('pointer', { key: 'Tab', ctrlKey: true })).toBe('pointer');
    for (const key of ['j', 'k', 'e', 'h', 'ArrowDown', 'ArrowUp', 'Enter', 'Escape', ' ']) expect(modeAfterKey('pointer', { key })).toBe('pointer');
    expect(modeAfterKey('overlay', { key: 'Tab' })).toBe('tab');
  });

  it('un atajo que abre un diálogo muestra el foco adentro y lo apaga al volver a la página', () => {
    expect(modeAfterFocus('pointer', true)).toBe('overlay');
    expect(modeAfterFocus('overlay', true)).toBe('overlay');
    expect(modeAfterFocus('overlay', false)).toBe('pointer');
    // Un foco movido por código en la página (volver a la fila con Esc) no prende nada.
    expect(modeAfterFocus('pointer', false)).toBe('pointer');
    // Con Tab ya prendido, moverse con flechas dentro o fuera de un menú no lo apaga.
    expect(modeAfterFocus('tab', false)).toBe('tab');
    expect(modeAfterFocus('tab', true)).toBe('tab');
  });

  it('sueltan el foco tras un clic: navegación del sidebar, filas, pestañas y chips; no los botones que abren menús', () => {
    for (const sel of ['.docs-tree-link', '.ib-row-btn', '.gr-row', 'a.ui-tab', '.gr-filter']) expect(RELEASE).toContain(sel);
    expect(RELEASE).not.toMatch(/ftree-btn|wa-icon-btn|chevron/);
  });
});

describe('hoja de foco tranquilo', () => {
  const css = readFileSync('styles/calm-focus.css', 'utf8');

  it('todo depende de los atributos de la raíz: sin ellos no cambia nada', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{/g) ?? [];
    expect(rules.length).toBeGreaterThan(5);
    for (const r of rules) if (!r.trim().startsWith('@media')) expect(r).toContain(':root[data-kbd-');
  });

  it('con el mouse no hay recuadros y los campos de texto quedan afuera', () => {
    expect(css).toMatch(/:root\[data-kbd-nav='0'\] :focus-visible:not\(input:not\(\[type='checkbox'\][^{]*textarea, \[contenteditable\][^{]*\{\s*outline: none !important;/);
  });

  it('con Tab el anillo es fino y gris, y más fuerte con prefers-contrast: more', () => {
    expect(css).toMatch(/--kbd-ring: var\(--brand-gray-2\);/);
    expect(css).toMatch(/--kbd-ring-w: 2px;/);
    expect(css).toMatch(/@media \(prefers-contrast: more\) \{\s*:root\[data-kbd-nav\] \{ --kbd-ring: var\(--ink\); --kbd-ring-w: 3px; \}/);
  });
});
