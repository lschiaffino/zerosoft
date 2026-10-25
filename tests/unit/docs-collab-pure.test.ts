import { describe, expect, it } from 'vitest';
import { mergeBlocks, mergeText } from '@/lib/docs-merge';
import {
  applySuggestEdit,
  checkMarksOnlyChange,
  flatText,
  listCommentAnchors,
  listSuggestions,
  resolveSuggestionHtml,
  splitAtFlat,
  stripComments,
  wrapComment,
} from '@/lib/docs-marks';
import { diffBlocks, diffStats, diffText } from '@/lib/docs-diff';
import type { DocsBlock } from '@/lib/docs-types';

const p = (id: string, content: string, extra: Partial<DocsBlock> = {}): DocsBlock => ({ id, type: 'paragraph', content, ...extra });

describe('mergeText', () => {
  it('fusiona ediciones en tramos distintos de la misma frase', () => {
    const base = 'Hola mundo, qué tal';
    const ours = 'Hola mundo lindo, qué tal';
    const theirs = 'Hola mundo, qué tal todo';
    expect(mergeText(base, ours, theirs)).toEqual({ text: 'Hola mundo lindo, qué tal todo', conflict: false });
  });
  it('mismo tramo: gana lo propio y avisa', () => {
    expect(mergeText('abc', 'aXc', 'aYc')).toEqual({ text: 'aXc', conflict: true });
  });
  it('no corta adentro de un tag', () => {
    const base = 'uno <strong>dos</strong> tres';
    const ours = 'uno <strong>dos</strong> tres cuatro';
    const theirs = 'cero uno <strong>dos</strong> tres';
    expect(mergeText(base, ours, theirs).text).toBe('cero uno <strong>dos</strong> tres cuatro');
    const r = mergeText('a <em>b</em> c', 'a <strong>b</strong> c', 'a <em>b</em> c d');
    expect(r.text).toBe('a <strong>b</strong> c d');
  });
  it('inserciones en el mismo punto quedan las dos', () => {
    expect(mergeText('ab', 'aXb', 'aYb').text).toBe('aYXb');
  });
});

