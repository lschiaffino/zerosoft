import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { getDb, upsertUser } from '@/lib/db';
import { composeWebm, readWebmDuration } from '@/lib/rec-webm';
import {
  brandOnColor,
  cleanBrandColor,
  cleanEmails,
  cleanOverlays,
  fillerSegments,
  keepRanges,
  overlaysInTrim,
  remapChapters,
  remapSegments,
  silenceCuts,
} from '@/lib/rec-schema';
import {
  createFolder,
  createVideo,
  emailGateToken,
  finalizeDerived,
  finalizeVideo,
  getFolder,
  getPublicVideoRow,
  getVideoRow,
  listFolders,
  listVideos,
  publicAccess,
  RecError,
  rotateShareId,
  searchRec,
  setVideoFile,
  setWatchLater,
  toDto,
  toPublicDto,
  updateVideo,
  type RecActor,
} from '@/lib/rec';
import {
  applyRetention,
  createSpace,
  decideAccessRequest,
  deleteSpace,
  getRecBrand,
  getRecSettings,
  getSpace,
  listAccessRequests,
  listContentOwners,
  listSpaces,
  requestAccess,
  retentionPreview,
  sendRecap,
  setSpaceMembers,
  transferContent,
  updateRecSettings,
  videoDocBlocks,
} from '@/lib/rec-admin';
import { assembleLocal, saveLocalPart } from '@/lib/rec-upload';

// ---------- WebM ----------

const num = (n: number, bytes = 2) => {
  const out: number[] = [];
  for (let i = bytes - 1; i >= 0; i--) out.push(Math.floor(n / 256 ** i) % 256);
  return out;
};

/** WebM de video con un cluster keyframe cada `step` ms, cuatro bloques por cluster. Cada bloque lleva un byte propio. */
function webm(opts: { clusters: number; step: number; marker: number; width?: number }): Uint8Array {
  const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01];
  const segment = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  const infoBody = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40];
  const info = [0x15, 0x49, 0xa9, 0x66, 0x80 | infoBody.length, ...infoBody];
  const video = [0xb0, 0x82, ...num(opts.width ?? 320), 0xba, 0x82, ...num(180)];
  const codec = Array.from('V_VP8').map((c) => c.charCodeAt(0));
  const entry = [0xd7, 0x81, 0x01, 0x83, 0x81, 0x01, 0x86, 0x80 | codec.length, ...codec, 0xe0, 0x80 | video.length, ...video];
  const trackEntry = [0xae, 0x80 | entry.length, ...entry];
  const tracks = [0x16, 0x54, 0xae, 0x6b, 0x80 | trackEntry.length, ...trackEntry];
  const body: number[] = [];
  for (let c = 0; c < opts.clusters; c++) {
    const tc = num(c * opts.step);
    body.push(0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x82, ...tc);
    for (let b = 0; b < 4; b++) {
      const rel = num(Math.floor((b * opts.step) / 4));
      body.push(0xa3, 0x85, 0x81, ...rel, b === 0 ? 0x80 : 0x00, opts.marker + c * 4 + b);
    }
  }
  return Uint8Array.from([...ebml, ...segment, ...info, ...tracks, ...body]);
}

const has = (b: Uint8Array, x: number) => Array.from(b).includes(x);

