import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { addMessage, applyThreadAction, createAccount, createFolder, deleteFolder, listFolders, listThreads, moveFolder, updateFolder, upsertThread } from '@/lib/inbox/core';
import { canMoveFolder, depthOf, descendantIds, flattenTree, rollupUnread, siblingOrder, subtreeHeight } from '@/lib/inbox/folder-tree';
import { makeUser } from './helpers';

const F = (id: string, parentId: string | null, position: number) => ({ id, parentId, position });
// a
//   a1
//     a1x
//   a2
// b
const tree = [F('b', null, 1), F('a2', 'a', 1), F('a', null, 0), F('a1x', 'a1', 0), F('a1', 'a', 0)];

describe('Árbol de carpetas', () => {
  it('ordena padres antes que hijos y respeta la posición', () => {
    expect(flattenTree(tree).map((r) => `${r.folder.id}:${r.depth}${r.hasChildren ? '+' : ''}`)).toEqual(['a:0+', 'a1:1+', 'a1x:2', 'a2:1', 'b:0']);
  });

  it('plegar esconde toda la rama', () => {
    expect(flattenTree(tree, new Set(['a'])).map((r) => r.folder.id)).toEqual(['a', 'b']);
    expect(flattenTree(tree, new Set(['a1'])).map((r) => r.folder.id)).toEqual(['a', 'a1', 'a2', 'b']);
  });

  it('un ciclo o un padre que no existe no cuelga ni pierde carpetas', () => {
    const broken = [F('x', 'y', 0), F('y', 'x', 0), F('z', 'nope', 0)];
    const ids = flattenTree(broken).map((r) => r.folder.id);
    expect(ids.sort()).toEqual(['x', 'y', 'z']);
    expect(depthOf(broken, 'x')).toBeLessThan(3);
  });

  it('descendientes, profundidad y altura', () => {
    expect(descendantIds(tree, 'a').sort()).toEqual(['a1', 'a1x', 'a2']);
    expect(depthOf(tree, 'a1x')).toBe(2);
    expect(subtreeHeight(tree, 'a')).toBe(2);
    expect(subtreeHeight(tree, 'b')).toBe(0);
  });

  it('no deja meter una carpeta en sí misma, en sus hijas ni pasar el tope de niveles', () => {
    expect(canMoveFolder(tree, 'a', 'a1x')).toBe('invalid_parent');
    expect(canMoveFolder(tree, 'a', 'a')).toBe('invalid_parent');
    expect(canMoveFolder(tree, 'b', 'a1x')).toBe('ok'); // queda en el nivel 3
    expect(canMoveFolder(tree, 'a', 'b')).toBe('ok'); // cuatro niveles: b, a, a1, a1x
    expect(canMoveFolder([...tree, F('b1', 'b', 0)], 'a', 'b1')).toBe('too_deep'); // serían cinco
    expect(canMoveFolder(tree, 'a1', 'b')).toBe('ok');
    expect(canMoveFolder(tree, 'a1x', null)).toBe('ok');
  });

  it('posiciones de los hermanos al mover antes de otra o al final', () => {
    expect(siblingOrder(tree, 'b', null, 'a')).toEqual([
      ['b', 0],
      ['a', 1],
    ]);
    expect(siblingOrder(tree, 'a1x', 'a', null)).toEqual([
      ['a1', 0],
      ['a2', 1],
      ['a1x', 2],
    ]);
  });

  it('los no leídos suben a los padres sin contar dos veces un chat', () => {
    const own = new Map([
      ['a', new Set(['t1'])],
      ['a1x', new Set(['t1', 't2'])],
      ['a2', new Set(['t3'])],
    ]);
    const r = rollupUnread(tree, own);
    expect(r.get('a')).toBe(3);
    expect(r.get('a1')).toBe(2);
    expect(r.get('b')).toBe(0);
  });
});