describe('mergeBlocks', () => {
  const base = [p('a', 'uno'), p('b', 'dos'), p('c', 'tres')];
  it('cambios en bloques distintos se combinan', () => {
    const ours = [p('a', 'uno!'), p('b', 'dos'), p('c', 'tres')];
    const theirs = [p('a', 'uno'), p('b', 'dos'), p('c', 'tres?')];
    expect(mergeBlocks(base, ours, theirs).blocks.map((b) => b.content)).toEqual(['uno!', 'dos', 'tres?']);
  });
  it('bloques nuevos de los dos lados en su lugar', () => {
    const ours = [p('a', 'uno'), p('x', 'nuevo mío'), p('b', 'dos'), p('c', 'tres')];
    const theirs = [p('a', 'uno'), p('b', 'dos'), p('c', 'tres'), p('y', 'nuevo de ella')];
    expect(mergeBlocks(base, ours, theirs).blocks.map((b) => b.id)).toEqual(['a', 'x', 'b', 'c', 'y']);
  });
  it('borrado de un lado y movido del otro', () => {
    const ours = [p('c', 'tres'), p('a', 'uno'), p('b', 'dos')];
    const theirs = [p('a', 'uno'), p('c', 'tres')];
    expect(mergeBlocks(base, ours, theirs).blocks.map((b) => b.id)).toEqual(['c', 'a']);
  });
  it('un borrado no se lleva un bloque que la otra persona editó', () => {
    const ours = [p('a', 'uno'), p('c', 'tres')];
    const theirs = [p('a', 'uno'), p('b', 'dos editado'), p('c', 'tres')];
    expect(mergeBlocks(base, ours, theirs).blocks.map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });
  it('campos distintos del mismo bloque', () => {
    const b2 = [p('a', 'uno', { checked: false, type: 'todo' })];
    const ours = [p('a', 'uno', { checked: true, type: 'todo' })];
    const theirs = [p('a', 'uno más', { checked: false, type: 'todo' })];
    expect(mergeBlocks(b2, ours, theirs).blocks[0]).toMatchObject({ checked: true, content: 'uno más' });
  });
});

describe('marcas de comentarios y sugerencias', () => {
  it('flatText y splitAtFlat con entidades y marcas', () => {
    expect(flatText('a &amp; <strong>b</strong>')).toBe('a & b');
    expect(splitAtFlat('ab<strong>cd</strong>ef', 3)).toEqual(['ab<strong>c</strong>', '<strong>d</strong>ef']);
    expect(splitAtFlat('a&amp;b', 2)).toEqual(['a&amp;', 'b']);
  });
  it('resaltado de comentario: envolver, listar y quitar', () => {
    const html = wrapComment('Hola <em>mundo</em> lindo', 2, 9, 'c1');
    expect(flatText(html)).toBe('Hola mundo lindo');
    expect(html).toContain('data-comment="c1"');
    expect(listCommentAnchors([{ content: html }])).toEqual(['c1']);
    expect(stripComments(html)).toBe('Hola <em>mundo</em> lindo');
  });
  it('tipeo sugerido: una sola inserción mientras se escribe', () => {
    let n = 0;
    const id = () => `s${++n}`;
    const r1 = applySuggestEdit('Hola mundo', 'Hola gran mundo', 'u1', id);
    expect(r1.caret).toBe(10);
    const r2 = applySuggestEdit(r1.html, r1.html.replace('gran ', 'gran!! '), 'u1', id);
    const sugs = listSuggestions([{ id: 'b', content: r2.html }]);
    expect(sugs).toHaveLength(1);
    expect(sugs[0]).toMatchObject({ inserted: 'gran!! ', deleted: '', by: 'u1' });
    expect(resolveSuggestionHtml(r2.html, false)).toBe('Hola mundo');
    expect(resolveSuggestionHtml(r2.html, true)).toBe('Hola gran!! mundo');
  });
  it('borrado sugerido: queda tachado; borrar lo propio lo saca de verdad', () => {
    let n = 0;
    const id = () => `d${++n}`;
    const r = applySuggestEdit('Hola mundo', 'Hola mndo', 'u1', id);
    expect(flatText(r.html)).toBe('Hola mundo');
    expect(listSuggestions([{ id: 'b', content: r.html }])[0]).toMatchObject({ deleted: 'u', inserted: '' });
    expect(r.caret).toBe(6);
    const ins = applySuggestEdit('ab', 'aXb', 'u1', id);
    const back = applySuggestEdit(ins.html, 'ab', 'u1', id);
    expect(back.html).toBe('ab');
  });
  it('validación: quien comenta solo agrega marcas y sus sugerencias', () => {
    const prev = [p('a', 'Hola mundo')];
    const withComment = [p('a', wrapComment('Hola mundo', 0, 4, 'c1'))];
    expect(checkMarksOnlyChange(prev, withComment, 'u1', false)).toBeNull();
    const sug = applySuggestEdit('Hola mundo', 'Hola gran mundo', 'u1', () => 's1');
    expect(checkMarksOnlyChange(prev, [p('a', sug.html)], 'u1', true)).toBeNull();
    expect(checkMarksOnlyChange(prev, [p('a', sug.html)], 'u1', false)).toBe('content_changed');
    expect(checkMarksOnlyChange(prev, [p('a', 'Hola gran mundo')], 'u1', true)).toBe('content_changed');
    // Firmar una sugerencia como otra persona no pasa.
    expect(checkMarksOnlyChange(prev, [p('a', sug.html)], 'u2', true)).toBe('foreign_suggestion');
    // Bloque sugerido entero.
    expect(checkMarksOnlyChange(prev, [...prev, p('n', 'nuevo', { suggestion: { id: 's9', by: 'u1' } })], 'u1', true)).toBeNull();
  });
});

describe('diff de versiones', () => {
  it('marca agregados, quitados y cambiados', () => {
    const before = [p('a', 'uno'), p('b', 'dos tres'), p('c', 'cuatro')];
    const after = [p('a', 'uno'), p('b', 'dos <strong>3</strong>'), p('d', 'cinco')];
    const d = diffBlocks(before, after);
    expect(d.map((x) => x.kind)).toEqual(['same', 'changed', 'removed', 'added']);
    expect(diffStats(d)).toEqual({ added: 1, removed: 1, changed: 1 });
    expect(d[1].segments).toEqual([
      { op: 'eq', text: 'dos ' },
      { op: 'del', text: 'tres' },
      { op: 'ins', text: '3' },
    ]);
  });
  it('diffText igual', () => {
    expect(diffText('a b', 'a b')).toEqual([{ op: 'eq', text: 'a b' }]);
  });
});