describe('componer WebM sin recodificar', () => {
  it('saca el medio: lo marcado no queda en el archivo y la duración es la nueva', () => {
    // Clusters cada 2 s: 0, 2, 4, 6. Bloques cada 500 ms.
    const src = webm({ clusters: 4, step: 2000, marker: 0xc0 });
    const out = composeWebm([{ bytes: src, keep: [[0, 2500], [4000, 8000]] }]);
    if (!out.ok) throw new Error(out.error);
    // Del cluster de 2 s solo salen los bloques antes de 2500 (2000 y... el de 2500 no).
    expect(has(out.bytes, 0xc4)).toBe(true); // 2000
    expect(has(out.bytes, 0xc5)).toBe(false); // 2500
    expect(has(out.bytes, 0xc7)).toBe(false); // 3500
    expect(has(out.bytes, 0xc8)).toBe(true); // 4000
    expect(out.pieces).toHaveLength(2);
    expect(out.pieces[0]).toMatchObject({ src: 0, fromMs: 0, atMs: 0 });
    expect(out.pieces[1].fromMs).toBe(4000);
    expect(out.pieces[1].atMs).toBe(out.pieces[0].toMs);
    expect(readWebmDuration(out.bytes)).toBeCloseTo(out.durationMs, 3);
  });

  it('un tramo arranca en el keyframe siguiente: nunca reaparece lo que se sacó', () => {
    const src = webm({ clusters: 3, step: 2000, marker: 0xc0 });
    const out = composeWebm([{ bytes: src, keep: [[2500, 6000]] }]);
    if (!out.ok) throw new Error(out.error);
    expect(out.pieces[0].fromMs).toBe(4000);
    expect(has(out.bytes, 0xc6)).toBe(false);
    expect(has(out.bytes, 0xc8)).toBe(true);
  });

  it('une dos grabaciones compatibles y rechaza las de otro tamaño', () => {
    const a = webm({ clusters: 2, step: 1000, marker: 0x20 });
    const b = webm({ clusters: 2, step: 1000, marker: 0x60 });
    const out = composeWebm([
      { bytes: a, keep: [[0, 2000]] },
      { bytes: b, keep: [[0, 2000]] },
    ]);
    if (!out.ok) throw new Error(out.error);
    expect(has(out.bytes, 0x20)).toBe(true);
    expect(has(out.bytes, 0x60)).toBe(true);
    expect(out.pieces.map((p) => p.src)).toEqual([0, 1]);
    expect(out.pieces[1].atMs).toBeGreaterThan(1000);
    const other = composeWebm([
      { bytes: a, keep: [[0, 2000]] },
      { bytes: webm({ clusters: 2, step: 1000, marker: 0x60, width: 640 }), keep: [[0, 2000]] },
    ]);
    expect(other).toEqual({ ok: false, error: 'incompatible' });
  });

  it('dice cuando no queda nada o no entiende el archivo', () => {
    const a = webm({ clusters: 2, step: 1000, marker: 0x20 });
    expect(composeWebm([{ bytes: a, keep: [[1500, 1800]] }])).toEqual({ ok: false, error: 'nothing_left' });
    expect(composeWebm([{ bytes: Uint8Array.from([1, 2, 3]), keep: [[0, 1]] }])).toEqual({ ok: false, error: 'unreadable' });
  });
});

describe('lógica pura de la edición', () => {
  const segs = [
    { start: 0, end: 2, text: 'hola a todos' },
    { start: 2, end: 3, text: 'eh, este' },
    { start: 8, end: 10, text: 'seguimos' },
  ];

  it('keepRanges junta cortes y deja lo de afuera', () => {
    expect(keepRanges([[2, 3], [2.5, 4]], 0, 10)).toEqual([[0, 2], [4, 10]]);
    expect(keepRanges([[0, 10]], 0, 10)).toEqual([]);
  });

  it('silencios y muletillas', () => {
    expect(silenceCuts(segs, 14)).toEqual([[3, 8], [10, 14]]);
    expect(silenceCuts(segs, 14, 10)).toEqual([]);
    expect(fillerSegments(segs)).toEqual([1]);
    expect(fillerSegments([{ start: 0, end: 1, text: 'este proyecto anda' }])).toEqual([]);
  });

  it('la transcripción sigue a los tramos: lo sacado no aparece y lo demás se corre', () => {
    const pieces = [
      { src: 0, from: 0, to: 2, at: 0 },
      { src: 0, from: 8, to: 10, at: 2 },
    ];
    expect(remapSegments([segs], pieces)).toEqual([
      { start: 0, end: 2, text: 'hola a todos' },
      { start: 2, end: 4, text: 'seguimos' },
    ]);
    const longer = [
      { src: 0, from: 0, to: 20, at: 0 },
      { src: 0, from: 40, to: 80, at: 20 },
    ];
    const ch = remapChapters([[{ start: 0, title: 'A' }, { start: 30, title: 'Sacado' }, { start: 60, title: 'B' }]], longer);
    expect(ch.map((c) => [c.start, c.title])).toEqual([[0, 'A'], [40, 'B']]);
  });

  it('emails, colores y overlays se limpian', () => {
    expect(cleanEmails(' Ana@X.com, ana@x.com;bad <script>@x.com\nb@y.io')).toEqual(['ana@x.com', 'b@y.io']);
    expect(cleanBrandColor('#E11D48')).toBe('#e11d48');
    expect(cleanBrandColor('red;background:url(x)')).toBeNull();
    expect(brandOnColor('#ffffff')).toBe('#000000');
    expect(brandOnColor('#111111')).toBe('#ffffff');
    const list = cleanOverlays([
      { id: 'a', kind: 'text', start: 1, end: 3, x: 5, y: -1, w: 0.5, text: ' <b>hola</b> ', color: 'url(x)' },
      { kind: 'script', start: 0, end: 1 },
      { kind: 'text', start: 0, end: 1, text: '' },
      { kind: 'box', start: 5, end: 2 },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ x: 1, y: 0, text: '<b>hola</b>', color: '#e11d48' });
    expect(overlaysInTrim(list, 4, null)).toEqual([]);
  });

  it('la página de Docs escapa lo que escribió la gente', () => {
    const blocks = videoDocBlocks(
      { title: 't', description: '<img src=x onerror=alert(1)>' },
      { segments: [{ start: 1, end: 2, text: '<script>x</script>' }], chapters: [], summary: '' },
      'https://z.test/v/abc',
      { watch: 'Ver', summary: 'S', chapters: 'C', transcript: 'T' },
    );
    const all = blocks.map((b) => b.content).join(' ');
    expect(all).not.toContain('<script>');
    expect(all).not.toContain('<img');
    expect(all).toContain('https://z.test/v/abc');
  });
});