describe('Carpetas anidadas en la base', () => {
  async function setup() {
    const owner = (await makeUser('inbox-folders')).id;
    const acc = await createAccount(owner, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    const thread = async (n: string, unread: boolean) => {
      const t = await upsertThread(acc, { externalId: `${n}${Math.floor(Math.random() * 1e8)}@s.whatsapp.net`, kind: 'dm', title: n });
      await addMessage(t, { externalId: `m-${n}`, fromMe: false, body: 'hola', sentAt: new Date().toISOString() });
      if (!unread) await applyThreadAction(owner, [t.id], { action: 'read' });
      return t;
    };
    return { owner, thread };
  }

  it('la carpeta padre muestra y cuenta lo de sus subcarpetas; mover reordena y valida', async () => {
    const { owner, thread } = await setup();
    const work = await createFolder(owner, { name: 'Trabajo' });
    const clients = await createFolder(owner, { name: 'Clientes', parentId: work.id });
    const acme = await createFolder(owner, { name: 'Acme', parentId: clients.id });
    const t1 = await thread('Ana', true);
    const t2 = await thread('Beto', true);
    const t3 = await thread('Caro', false);
    await applyThreadAction(owner, [t1.id], { action: 'addFolder', folderId: acme.id });
    await applyThreadAction(owner, [t2.id, t1.id], { action: 'addFolder', folderId: work.id });
    await applyThreadAction(owner, [t3.id], { action: 'addFolder', folderId: clients.id });

    const byName = Object.fromEntries((await listFolders(owner)).map((f) => [f.name, f]));
    expect(byName.Trabajo).toMatchObject({ count: 2, ownCount: 2 });
    expect(byName.Clientes).toMatchObject({ count: 1, ownCount: 0 });
    expect(byName.Acme).toMatchObject({ count: 1, ownCount: 1, parentId: clients.id });

    const inClients = await listThreads(owner, { folderId: clients.id });
    expect(inClients.map((t) => t.title).sort()).toEqual(['Ana', 'Caro']);

    // Un cuarto nivel no entra; Acme no puede ir dentro de sí misma.
    const deep = await createFolder(owner, { name: 'Proyecto', parentId: acme.id });
    await expect(createFolder(owner, { name: 'Muy hondo', parentId: deep.id })).rejects.toMatchObject({ code: 'too_deep' });
    await expect(updateFolder(owner, work.id, { parentId: acme.id })).rejects.toMatchObject({ code: 'invalid_parent' });
    await expect(moveFolder(owner, work.id, deep.id, null)).rejects.toMatchObject({ code: 'invalid_parent' });

    // Acme pasa al primer nivel, antes de Trabajo.
    await moveFolder(owner, acme.id, null, work.id);
    const top = (await listFolders(owner)).filter((f) => !f.parentId).sort((a, b) => a.position - b.position);
    expect(top.map((f) => f.name)).toEqual(['Acme', 'Trabajo']);
    expect((await listFolders(owner)).find((f) => f.id === deep.id)?.parentId).toBe(acme.id);

    // Borrar Acme: Proyecto sube a su nivel; los chats siguen.
    await deleteFolder(owner, acme.id);
    expect((await listFolders(owner)).find((f) => f.id === deep.id)?.parentId).toBeNull();
    const n = await getDb().prepare('SELECT COUNT(*) AS n FROM inbox_threads WHERE id = ?').get(t1.id);
    expect(Number((n as { n: number }).n)).toBe(1);
  });

  it('no se mueven carpetas de otra persona', async () => {
    const a = await setup();
    const b = await setup();
    const mine = await createFolder(a.owner, { name: 'Mía' });
    const theirs = await createFolder(b.owner, { name: 'Ajena' });
    await expect(moveFolder(a.owner, theirs.id, null, null)).rejects.toMatchObject({ code: 'not_found' });
    await expect(moveFolder(a.owner, mine.id, theirs.id, null)).rejects.toMatchObject({ code: 'invalid_parent' });
  });
});
