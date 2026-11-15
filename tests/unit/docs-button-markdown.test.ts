import { describe, expect, it } from 'vitest';
import { expandButtonShorthand } from '@/lib/docs-button-markdown';
import { markdownToBlocks } from '@/lib/docs-import';
import { sanitizeDocsHtml as sanitizeHtml } from '@/lib/docs-sanitize';

const blocks = (md: string) =>
  markdownToBlocks(expandButtonShorthand(md), { sanitize: sanitizeHtml }).map((b) => [b.type, b.content, b.checked ?? null, b.indent ?? 0]);

describe('Markdown del bloque botón', () => {
  it('lee los atajos de tarea como to-dos', () => {
    expect(blocks('[]Tarea extra')).toEqual([['todo', 'Tarea extra', false, 0]]);
    expect(blocks('[] Tarea')).toEqual([['todo', 'Tarea', false, 0]]);
    expect(blocks('[ ] Tarea')).toEqual([['todo', 'Tarea', false, 0]]);
    expect(blocks('- [ ] Tarea')).toEqual([['todo', 'Tarea', false, 0]]);
    expect(blocks('- [] Tarea')).toEqual([['todo', 'Tarea', false, 0]]);
    expect(blocks('* [x] Hecha')).toEqual([['todo', 'Hecha', true, 0]]);
    expect(blocks('[x] Hecha')).toEqual([['todo', 'Hecha', true, 0]]);
    expect(blocks('[X] Hecha')).toEqual([['todo', 'Hecha', true, 0]]);
  });

  it('mezcla tareas con el resto de los atajos', () => {
    expect(blocks('## Notas\n[] uno\n[x] dos\n- punto\n1. primero\n\n> cita\n---')).toEqual([
      ['heading', 'Notas', null, 0],
      ['todo', 'uno', false, 0],
      ['todo', 'dos', true, 0],
      ['bulleted_list_item', 'punto', null, 0],
      ['numbered_list_item', 'primero', null, 0],
      ['quote', 'cita', null, 0],
      ['divider', '', null, 0],
    ]);
  });

  it('respeta la sangría de una subtarea', () => {
    expect(blocks('[] madre\n  [] hija')).toEqual([
      ['todo', 'madre', false, 0],
      ['todo', 'hija', false, 1],
    ]);
  });

  it('no toca links, texto con corchetes en el medio ni bloques de código', () => {
    expect(expandButtonShorthand('[x](https://a.com) link')).toBe('[x](https://a.com) link');
    expect(expandButtonShorthand('Ver [nota] abajo')).toBe('Ver [nota] abajo');
    expect(expandButtonShorthand('```\n[] queda\n```')).toBe('```\n[] queda\n```');
  });
});