// ---------- Base ----------

let uploads = '';
const owner: RecActor = { ws: 'rp-owner', actor: 'rp-owner', admin: true, name: 'Owner' };
const member: RecActor = { ws: 'rp-owner', actor: 'rp-member', admin: false, name: 'Member' };
const outsiderMate: RecActor = { ws: 'rp-owner', actor: 'rp-mate', admin: false, name: 'Mate' };
const stranger: RecActor = { ws: 'rp-stranger', actor: 'rp-stranger', admin: true, name: 'Stranger' };

beforeAll(async () => {
  uploads = await mkdtemp(path.join(os.tmpdir(), 'rec-parity-'));
  vi.stubEnv('UPLOADS_DIR', uploads);
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  for (const id of ['rp-owner', 'rp-member', 'rp-mate', 'rp-stranger']) await upsertUser({ id, email: `${id}@test.local`, name: id });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(uploads, { recursive: true, force: true });
});

async function ready(actor: RecActor, title = 'Demo', extra: { spaceId?: string; space?: 'workspace' } = {}) {
  const v = await createVideo(actor, { title, mode: 'screen', contentType: 'video/webm', ...extra });
  await saveLocalPart(v.id, 'video', 1, Buffer.from('first'));
  const out = await assembleLocal(v.id, 'video', 'video/webm', 1);
  await setVideoFile(v.id, 'video', out.url, { size: out.size });
  await finalizeVideo(actor, v.id, { durationSec: 60 });
  await getDb().prepare("UPDATE rec_videos SET transcript_status = 'none' WHERE id = ?").run(v.id);
  return (await getVideoRow(actor, v.id))!;
}

