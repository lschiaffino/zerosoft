import { beforeEach, describe, expect, it } from 'vitest';
import { DRAFT_TRUST_MS, draftsVersion, forgetDraft, knownDraft, localDraft, pickDraft, resetDrafts, savedDraft, settled, subscribeDrafts, typeDraft } from '@/lib/draft-store';

describe('Borradores al instante: qué se muestra en la fila', () => {
  const now = 1_000_000;

  it('sin nada local, el del servidor', () => {
    expect(pickDraft(undefined, '', now)).toBe('');
    expect(pickDraft(undefined, 'hola', now)).toBe('hola');
  });

  it('mientras no se guardó, lo que se escribió (también vacío: borrarlo saca la etiqueta ya)', () => {
    expect(pickDraft({ text: 'hola', pending: true, savedAt: 0 }, '', now)).toBe('hola');
    expect(pickDraft({ text: '', pending: true, savedAt: 0 }, 'viejo', now)).toBe('');
  });

  it('guardado pero la lista todavía trae lo viejo: sigue lo local un rato, sin parpadear', () => {
    const local = { text: 'nuevo', pending: false, savedAt: now };
    expect(pickDraft(local, 'viejo', now + 1000)).toBe('nuevo');
    expect(pickDraft(local, 'viejo', now + DRAFT_TRUST_MS - 1)).toBe('nuevo');
    expect(pickDraft(local, 'viejo', now + DRAFT_TRUST_MS)).toBe('viejo');
  });

  it('lo local se suelta cuando el servidor coincide, o pasado el tiempo de gracia; nunca mientras está pendiente', () => {
    expect(settled({ text: 'a', pending: false, savedAt: now }, 'a', now)).toBe(true);
    expect(settled({ text: 'a', pending: false, savedAt: now }, 'b', now + 10)).toBe(false);
    expect(settled({ text: 'a', pending: false, savedAt: now }, 'b', now + DRAFT_TRUST_MS)).toBe(true);
    expect(settled({ text: 'a', pending: true, savedAt: 0 }, 'a', now)).toBe(false);
  });
});

describe('Borradores al instante: la tienda', () => {
  beforeEach(() => resetDrafts());

  it('escribir avisa a la lista; repetir lo mismo no', () => {
    let calls = 0;
    const off = subscribeDrafts(() => calls++);
    const v = draftsVersion();
    typeDraft('inbox', 't1', 'ho');
    typeDraft('inbox', 't1', 'ho');
    typeDraft('inbox', 't1', 'hola');
    expect(calls).toBe(2);
    expect(draftsVersion()).toBe(v + 2);
    expect(localDraft('inbox', 't1')).toEqual({ text: 'hola', pending: true, savedAt: 0 });
    off();
  });

  it('un guardado que llega tarde (de un texto anterior) no marca como guardado lo nuevo', () => {
    typeDraft('inbox', 't1', 'hola');
    typeDraft('inbox', 't1', 'hola Ana');
    savedDraft('inbox', 't1', 'hola', 5);
    expect(localDraft('inbox', 't1')?.pending).toBe(true);
    savedDraft('inbox', 't1', 'hola Ana', 6);
    expect(localDraft('inbox', 't1')).toEqual({ text: 'hola Ana', pending: false, savedAt: 6 });
  });

  it('cada app y cada chat por separado', () => {
    typeDraft('inbox', 't1', 'a');
    typeDraft('lines', 't1', 'b');
    typeDraft('inbox', 't2', 'c');
    expect(localDraft('inbox', 't1')?.text).toBe('a');
    expect(localDraft('lines', 't1')?.text).toBe('b');
    expect(localDraft('inbox', 't2')?.text).toBe('c');
    forgetDraft('inbox', 't1');
    expect(localDraft('inbox', 't1')).toBeUndefined();
    expect(localDraft('lines', 't1')?.text).toBe('b');
  });

  it('mandar el mensaje deja el borrador vacío ya, aunque la lista traiga el viejo', () => {
    typeDraft('inbox', 't1', 'hola');
    knownDraft('inbox', 't1', '', 100);
    expect(pickDraft(localDraft('inbox', 't1'), 'hola', 200)).toBe('');
  });
});
