import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import { getDb, upsertUser } from '@/lib/db';
import { recMoveNotice } from '@/lib/rec-schema';
import { createFolder, createVideo, finalizeVideo, getVideoRow, listVideos, setVideoFile, updateVideo, type RecActor } from '@/lib/rec';
import { createSpace } from '@/lib/rec-admin';
import { assembleLocal, saveLocalPart } from '@/lib/rec-upload';

const who = vi.hoisted(() => ({ actor: null as unknown }));
vi.mock('@/lib/rec-http', async (orig) => ({
  ...(await orig<typeof import('@/lib/rec-http')>()),
  recActor: async () => ({ actor: who.actor }),
}));

let uploads = '';
const admin: RecActor = { ws: 'rm-owner', actor: 'rm-admin', admin: true, name: 'Admin' };
const member: RecActor = { ws: 'rm-owner', actor: 'rm-member', admin: false, name: 'Member' };
const mate: RecActor = { ws: 'rm-owner', actor: 'rm-mate', admin: false, name: 'Mate' };

beforeAll(async () => {
  uploads = await mkdtemp(path.join(os.tmpdir(), 'rec-move-'));
  vi.stubEnv('UPLOADS_DIR', uploads);
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  for (const id of ['rm-owner', 'rm-admin', 'rm-member', 'rm-mate']) await upsertUser({ id, email: `${id}@test.local`, name: id });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(uploads, { recursive: true, force: true });
});

async function ready(actor: RecActor, title: string, extra: { spaceId?: string } = {}) {
  const v = await createVideo(actor, { title, mode: 'screen', contentType: 'video/webm', ...extra });
  await saveLocalPart(v.id, 'video', 1, Buffer.from('first'));
  const out = await assembleLocal(v.id, 'video', 'video/webm', 1);
  await setVideoFile(v.id, 'video', out.url, { size: out.size });
  await finalizeVideo(actor, v.id, { durationSec: 60 });
  await getDb().prepare("UPDATE rec_videos SET transcript_status = 'none' WHERE id = ?").run(v.id);
  return (await getVideoRow(actor, v.id))!;
}

describe('aviso del diálogo de mover', () => {
  it('avisa que "solo estas personas" no entra a un lugar compartido', () => {
    expect(recMoveNotice({ spaceId: null, privacy: 'people' }, { space: 'workspace', folderId: null, spaceId: 's1' })).toBe('needs_privacy');
    expect(recMoveNotice({ spaceId: null, privacy: 'people' }, { space: 'workspace', folderId: null })).toBe('needs_privacy');
    expect(recMoveNotice({ spaceId: null, privacy: 'people' }, { space: 'personal', folderId: 'f1' })).toBeNull();
  });
  it('avisa que un video de un espacio pasa a "solo estas personas" en Mis videos', () => {
    expect(recMoveNotice({ spaceId: 's1', privacy: 'workspace' }, { space: 'personal', folderId: null })).toBe('becomes_people');
    expect(recMoveNotice({ spaceId: 's1', privacy: 'link' }, { space: 'personal', folderId: null })).toBeNull();
    expect(recMoveNotice({ spaceId: null, privacy: 'workspace' }, { space: 'personal', folderId: null })).toBeNull();
  });
  it('coincide con lo que hace el servidor', async () => {
    const s = await createSpace(member, 'Ida y vuelta');
    const v = await ready(member, 'Ida', { spaceId: s.id });
    await updateVideo(member, v.id, { privacy: 'workspace' });
    await updateVideo(member, v.id, { folderId: null, space: 'personal', spaceId: null });
    const back = (await getVideoRow(member, v.id))!;
    expect(back.people_only).toBe(1);
    // Volver al espacio sin cambiar quién lo ve falla, como avisa el diálogo.
    expect(recMoveNotice({ spaceId: null, privacy: 'people' }, { space: 'workspace', folderId: null, spaceId: s.id })).toBe('needs_privacy');
    await expect(updateVideo(member, v.id, { folderId: null, space: 'workspace', spaceId: s.id })).rejects.toMatchObject({ code: 'people_needs_personal' });
    await updateVideo(member, v.id, { privacy: 'workspace', folderId: null, space: 'workspace', spaceId: s.id });
    expect((await getVideoRow(member, v.id))!.space_id).toBe(s.id);
  });
});

describe('sacar de una carpeta', () => {
  it('folderId null en un espacio cerrado lo deja en el espacio, no en el workspace general', async () => {
    const s = await createSpace(member, 'Cerrado');
    const f = await createFolder(member, { name: 'Adentro', space: 'workspace', spaceId: s.id });
    const v = await ready(member, 'Secreto', { spaceId: s.id });
    await updateVideo(member, v.id, { folderId: f.id });
    expect((await getVideoRow(member, v.id))!.folder_id).toBe(f.id);
    await updateVideo(member, v.id, { folderId: null });
    const row = (await getVideoRow(member, v.id))!;
    expect(row.folder_id).toBeNull();
    expect(row.space_id).toBe(s.id);
    expect(row.space).toBe('workspace');
    expect(await getVideoRow(mate, v.id)).toBeNull();
    expect((await listVideos(mate, { kind: 'workspace' })).map((x) => x.id)).not.toContain(v.id);
  });

  it('folderId null en una carpeta personal la deja en Mis videos', async () => {
    const f = await createFolder(member, { name: 'Mía', space: 'personal' });
    const v = await ready(member, 'Personal');
    await updateVideo(member, v.id, { folderId: f.id });
    await updateVideo(member, v.id, { folderId: null });
    const row = (await getVideoRow(member, v.id))!;
    expect(row.space).toBe('personal');
    expect(await getVideoRow(mate, v.id)).toBeNull();
  });
});

describe('PATCH de un video que quien mueve deja de ver', () => {
  it('un admin que manda el video de un espacio a Mis videos de quien lo grabó recibe 200 y video null', async () => {
    const { PATCH } = await import('@/lib/routes/rec/videos/[id]/route');
    const s = await createSpace(member, 'Del member');
    const v = await ready(member, 'Del espacio', { spaceId: s.id });
    who.actor = admin;
    const req = new NextRequest(`http://localhost/api/rec/videos/${v.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folderId: null, space: 'personal', spaceId: null }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: v.id }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { video: unknown }).video).toBeNull();
    const row = (await getVideoRow(member, v.id))!;
    expect(row.space).toBe('personal');
    expect(row.space_id).toBeNull();
  });

  it('si sigue viéndolo, devuelve el video', async () => {
    const { PATCH } = await import('@/lib/routes/rec/videos/[id]/route');
    const v = await ready(member, 'Sigue');
    who.actor = member;
    const req = new NextRequest(`http://localhost/api/rec/videos/${v.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Nuevo' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: v.id }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { video: { title: string } }).video.title).toBe('Nuevo');
  });
});