describe('personas puntuales y pedido de acceso', () => {
  const anon = { ws: null, userId: null };
  const asker = { ws: 'other', userId: 'x', email: 'guest@out.test' };

  it('solo pasan los emails de la lista, el autor y se corta al sacarlos', async () => {
    const v = await ready(owner, 'Puntual');
    await updateVideo(owner, v.id, { privacy: 'people', allowedEmails: ['Guest@out.test'] });
    let row = (await getPublicVideoRow(v.share_id))!;
    expect(row.privacy).toBe('workspace');
    expect(row.people_only).toBe(1);
    expect(publicAccess(row, anon, null)).toBe('signin');
    expect(publicAccess(row, asker, null)).toBe('ok');
    expect(publicAccess(row, { ws: owner.ws, userId: 'rp-member', email: 'rp-member@test.local' }, null)).toBe('forbidden');
    expect(publicAccess(row, { ws: owner.ws, userId: owner.actor }, null)).toBe('ok');
    await updateVideo(owner, v.id, { allowedEmails: [] });
    row = (await getPublicVideoRow(v.share_id))!;
    expect(publicAccess(row, asker, null)).toBe('forbidden');
    expect(toDto(row, owner).privacy).toBe('people');
  });

  it('la lista de emails no le llega a quien no administra, ni a la página pública', async () => {
    const v = await ready(owner, 'Lista', { space: 'workspace' });
    await updateVideo(owner, v.id, { privacy: 'workspace', allowedEmails: ['secret@out.test'] });
    const row = (await getPublicVideoRow(v.share_id))!;
    expect(toDto(row, member).allowedEmails).toEqual([]);
    expect(toDto(row, owner).allowedEmails).toEqual(['secret@out.test']);
    expect(JSON.stringify(toPublicDto(row, false))).not.toContain('secret@out.test');
  });

  it('solo lista: no se puede en un espacio compartido', async () => {
    const v = await ready(owner, 'En workspace', { space: 'workspace' });
    await expect(updateVideo(owner, v.id, { privacy: 'people' })).rejects.toMatchObject({ code: 'people_needs_personal' });
    const p = await ready(owner, 'Personal');
    await updateVideo(owner, p.id, { privacy: 'people' });
    await expect(updateVideo(owner, p.id, { space: 'workspace' })).rejects.toMatchObject({ code: 'people_needs_personal' });
  });

  it('pedir acceso: una fila por persona, aviso una sola vez, aprobar suma el email y rechazar no', async () => {
    const v = await ready(owner, 'Pedido');
    await updateVideo(owner, v.id, { privacy: 'people' });
    const person = { email: 'Ask@out.test', name: 'Ask' };
    expect(await requestAccess(v, person)).toBe('pending');
    expect(await requestAccess(v, person)).toBe('pending');
    const notes = await getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'rec_access' AND source_id = ?").get(owner.actor, v.id);
    expect(Number((notes as { n: number }).n)).toBe(1);
    await expect(listAccessRequests(member, v.id)).rejects.toBeInstanceOf(RecError);
    const [r] = await listAccessRequests(owner, v.id);
    expect(r.email).toBe('ask@out.test');
    const { allowedEmails } = await decideAccessRequest(owner, v.id, r.id, true, 'https://z.test/v/x');
    expect(allowedEmails).toEqual(['ask@out.test']);
    await expect(decideAccessRequest(owner, v.id, r.id, true, 'https://z.test/v/x')).rejects.toMatchObject({ status: 404 });
    expect(await listAccessRequests(owner, v.id)).toEqual([]);

    expect(await requestAccess(v, { email: 'no@out.test', name: '' })).toBe('pending');
    const [d] = await listAccessRequests(owner, v.id);
    expect((await decideAccessRequest(owner, v.id, d.id, false, 'https://z.test/v/x')).allowedEmails).toEqual(['ask@out.test']);
    expect(await requestAccess(v, { email: 'no@out.test', name: '' })).toBe('denied');
  });

  it('pedido de email: frena sin sesión, no saltea la contraseña y no aplica a quien entró', async () => {
    const v = await ready(owner, 'Email');
    await updateVideo(owner, v.id, { requireEmail: true });
    let row = (await getPublicVideoRow(v.share_id))!;
    expect(publicAccess(row, anon, null)).toBe('email');
    expect(publicAccess(row, { ...anon, emailPassed: true }, null)).toBe('ok');
    expect(publicAccess(row, { ws: 'other', userId: 'x' }, null)).toBe('ok');
    await updateVideo(owner, v.id, { password: 'clave-larga' });
    row = (await getPublicVideoRow(v.share_id))!;
    expect(publicAccess(row, { ...anon, emailPassed: true }, null)).toBe('password');
  });

  it('cambiar el link: el viejo no existe y la cookie de email ya no vale', async () => {
    const v = await ready(owner, 'Rotar');
    const before = v.share_id;
    const token = emailGateToken(v);
    const next = await rotateShareId(owner, v.id);
    expect(next.share_id).not.toBe(before);
    expect(await getPublicVideoRow(before)).toBeNull();
    expect(emailGateToken(next)).not.toBe(token);
    await expect(rotateShareId(member, v.id)).rejects.toBeInstanceOf(RecError);
  });
});

