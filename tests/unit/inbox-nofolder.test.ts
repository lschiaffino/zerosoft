import { describe, expect, it } from 'vitest';
import { addMessage, applyThreadAction, createAccount, createFolder, deleteFolder, folderOverview, listThreads, listThreadsPage, upsertThread } from '@/lib/inbox/core';
import { isInboxView } from '@/lib/inbox/types';
import { makeUser } from './helpers';

/** Inbox: la vista "Sin carpeta" (chats de la bandeja que no están en ninguna carpeta). */
describe('Inbox: Sin carpeta', () => {
  async function setup(tag: string) {
    const owner = (await makeUser(`inbox-nofolder-${tag}`)).id;
    const acc = await createAccount(owner, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    const thread = async (title: string, opts: { unread?: boolean; kind?: 'dm' | 'group' } = {}) => {
      const t = await upsertThread(acc, { externalId: `${Math.floor(Math.random() * 1e12)}@${opts.kind === 'group' ? 'g.us' : 's.whatsapp.net'}`, kind: opts.kind ?? 'dm', title });
      await addMessage(t, { externalId: `m-${t.id}`, fromMe: false, body: 'test', sentAt: new Date().toISOString() });
      if (!opts.unread) await applyThreadAction(owner, [t.id], { action: 'read' });
      return t;
    };
    return { owner, thread };
  }
  const titles = async (owner: string) => (await listThreads(owner, { view: 'nofolder' })).map((t) => t.title).sort();

  it('es una vista de la URL', () => {
    expect(isInboxView('nofolder')).toBe(true);
  });

  it('lista solo los chats sin carpeta, sin archivados, hechos ni pospuestos', async () => {
    const { owner, thread } = await setup('base');
    const folder = await createFolder(owner, { name: 'Folder A' });
    const sub = await createFolder(owner, { name: 'Folder B', parentId: folder.id });
    const inFolder = await thread('Chat 1');
    const inSub = await thread('Chat 2');
    await thread('Chat 3');
    await thread('Chat 4');
    const archived = await thread('Chat 5');
    const done = await thread('Chat 6');
    const snoozed = await thread('Chat 7');
    await applyThreadAction(owner, [inFolder.id], { action: 'addFolder', folderId: folder.id });
    await applyThreadAction(owner, [inSub.id], { action: 'addFolder', folderId: sub.id });
    await applyThreadAction(owner, [archived.id], { action: 'archive' });
    await applyThreadAction(owner, [done.id], { action: 'done' });
    await applyThreadAction(owner, [snoozed.id], { action: 'snooze', until: new Date(Date.now() + 86_400_000).toISOString() });
    expect(await titles(owner)).toEqual(['Chat 3', 'Chat 4']);

    // Sumar uno a una carpeta lo saca; quitarlo lo devuelve.
    const loose = (await listThreads(owner, { view: 'nofolder' })).find((t) => t.title === 'Chat 3')!;
    await applyThreadAction(owner, [loose.id], { action: 'addFolder', folderId: folder.id });
    expect(await titles(owner)).toEqual(['Chat 4']);
    await applyThreadAction(owner, [loose.id], { action: 'removeFolder', folderId: folder.id });
    expect(await titles(owner)).toEqual(['Chat 3', 'Chat 4']);

    // Borrar la carpeta deja sus chats sin carpeta (aunque quede el vínculo viejo).
    await deleteFolder(owner, sub.id);
    expect(await titles(owner)).toEqual(['Chat 2', 'Chat 3', 'Chat 4']);
  });

  it('los chats que entran por la regla de una carpeta no están sin carpeta', async () => {
    const { owner, thread } = await setup('rule');
    await createFolder(owner, { name: 'Groups', rule: { kind: 'group' } });
    await thread('Group 1', { kind: 'group' });
    await thread('Chat 1');
    expect(await titles(owner)).toEqual(['Chat 1']);
  });

  it('nunca muestra chats de otra persona', async () => {
    const a = await setup('a');
    const b = await setup('b');
    await createFolder(a.owner, { name: 'Folder A' });
    await createFolder(b.owner, { name: 'Folder B', rule: { kind: 'dm' } });
    await a.thread('Mine');
    await b.thread('Theirs');
    await b.thread('Theirs too', { kind: 'group' });
    expect(await titles(a.owner)).toEqual(['Mine']);
    // La regla de B (todos los 1:1) no esconde los de A.
    expect(await titles(b.owner)).toEqual(['Theirs too']);
  });

  it('pagina con cursor como las carpetas', async () => {
    const { owner, thread } = await setup('page');
    await createFolder(owner, { name: 'Folder A' });
    for (let i = 0; i < 5; i++) await thread(`Chat ${i}`);
    const first = await listThreadsPage(owner, { view: 'nofolder', limit: 3, cursor: '' });
    expect(first.threads).toHaveLength(3);
    expect(first.next).not.toBeNull();
    const second = await listThreadsPage(owner, { view: 'nofolder', limit: 3, cursor: first.next });
    expect(second.threads).toHaveLength(2);
    expect(second.next).toBeNull();
    expect(new Set([...first.threads, ...second.threads].map((t) => t.id)).size).toBe(5);
  });

  it('cuenta los no leídos sin carpeta (0 sin carpetas)', async () => {
    const { owner, thread } = await setup('count');
    await thread('Chat 1', { unread: true });
    expect((await folderOverview(owner)).noFolderUnread).toBe(0);
    const folder = await createFolder(owner, { name: 'Folder A' });
    const filed = await thread('Chat 2', { unread: true });
    await thread('Chat 3');
    await applyThreadAction(owner, [filed.id], { action: 'addFolder', folderId: folder.id });
    const o = await folderOverview(owner);
    expect(o.noFolderUnread).toBe(1);
    expect(o.folders.find((f) => f.id === folder.id)?.count).toBe(1);
  });
});
