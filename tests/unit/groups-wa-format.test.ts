import { describe, expect, it } from 'vitest';
import { parseWa } from '@/components/groups/wa/rich';
import { dayLabel, listTime, onlyEmoji } from '@/components/groups/wa/format';
import { messageActions } from '@/lib/groups-inbox-rules';

describe('formato de WhatsApp en los mensajes', () => {
  it('negrita, cursiva, tachado, código y monoespaciado', () => {
    expect(parseWa('hola *mundo*')).toEqual(['hola ', { kind: 'b', children: ['mundo'] }]);
    expect(parseWa('_ya_ y ~no~')).toEqual([{ kind: 'i', children: ['ya'] }, ' y ', { kind: 's', children: ['no'] }]);
    expect(parseWa('usá `npm i` ahora')).toEqual(['usá ', { kind: 'code', children: ['npm i'] }, ' ahora']);
    expect(parseWa('```a *b* c```')).toEqual([{ kind: 'pre', children: ['a *b* c'] }]);
    expect(parseWa('*negrita _y cursiva_*')).toEqual([{ kind: 'b', children: ['negrita ', { kind: 'i', children: ['y cursiva'] }] }]);
  });

  it('no formatea dentro de palabras, con espacios en los bordes ni en links', () => {
    expect(parseWa('2*3*4')).toEqual(['2*3*4']);
    expect(parseWa('* no *')).toEqual(['* no *']);
    expect(parseWa('https://x.com/a_b_c')).toEqual(['https://x.com/a_b_c']);
  });

  it('el HTML queda como texto (son nodos, nunca markup)', () => {
    expect(parseWa('<b>hola</b>')).toEqual(['<b>hola</b>']);
  });
});

describe('formatos de la bandeja', () => {
  const now = new Date(2026, 10, 7, 18, 0);
  it('hora de la lista: hoy la hora, ayer, el día, después la fecha', () => {
    expect(listTime(new Date(2026, 10, 7, 9, 5).toISOString(), 'en', now)).toMatch(/^9:05\s?AM$/);
    expect(listTime(new Date(2026, 10, 6, 9, 5).toISOString(), 'es', now)).toBe('Ayer');
    expect(listTime(new Date(2026, 9, 1).toISOString(), 'es', now)).toBe('01/10/2026');
    expect(dayLabel(new Date(2026, 10, 7, 1).toISOString(), 'pt', now)).toBe('Hoje');
  });
  it('emoji solo', () => {
    expect(onlyEmoji('😂')).toBe(true);
    expect(onlyEmoji('ok 😂')).toBe(false);
  });
});

describe('quién edita o borra un mensaje propio', () => {
  const caps = { edit: true, deleteForAll: true };
  const m = { direction: 'out' as const, status: 'sent', body: 'hola', media: null, deletedAt: null, createdAt: new Date().toISOString(), authorId: 'ana' as string | null, authorKind: 'person' };
  it('quien lo mandó o un admin; nadie más', () => {
    expect(messageActions(m, caps, { me: 'ana', isAdmin: false })).toMatchObject({ edit: true, delete: true });
    expect(messageActions(m, caps, { me: 'beto', isAdmin: false })).toMatchObject({ edit: false, delete: false });
    expect(messageActions(m, caps, { me: 'beto', isAdmin: true })).toMatchObject({ edit: true, delete: true });
    expect(messageActions({ ...m, authorId: null }, caps, { me: 'beto', isAdmin: false })).toMatchObject({ edit: false, delete: false });
  });
});