describe('archivo y ver más tarde', () => {
  it('archivar saca de las listas y lo deja en Archivo; el link sigue', async () => {
    const v = await ready(owner, 'Para archivar');
    await updateVideo(owner, v.id, { archived: true });
    expect((await listVideos(owner, { kind: 'mine' })).some((x) => x.id === v.id)).toBe(false);
    expect((await listVideos(owner, { kind: 'archived' })).some((x) => x.id === v.id)).toBe(true);
    expect(await getPublicVideoRow(v.share_id)).not.toBeNull();
    await updateVideo(owner, v.id, { archived: false });
    expect((await listVideos(owner, { kind: 'mine' })).some((x) => x.id === v.id)).toBe(true);
  });

  it('el archivo de otro no se ve, y un miembro no puede archivar lo ajeno', async () => {
    const v = await ready(owner, 'Personal archivado');
    await updateVideo(owner, v.id, { archived: true });
    expect((await listVideos(member, { kind: 'archived' })).some((x) => x.id === v.id)).toBe(false);
    await expect(updateVideo(member, v.id, { archived: false })).rejects.toBeInstanceOf(RecError);
  });

  it('ver más tarde: de cada persona, y no sobrevive a perder el acceso', async () => {
    const v = await ready(owner, 'Después', { space: 'workspace' });
    await setWatchLater(member, v.id, true);
    expect((await listVideos(member, { kind: 'later' })).map((x) => x.id)).toContain(v.id);
    expect((await listVideos(owner, { kind: 'later' })).map((x) => x.id)).not.toContain(v.id);
    await updateVideo(owner, v.id, { space: 'personal' });
    expect((await listVideos(member, { kind: 'later' })).map((x) => x.id)).not.toContain(v.id);
    await expect(setWatchLater(member, v.id, true)).rejects.toMatchObject({ status: 404 });
  });
});

describe('espacios con miembros', () => {
  it('solo los miembros y los admins ven el espacio, sus videos y carpetas, en cada camino', async () => {
    const creator = member;
    const s = await createSpace(creator, 'Ventas equipo');
    const v = await ready(creator, 'Video zanahoria', { spaceId: s.id });
    const folder = await createFolder(creator, { name: 'Carpeta zanahoria', space: 'workspace', spaceId: s.id });
    expect(v.space).toBe('workspace');
    expect(v.space_id).toBe(s.id);

    // Fuera del espacio
    expect(await getSpace(outsiderMate, s.id)).toBeNull();
    expect((await listSpaces(outsiderMate)).map((x) => x.id)).not.toContain(s.id);
    expect(await getVideoRow(outsiderMate, v.id)).toBeNull();
    expect(await getFolder(outsiderMate, folder.id)).toBeNull();
    expect((await listFolders(outsiderMate)).map((f) => f.id)).not.toContain(folder.id);
    for (const scope of [{ kind: 'all' }, { kind: 'workspace' }, { kind: 'space', spaceId: s.id }, { kind: 'folder', folderId: folder.id }] as const) {
      expect((await listVideos(outsiderMate, scope)).map((x) => x.id)).not.toContain(v.id);
    }
    expect((await listVideos(outsiderMate, { kind: 'all' }, 'zanahoria')).map((x) => x.id)).not.toContain(v.id);
    expect(await searchRec(outsiderMate, 'zanahoria')).toEqual([]);
    expect(await searchRec(outsiderMate, 'Ventas equipo')).toEqual([]);
    await expect(createVideo(outsiderMate, { title: 'x', mode: 'screen', contentType: 'video/webm', spaceId: s.id })).rejects.toMatchObject({ code: 'invalid_space' });
    await expect(setWatchLater(outsiderMate, v.id, true)).rejects.toMatchObject({ status: 404 });

    // Otro workspace
    expect(await getSpace(stranger, s.id)).toBeNull();
    expect(await getVideoRow(stranger, v.id)).toBeNull();

    // Admin del workspace, sí; el espacio general del workspace no lo muestra.
    expect(await getVideoRow(owner, v.id)).not.toBeNull();
    expect((await listVideos(owner, { kind: 'workspace' })).map((x) => x.id)).not.toContain(v.id);
    expect((await searchRec(owner, 'Ventas equipo')).map((r) => r.kind)).toEqual(['space']);

    // Al sumarlo entra; al sacarlo, se corta.
    await setSpaceMembers(creator, s.id, [creator.actor, outsiderMate.actor], [creator.actor, outsiderMate.actor]);
    expect(await getVideoRow(outsiderMate, v.id)).not.toBeNull();
    expect((await listVideos(outsiderMate, { kind: 'space', spaceId: s.id })).map((x) => x.id)).toContain(v.id);
    await expect(updateVideo(outsiderMate, v.id, { title: 'no' })).rejects.toMatchObject({ status: 403 });
    await expect(setSpaceMembers(outsiderMate, s.id, [], [])).rejects.toMatchObject({ status: 403 });
    await setSpaceMembers(creator, s.id, [], [creator.actor, outsiderMate.actor]);
    expect(await getVideoRow(outsiderMate, v.id)).toBeNull();
    // Quien lo creó no se saca a sí mismo por error.
    expect(await getSpace(creator, s.id)).not.toBeNull();
  });

  it('solo workspace dentro de un espacio: el link respeta a los miembros', async () => {
    const s = await createSpace(owner, 'Cerrado');
    const v = await ready(owner, 'Link', { spaceId: s.id });
    await updateVideo(owner, v.id, { privacy: 'workspace' });
    const row = (await getPublicVideoRow(v.share_id))!;
    expect(publicAccess(row, { ws: owner.ws, userId: 'rp-mate' }, null)).toBe('forbidden');
    expect(publicAccess(row, { ws: owner.ws, userId: 'rp-mate', spaceMember: true }, null)).toBe('ok');
  });

  it('borrar el espacio devuelve los videos a quien los grabó, sin darle acceso a nadie más', async () => {
    const s = await createSpace(member, 'Para borrar');
    const v = await ready(member, 'Queda', { spaceId: s.id });
    await expect(deleteSpace(outsiderMate, s.id)).rejects.toBeInstanceOf(RecError);
    await deleteSpace(member, s.id);
    const row = (await getVideoRow(member, v.id))!;
    expect(row.space).toBe('personal');
    expect(row.space_id).toBeNull();
    expect(await getVideoRow(outsiderMate, v.id)).toBeNull();
  });
});

