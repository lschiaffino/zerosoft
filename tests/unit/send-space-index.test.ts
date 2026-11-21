import { describe, expect, it } from 'vitest';
import { compareIndex, spaceIndex, spaceIndexCsv } from '@/lib/send/space-index';

describe('Send: índice numerado del espacio', () => {
  it('carpetas en orden de aparición, documentos adentro con N.M, sueltos con N', () => {
    const idx = spaceIndex([
      { documentId: 'deck', folder: '' },
      { documentId: 'pl', folder: 'Finance' },
      { documentId: 'nda', folder: 'Legal' },
      { documentId: 'cap', folder: 'Finance' },
      { documentId: 'memo', folder: '' },
    ]);
    // Como el visor: los sueltos juntos donde aparece el primero.
    expect(idx.documents).toEqual({ deck: '1', memo: '2', pl: '3.1', cap: '3.2', nda: '4.1' });
    expect(idx.folders).toEqual({ Finance: '3', Legal: '4' });
  });

  it('un espacio vacío no tiene números', () => {
    expect(spaceIndex([])).toEqual({ documents: {}, folders: {} });
  });

  it('ordena como números', () => {
    expect(['10', '2.10', '2.2', '1'].sort(compareIndex)).toEqual(['1', '2.2', '2.10', '10']);
  });

  it('el CSV lista carpetas y documentos en orden y neutraliza fórmulas', () => {
    const csv = spaceIndexCsv(
      [
        { index: '2.1', folder: 'Finance', title: '=HYPERLINK("x")', kind: 'pdf', pages: 4 },
        { index: '1', folder: '', title: 'Deck, v2', kind: 'pdf', pages: 12 },
      ],
      { Finance: '2', Empty: '3' },
    );
    expect(csv.split('\r\n')).toEqual(['index,folder,name,type,pages', '1,,"Deck, v2",pdf,12', '2,,Finance,folder,', `2.1,Finance,"'=HYPERLINK(""x"")",pdf,4`, '']);
  });
});

describe('Send: índice numerado guardado en el espacio', async () => {
  const { getDb } = await import('@/lib/db');
  const { createSpace, duplicateSpace, getSpace, setSpaceItems, spaceItems, spaceIndexOf, updateSpace } = await import('@/lib/send/spaces');
  const { makeUser } = await import('./helpers');
  type Actor = import('@/lib/send/types').SendActor;

  async function doc(actor: Actor, title: string, sharing = 'workspace') {
    const id = `sd_idx_${Math.random().toString(36).slice(2, 10)}`;
    const ts = new Date().toISOString();
    await getDb().prepare('INSERT INTO send_documents (id, workspace_id, owner_id, title, sharing, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, actor.ws, actor.person, title, sharing, ts, ts);
    return id;
  }

  it('se prende y se apaga, y la copia lo mantiene', async () => {
    const u = await makeUser('idx-toggle');
    const actor: Actor = { ws: u.id, person: u.id, admin: true, email: u.email ?? '', name: 'O' };
    const s = await createSpace(actor, 'Room');
    expect(Number((await getSpace(actor, s.id)).numbered)).toBe(0);
    await updateSpace(actor, s.id, { numbered: true });
    expect(Number((await getSpace(actor, s.id)).numbered)).toBe(1);
    // Cambiar otra cosa no lo apaga.
    await updateSpace(actor, s.id, { title: 'Room 2' });
    expect(Number((await getSpace(actor, s.id)).numbered)).toBe(1);
    expect(Number((await duplicateSpace(actor, s.id)).numbered)).toBe(1);
    await updateSpace(actor, s.id, { numbered: false });
    expect(Number((await getSpace(actor, s.id)).numbered)).toBe(0);
  });

  it('los números salen de todo el espacio: un compañero ve los mismos aunque no vea todo', async () => {
    const u = await makeUser('idx-numbers');
    const actor: Actor = { ws: u.id, person: u.id, admin: true, email: u.email ?? '', name: 'O' };
    const s = await createSpace(actor, 'Room');
    const priv = await doc(actor, 'Cap table', 'private');
    const deck = await doc(actor, 'Deck');
    const pl = await doc(actor, 'P&L');
    await setSpaceItems(actor, s.id, [{ documentId: priv }, { documentId: deck }, { documentId: pl, folder: 'Finance' }]);
    expect((await spaceIndexOf(s.id)).documents).toEqual({ [priv]: '1', [deck]: '2', [pl]: '3.1' });
    const mate = await makeUser('idx-mate');
    const teammate: Actor = { ws: actor.ws, person: mate.id, admin: false, email: mate.email ?? '', name: 'M' };
    expect((await spaceItems(teammate, s.id)).map((i) => [i.title, i.index])).toEqual([
      ['Deck', '2'],
      ['P&L', '3.1'],
    ]);
  });
});
