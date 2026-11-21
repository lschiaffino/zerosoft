import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createSpace, duplicateSpace, getSpace, listSpaceAccess, setSpaceAccess, setSpaceItems, spaceItems, updateSpace } from '@/lib/send/spaces';
import { createLink } from '@/lib/send/core';
import type { SendActor } from '@/lib/send/types';
import { makeUser } from './helpers';

async function doc(actor: SendActor, title: string, sharing: 'private' | 'workspace' = 'private', owner = actor.person) {
  const id = `sd_dup_${Math.random().toString(36).slice(2, 10)}`;
  const ts = new Date().toISOString();
  await getDb()
    .prepare('INSERT INTO send_documents (id, workspace_id, owner_id, title, sharing, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.ws, owner, title, sharing, ts, ts);
  return id;
}

async function setup(label: string) {
  const owner = await makeUser(label);
  const actor: SendActor = { ws: owner.id, person: owner.id, admin: true, email: owner.email ?? '', name: 'Owner' };
  const space = await createSpace(actor, 'Seed round');
  await updateSpace(actor, space.id, { description: 'Q3 numbers', sharing: 'workspace' });
  const a = await doc(actor, 'Deck', 'workspace');
  const b = await doc(actor, 'Model', 'workspace');
  await setSpaceItems(actor, space.id, [
    { documentId: b, folder: 'Finance' },
    { documentId: a, folder: '' },
  ]);
  return { actor, space, a, b };
}

describe('Send: duplicar un espacio', () => {
  it('copia título, descripción, documentos, orden y carpetas', async () => {
    const { actor, space, a, b } = await setup('dup-basic');
    const copy = await duplicateSpace(actor, space.id, '  Series A  ');
    expect(copy.id).not.toBe(space.id);
    expect(copy.title).toBe('Series A');
    expect(copy.description).toBe('Q3 numbers');
    expect(copy.sharing).toBe('workspace');
    expect(copy.owner_id).toBe(actor.person);
    const items = await spaceItems(actor, copy.id);
    expect(items.map((i) => [i.documentId, i.folder])).toEqual([
      [b, 'Finance'],
      [a, ''],
    ]);
    // El original no cambia.
    expect((await spaceItems(actor, space.id)).map((i) => i.documentId)).toEqual([b, a]);
  });

  it('sin título usa el del original', async () => {
    const { actor, space } = await setup('dup-notitle');
    expect((await duplicateSpace(actor, space.id)).title).toBe('Seed round');
  });

  it('no copia links ni la lista de acceso', async () => {
    const { actor, space, a } = await setup('dup-links');
    await createLink(actor, { spaceId: space.id }, { name: 'Acme' });
    await setSpaceAccess(actor, space.id, 'ana@acme.com', [a]);
    const copy = await duplicateSpace(actor, space.id);
    expect(await listSpaceAccess(actor, copy.id)).toEqual([]);
    const links = (await getDb().prepare('SELECT COUNT(*) AS n FROM send_links WHERE space_id = ?').get(copy.id)) as { n: number };
    expect(Number(links.n)).toBe(0);
  });

  it('un compañero que ve el espacio queda dueño de la copia, sin los documentos privados de otros', async () => {
    const { actor, space, a, b } = await setup('dup-teammate');
    const hidden = await doc(actor, 'Cap table', 'private');
    await setSpaceItems(actor, space.id, [{ documentId: a }, { documentId: b }, { documentId: hidden }]);
    const mate = await makeUser('dup-mate');
    const teammate: SendActor = { ws: actor.ws, person: mate.id, admin: false, email: mate.email ?? '', name: 'Mate' };
    const copy = await duplicateSpace(teammate, space.id, 'Mine');
    expect(copy.owner_id).toBe(mate.id);
    expect((await spaceItems(actor, copy.id)).map((i) => i.documentId)).toEqual([a, b]);
  });

  it('no duplica un espacio de otro workspace ni uno borrado', async () => {
    const { space } = await setup('dup-other');
    const stranger = await makeUser('dup-stranger');
    const other: SendActor = { ws: stranger.id, person: stranger.id, admin: true, email: stranger.email ?? '', name: 'X' };
    await expect(duplicateSpace(other, space.id)).rejects.toMatchObject({ status: 404 });
    await expect(getSpace(other, space.id)).rejects.toBeTruthy();
  });

  it('un compañero no duplica un espacio privado de otro', async () => {
    const { actor, space } = await setup('dup-private');
    await updateSpace(actor, space.id, { sharing: 'private' });
    const mate = await makeUser('dup-private-mate');
    const teammate: SendActor = { ws: actor.ws, person: mate.id, admin: false, email: mate.email ?? '', name: 'Mate' };
    await expect(duplicateSpace(teammate, space.id)).rejects.toMatchObject({ status: 404 });
  });
});