describe('ajustes del workspace', () => {
  it('solo admins; los defaults valen para lo nuevo y lo viejo no se toca', async () => {
    const old = await ready(owner, 'Viejo');
    expect(old.privacy).toBe('link');
    expect(old.allow_download).toBe(1);
    await expect(updateRecSettings(member, { defaultPrivacy: 'workspace' })).rejects.toMatchObject({ status: 403 });
    await updateRecSettings(owner, { defaultPrivacy: 'workspace', defaultAllowDownload: false });
    const fresh = await ready(owner, 'Nuevo');
    expect(fresh.privacy).toBe('workspace');
    expect(fresh.allow_download).toBe(0);
    expect((await getVideoRow(owner, old.id))!.privacy).toBe('link');
    await updateRecSettings(owner, { defaultPrivacy: 'link', defaultAllowDownload: true });
  });

  it('marca: valida el color y no hay marca sin configurar', async () => {
    expect(await getRecBrand('rp-stranger')).toBeNull();
    await expect(updateRecSettings(owner, { brandColor: 'url(x)' })).rejects.toMatchObject({ code: 'invalid_color' });
    await updateRecSettings(owner, { brandName: 'Acme', brandColor: '#112233' });
    expect(await getRecBrand(owner.ws)).toEqual({ name: 'Acme', color: '#112233', hasLogo: false });
  });
});

