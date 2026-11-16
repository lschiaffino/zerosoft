import { describe, expect, it } from 'vitest';
import { createLibraryItem, deleteLibraryItem, listLibrary, type SocialActor } from '@/lib/social';
import { fillSavedReply, firstName } from '@/lib/social-saved-replies';
import { makeUser } from './helpers';

process.env.SOCIAL_FAKE = '1';

describe('respuestas guardadas: variables', () => {
  it('completa {name} con el nombre de pila y {account} con la cuenta', () => {
    expect(fillSavedReply('Hola {name}, gracias por escribir a {account}.', { authorName: 'Ana Pérez', accountName: 'Café Sur' })).toBe('Hola Ana, gracias por escribir a Café Sur.');
    expect(fillSavedReply('Hi {NAME}!', { authorName: '@bob' })).toBe('Hi bob!');
  });

  it('sin el dato, la variable se va sin dejar espacios ni comas sueltas', () => {
    expect(fillSavedReply('Hola {name}, gracias', {})).toBe('Hola, gracias');
    expect(fillSavedReply('{name}, gracias', { authorName: '  ' })).toBe('gracias');
    expect(fillSavedReply('Hi {name}!', {})).toBe('Hi!');
    expect(fillSavedReply('Línea\n{name}, chau', {})).toBe('Línea\nchau');
  });

  it('deja como están las llaves que no son variables', () => {
    expect(fillSavedReply('Código {promo} para {name}', { authorName: 'Ana' })).toBe('Código {promo} para Ana');
    expect(firstName(null)).toBe('');
  });
});

describe('respuestas guardadas: biblioteca', () => {
  it('se guardan como kind reply, se listan aparte y no se ven desde otro workspace', async () => {
    const a = await makeUser('replies-a');
    const b = await makeUser('replies-b');
    const actor: SocialActor = { workspaceId: a.id, personId: a.id, role: 'owner' };
    const other: SocialActor = { workspaceId: b.id, personId: b.id, role: 'owner' };
    const reply = await createLibraryItem(actor, { kind: 'reply', name: 'Envíos', body: 'Hola {name}, enviamos a todo el país.' });
    await createLibraryItem(actor, { kind: 'snippet', name: 'Firma', body: 'El equipo' });
    expect(reply.kind).toBe('reply');
    expect((await listLibrary(actor, 'reply')).map((i) => i.name)).toEqual(['Envíos']);
    expect((await listLibrary(actor, 'snippet')).map((i) => i.name)).toEqual(['Firma']);
    expect(await listLibrary(other, 'reply')).toEqual([]);
    await expect(deleteLibraryItem(other, reply.id)).rejects.toMatchObject({ status: 404 });
    await deleteLibraryItem(actor, reply.id);
    expect(await listLibrary(actor, 'reply')).toEqual([]);
  });
});