describe('retención', () => {
  const ws: RecActor = { ws: 'rp-ret', actor: 'rp-ret', admin: true, name: 'R' };
  beforeAll(async () => {
    await upsertUser({ id: 'rp-ret', email: 'rp-ret@test.local', name: 'R' });
  });

  it('apagada no borra; prendida espera el plazo; después borra solo lo vencido, con tope y sin repetir', async () => {
    const db = getDb();
    const oldV = await ready(ws, 'Vieja');
    const newV = await ready(ws, 'Nueva');
    await db.prepare("UPDATE rec_videos SET created_at = datetime('now', '-400 days') WHERE id = ?").run(oldV.id);

    await applyRetention();
    expect(await getVideoRow(ws, oldV.id)).not.toBeNull();

    expect(await retentionPreview(ws, 365)).toBe(1);
    await expect(retentionPreview(member, 365)).rejects.toBeInstanceOf(RecError);
    await expect(updateRecSettings(ws, { retentionDays: 12 })).rejects.toMatchObject({ code: 'invalid_input' });
    const s = await updateRecSettings(ws, { retentionDays: 365 });
    expect(s.retentionStartsAt).toBeTruthy();
    // Dentro del plazo de aviso no se borra nada.
    await applyRetention();
    expect(await getVideoRow(ws, oldV.id)).not.toBeNull();

    await db.prepare("UPDATE rec_settings SET retention_starts_at = datetime('now', '-1 hour') WHERE workspace_id = ?").run(ws.ws);
    const first = await applyRetention();
    expect(first.deleted).toBe(1);
    expect(await getVideoRow(ws, oldV.id)).toBeNull();
    expect(await getVideoRow(ws, newV.id)).not.toBeNull();
    expect((await getRecSettings(ws.ws)).retentionDeleted).toBe(1);

    // Reclamado: otra corrida en la misma hora no vuelve a mirar este workspace.
    const again = await ready(ws, 'Otra vieja');
    await db.prepare("UPDATE rec_videos SET created_at = datetime('now', '-400 days') WHERE id = ?").run(again.id);
    expect((await applyRetention()).deleted).toBe(0);
    expect(await getVideoRow(ws, again.id)).not.toBeNull();

    // Con presupuesto en cero no hace nada.
    await db.prepare('UPDATE rec_settings SET retention_checked_at = NULL WHERE workspace_id = ?').run(ws.ws);
    expect((await applyRetention({ limit: 0 })).deleted).toBe(0);
    await updateRecSettings(ws, { retentionDays: null });
    expect((await getRecSettings(ws.ws)).retentionStartsAt).toBeNull();
  });
});

describe('traspaso de contenido', () => {
  it('solo admins, a una persona del workspace; pasan videos y carpetas', async () => {
    const v = await ready(outsiderMate, 'De quien se va');
    const f = await createFolder(outsiderMate, { name: 'Suya', space: 'personal' });
    await expect(transferContent(member, outsiderMate.actor, member.actor, [member.actor])).rejects.toMatchObject({ status: 403 });
    await expect(listContentOwners(member)).rejects.toMatchObject({ status: 403 });
    await expect(transferContent(owner, outsiderMate.actor, 'rp-stranger', [member.actor])).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await listContentOwners(owner)).some((o) => o.userId === outsiderMate.actor)).toBe(true);
    const r = await transferContent(owner, outsiderMate.actor, member.actor, [member.actor]);
    expect(r.videos).toBeGreaterThanOrEqual(1);
    expect(r.folders).toBeGreaterThanOrEqual(1);
    expect((await getVideoRow(member, v.id))!.created_by).toBe(member.actor);
    expect(await getFolder(member, f.id)).not.toBeNull();
    expect(await getVideoRow(outsiderMate, v.id)).toBeNull();
  });
});

describe('copias editadas', () => {
  it('sale lista, con transcripción sin IA, sin resumen y con la privacidad de la fuente', async () => {
    const src = await ready(owner, 'Fuente');
    await updateVideo(owner, src.id, { password: 'clave-larga', allowDownload: false, chaptersText: '0:00 Uno\n0:20 Sacado\n0:40 Dos' });
    await getDb()
      .prepare("UPDATE rec_videos SET transcript = ?, transcript_status = 'done', summary = 'habla del secreto' WHERE id = ?")
      .run(JSON.stringify([{ start: 0, end: 5, text: 'queda' }, { start: 20, end: 25, text: 'secreto' }, { start: 40, end: 45, text: 'sigue' }]), src.id);
    const copy = await createVideo(owner, { title: 'Copia', mode: 'screen', contentType: 'video/webm', titleSource: 'user' });
    await saveLocalPart(copy.id, 'video', 1, Buffer.from('x'));
    const out = await assembleLocal(copy.id, 'video', 'video/webm', 1);
    await setVideoFile(copy.id, 'video', out.url, { size: out.size });
    const pieces = [{ src: 0, from: 0, to: 15, at: 0 }, { src: 0, from: 35, to: 60, at: 15 }];
    await expect(finalizeDerived(member, copy.id, { durationSec: 40, sources: [src.id], pieces })).rejects.toBeInstanceOf(RecError);
    const row = await finalizeDerived(owner, copy.id, { durationSec: 40, sources: [src.id], pieces });
    expect(row.status).toBe('ready');
    expect(row.transcript_status).toBe('done');
    expect(row.transcript).not.toContain('secreto');
    expect(JSON.parse(row.transcript).map((s: { start: number }) => s.start)).toEqual([0, 20]);
    expect(row.summary).toBe('');
    expect(row.chapters).not.toContain('Sacado');
    expect(row.password_hash).toBe((await getVideoRow(owner, src.id))!.password_hash);
    expect(row.allow_download).toBe(0);
  });

  it('no se puede armar copia de un video que no administrás', async () => {
    const theirs = await ready(owner, 'Ajeno', { space: 'workspace' });
    const mine = await createVideo(member, { title: 'Mía', mode: 'screen', contentType: 'video/webm' });
    await saveLocalPart(mine.id, 'video', 1, Buffer.from('x'));
    const out = await assembleLocal(mine.id, 'video', 'video/webm', 1);
    await setVideoFile(mine.id, 'video', out.url, { size: out.size });
    await expect(finalizeDerived(member, mine.id, { durationSec: 1, sources: [theirs.id], pieces: [{ src: 0, from: 0, to: 1, at: 0 }] })).rejects.toMatchObject({ status: 403 });
  });
});

describe('overlays', () => {
  it('quien no administra ve solo los de adentro del recorte; el texto queda como texto', async () => {
    const v = await ready(owner, 'Con overlays');
    await updateVideo(owner, v.id, {
      overlays: [
        { id: 'a', kind: 'text', start: 2, end: 4, x: 0, y: 0, w: 0.5, h: 0, text: 'recortado', color: '#e11d48' },
        { id: 'b', kind: 'text', start: 30, end: 40, x: 0, y: 0, w: 0.5, h: 0, text: '<img src=x onerror=alert(1)>', color: '#e11d48' },
      ],
    });
    await getDb().prepare('UPDATE rec_videos SET trim_start = 10 WHERE id = ?').run(v.id);
    const row = (await getPublicVideoRow(v.share_id))!;
    expect(toPublicDto(row, false).overlays.map((o) => o.id)).toEqual(['b']);
    expect(toPublicDto(row, true).overlays).toHaveLength(2);
    expect(toDto(row, owner).overlays).toHaveLength(2);
  });
});

describe('resumen por mail', () => {
  it('tope de direcciones, solo quien administra, y la misma lista no sale dos veces', async () => {
    const v = await ready(owner, 'Recap');
    await expect(sendRecap(member, v.id, ['a@x.io'], 'https://z.test')).rejects.toBeInstanceOf(RecError);
    await expect(sendRecap(owner, v.id, ['nope'], 'https://z.test')).rejects.toMatchObject({ code: 'invalid_input' });
    const many = Array.from({ length: 21 }, (_, i) => `p${i}@x.io`);
    await expect(sendRecap(owner, v.id, many, 'https://z.test')).rejects.toMatchObject({ code: 'too_many_recipients' });
    expect(await sendRecap(owner, v.id, ['a@x.io', 'b@x.io'], 'https://z.test')).toEqual({ sent: 2, duplicate: false });
    expect(await sendRecap(owner, v.id, ['b@x.io', 'A@x.io'], 'https://z.test')).toEqual({ sent: 0, duplicate: true });
    expect(await sendRecap(owner, v.id, ['c@x.io'], 'https://z.test')).toEqual({ sent: 1, duplicate: false });
  });
});

describe('la migración deja los videos como estaban', () => {
  it('los valores por defecto no cambian el acceso de lo que ya existe', async () => {
    const v = await ready(owner, 'Existente');
    const row = (await getPublicVideoRow(v.share_id))!;
    expect(row.people_only).toBe(0);
    expect(row.require_email).toBe(0);
    expect(row.archived_at).toBeNull();
    expect(row.space_id).toBeNull();
    expect(publicAccess(row, { ws: null, userId: null }, null)).toBe('ok');
  });
});
