import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { getDb, upsertUser } from '@/lib/db';
import {
  canCommentAs,
  createVideo,
  finalizeVideo,
  getAnalytics,
  getPublicVideoRow,
  getVideoRow,
  publicAccess,
  rotateShareId,
  setVideoFile,
  strictestAccess,
  toDto,
  trackRecView,
  unlockToken,
  updateVideo,
  type PublicViewer,
  type RecActor,
} from '@/lib/rec';
import { decideAccessRequest, getRecSettings, listAccessRequests, updateRecSettings } from '@/lib/rec-admin';
import { assembleLocal, saveLocalPart } from '@/lib/rec-upload';
import { recMoveNotice, roleFor } from '@/lib/rec-schema';
import {
  addPeople,
  askForLink,
  consumeMagicToken,
  createMagicToken,
  inviteByEmail,
  inviteCookieValue,
  listPeople,
  magicEmail,
  readInviteCookie,
  removePerson,
  setPersonRole,
} from '@/lib/rec-share';

let uploads = '';
let mailFile = '';
const owner: RecActor = { ws: 'rs-owner', actor: 'rs-owner', admin: true, name: 'Owner Persona' };
const mate: RecActor = { ws: 'rs-owner', actor: 'rs-mate', admin: false, name: 'Mate' };
const anon: PublicViewer = { ws: null, userId: null };
const LINK = { base: 'https://z.test', locale: 'en' };

beforeAll(async () => {
  uploads = await mkdtemp(path.join(os.tmpdir(), 'rec-sharing-'));
  mailFile = path.join(uploads, 'mail.jsonl');
  vi.stubEnv('UPLOADS_DIR', uploads);
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('EMAIL_CAPTURE_FILE', mailFile);
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  for (const id of ['rs-owner', 'rs-mate']) await upsertUser({ id, email: `${id}@test.local`, name: id });
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
  return (await getVideoRow(actor, v.id))!;
}

async function mails(): Promise<Array<{ to: string; subject: string; text: string }>> {
  const raw = await readFile(mailFile, 'utf8').catch(() => '');
  return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const tokenIn = (text: string) => /[?&]invite=([\w-]+)/.exec(text)?.[1] ?? null;

describe('lo nuevo nace restringido', () => {
  it('sin ajustes: restringido; el ajuste del workspace manda; en un lugar compartido, la gente de ese lugar', async () => {
    expect((await getRecSettings('rs-nobody')).defaultPrivacy).toBe('people');
    const v = await ready(owner, 'Nuevo');
    expect(toDto(v, owner).privacy).toBe('people');
    expect(publicAccess(v, anon, null)).toBe('signin');
    expect(publicAccess(v, { ws: owner.ws, userId: mate.actor }, null)).toBe('forbidden');
    expect(publicAccess(v, { ws: owner.ws, userId: owner.actor }, null)).toBe('ok');

    const shared = await ready(owner, 'Compartido', { space: 'workspace' });
    expect(toDto(shared, owner).privacy).toBe('workspace');
    expect(publicAccess(shared, { ws: owner.ws, userId: mate.actor }, null)).toBe('ok');

    await updateRecSettings(owner, { defaultPrivacy: 'link' });
    const open = await ready(owner, 'Abierto');
    expect(publicAccess(open, anon, null)).toBe('ok');
    await updateRecSettings(owner, { defaultPrivacy: 'people' });
  });

  it('mover un restringido a un lugar compartido lo abre a ese lugar y conserva a las personas', async () => {
    expect(recMoveNotice({ spaceId: null, privacy: 'people' }, { space: 'workspace', folderId: null })).toBe('becomes_shared');
    const v = await ready(owner, 'Mover');
    await addPeople(owner, v.id, ['afuera@out.test'], 'viewer');
    await updateVideo(owner, v.id, { space: 'workspace' });
    const row = (await getPublicVideoRow(v.share_id))!;
    expect([row.privacy, row.people_only]).toEqual(['workspace', 0]);
    expect(publicAccess(row, { ws: owner.ws, userId: mate.actor }, null)).toBe('ok');
    expect(publicAccess(row, { ws: 'x', userId: 'x', email: 'afuera@out.test' }, null)).toBe('ok');
  });
});

describe('personas con rol', () => {
  it('suma, cambia rol y saca; el lector no comenta, el comentador sí', async () => {
    const v = await ready(owner, 'Roles');
    const { added } = await addPeople(owner, v.id, ['Lee@Out.test, com@out.test'], 'viewer');
    expect(added).toEqual(['lee@out.test', 'com@out.test']);
    await setPersonRole(owner, v.id, 'com@out.test', 'commenter');
    let row = (await getPublicVideoRow(v.share_id))!;
    const lee: PublicViewer = { ws: 'other', userId: 'u1', email: 'lee@out.test' };
    const com: PublicViewer = { ws: null, userId: null, inviteEmail: 'com@out.test' };
    expect(publicAccess(row, lee, null)).toBe('ok');
    expect(publicAccess(row, com, null)).toBe('ok');
    expect(canCommentAs(row, lee)).toBe(false);
    expect(canCommentAs(row, com)).toBe(true);
    // Sin comentarios para nadie: tampoco el comentador; quien grabó sí.
    await updateVideo(owner, v.id, { allowComments: false });
    row = (await getPublicVideoRow(v.share_id))!;
    expect(canCommentAs(row, com)).toBe(false);
    expect(canCommentAs(row, { ws: owner.ws, userId: owner.actor })).toBe(true);
    // Solo quien administra cambia la lista.
    await expect(addPeople(mate, v.id, ['x@out.test'], 'viewer')).rejects.toMatchObject({ status: 404 });
    // Emails inválidos o de más: no entra nada.
    await expect(addPeople(owner, v.id, ['no-es-email'], 'viewer')).rejects.toMatchObject({ code: 'invalid_email' });
    await expect(addPeople(owner, v.id, Array.from({ length: 101 }, (_, i) => `p${i}@out.test`), 'viewer')).rejects.toMatchObject({ code: 'allowed_full' });

    await removePerson(owner, v.id, 'lee@out.test');
    row = (await getPublicVideoRow(v.share_id))!;
    expect(publicAccess(row, lee, null)).toBe('forbidden');
    expect(JSON.parse(row.people_roles)).toEqual({ 'com@out.test': 'commenter' });
    expect(toDto(row, owner).peopleRoles).toEqual({ 'com@out.test': 'commenter' });
    expect(toDto(row, mate).peopleRoles).toEqual({});
  });

  it('una copia armada de varios videos se queda con el rol más chico', () => {
    const base = { privacy: 'workspace' as const, people_only: 1, password_hash: null, expires_at: null, allow_download: 1, require_email: 0, comments_require_account: 0, space_id: null };
    const a = { ...base, allowed_emails: '["x@x.io","y@x.io"]', people_roles: '{"x@x.io":"viewer"}' };
    const b = { ...base, allowed_emails: '["x@x.io","y@x.io"]', people_roles: '{}' };
    expect(JSON.parse(strictestAccess([a, b]).people_roles)).toEqual({ 'x@x.io': 'viewer', 'y@x.io': 'commenter' });
  });

  it('listas de antes de los roles: comentador', () => {
    expect(roleFor({}, 'a@x.io')).toBe('commenter');
    expect(roleFor({ 'a@x.io': 'viewer' }, 'A@x.io')).toBe('viewer');
  });

  it('la contraseña y el vencimiento son del link: no frenan a las personas invitadas', async () => {
    const v = await ready(owner, 'Link');
    await updateVideo(owner, v.id, { privacy: 'link', password: 'clave-larga', expiresAt: new Date(Date.now() - 1000).toISOString() });
    await addPeople(owner, v.id, ['inv@out.test'], 'viewer');
    const row = (await getPublicVideoRow(v.share_id))!;
    expect(publicAccess(row, anon, unlockToken(row))).toBe('expired');
    expect(publicAccess(row, { ws: null, userId: null, inviteEmail: 'inv@out.test' }, null)).toBe('ok');
  });

  it('restringido y vencido: a quien no tiene acceso no se le dice que venció', async () => {
    const v = await ready(owner, 'Restringido vencido');
    await updateVideo(owner, v.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const row = (await getPublicVideoRow(v.share_id))!;
    expect(publicAccess(row, anon, null)).toBe('signin');
  });
});

describe('link mágico', () => {
  it('cookie firmada: atada al link y al email, vence y no se falsifica', () => {
    const val = inviteCookieValue('share-aaaa', 'a@x.io', 1_000_000);
    expect(readInviteCookie('share-aaaa', val, 1_000_000)).toBe('a@x.io');
    expect(readInviteCookie('share-bbbb', val, 1_000_000)).toBeNull();
    expect(readInviteCookie('share-aaaa', val, 1_000_000 + 31 * 86400_000)).toBeNull();
    const [, exp, sig] = val.split('.');
    expect(readInviteCookie('share-aaaa', `${Buffer.from('b@x.io').toString('base64url')}.${exp}.${sig}`, 1_000_000)).toBeNull();
    expect(readInviteCookie('share-aaaa', 'basura', 1_000_000)).toBeNull();
  });

  it('un solo uso, solo para quien sigue en la lista, y cambiar el link lo corta', async () => {
    const v = await ready(owner, 'Magia');
    await addPeople(owner, v.id, ['ext@out.test'], 'viewer');
    let row = (await getPublicVideoRow(v.share_id))!;
    const token = await createMagicToken(v.id, 'ext@out.test');
    const other = await ready(owner, 'Otro');
    expect(await consumeMagicToken(other, token)).toBeNull();
    expect(await consumeMagicToken(row, token)).toBe('ext@out.test');
    expect(await consumeMagicToken(row, token)).toBeNull();
    // Dos clics a la vez: uno solo gana.
    const t2 = await createMagicToken(v.id, 'ext@out.test');
    const both = await Promise.all([consumeMagicToken(row, t2), consumeMagicToken(row, t2)]);
    expect(both.filter(Boolean)).toHaveLength(1);
    // Sacado de la lista: el link sin usar ya no sirve.
    const t3 = await createMagicToken(v.id, 'ext@out.test');
    await removePerson(owner, v.id, 'ext@out.test');
    row = (await getPublicVideoRow(v.share_id))!;
    expect(await consumeMagicToken(row, t3)).toBeNull();
    // Cookie vieja después de cambiar el link: no vale.
    await addPeople(owner, v.id, ['ext@out.test'], 'viewer');
    const cookie = inviteCookieValue(row.share_id, 'ext@out.test');
    const rotated = await rotateShareId(owner, v.id);
    expect(readInviteCookie(rotated.share_id, cookie)).toBeNull();
  });

  it('invitar manda mail: a un miembro con quién y qué; a alguien de afuera, texto fijo', async () => {
    const v = await ready(owner, 'Título <secreto>');
    const { added, video } = await addPeople(owner, v.id, ['rs-mate@test.local', 'fuera@out.test'], 'commenter');
    const before = (await mails()).length;
    const sent = await inviteByEmail(owner, video, added, { ...LINK, members: [{ id: 'rs-mate', email: 'rs-mate@test.local', name: 'Mate' }] });
    expect(sent).toBe(2);
    const out = (await mails()).slice(before);
    const toMate = out.find((m) => m.to === 'rs-mate@test.local')!;
    const toOut = out.find((m) => m.to === 'fuera@out.test')!;
    expect(toMate.subject).toContain('Título <secreto>');
    expect(toOut.subject).not.toContain('secreto');
    expect(toOut.text).not.toContain('secreto');
    expect(toOut.text).not.toContain('Owner Persona');
    expect(tokenIn(toOut.text)).toBeTruthy();
    const row = (await getPublicVideoRow(v.share_id))!;
    expect(await consumeMagicToken(row, tokenIn(toOut.text)!)).toBe('fuera@out.test');
    const n = await getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'rs-mate' AND source_id = ?").get(v.id);
    expect(Number((n as { n: number }).n)).toBe(1);
  });

  it('el html del mail escapa todo', () => {
    const m = magicEmail('invite', 'https://z.test/en/v/x?invite=abc"<', 'en', { who: '<b>x</b>', title: '<script>t</script>' });
    expect(m.html).not.toContain('<b>x</b>');
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('"<');
  });

  it('pedir link: invitado recibe uno nuevo; desconocido queda como pedido; aprobar manda link', async () => {
    const v = await ready(owner, 'Pedir');
    await addPeople(owner, v.id, ['ya@out.test'], 'viewer');
    let row = (await getPublicVideoRow(v.share_id))!;
    const before = (await mails()).length;
    await askForLink(row, 'YA@out.test', '', LINK);
    await askForLink(row, 'nuevo@out.test', 'Nuevo', LINK);
    const out = (await mails()).slice(before);
    expect(out.map((m) => m.to)).toEqual(['ya@out.test']);
    const reqs = await listAccessRequests(owner, v.id);
    expect(reqs.map((r) => r.email)).toEqual(['nuevo@out.test']);
    await expect(askForLink(row, 'mal', '', LINK)).rejects.toMatchObject({ code: 'invalid_email' });

    await decideAccessRequest(owner, v.id, reqs[0].id, true, LINK);
    const approved = (await mails()).slice(before + 1);
    expect(approved.map((m) => m.to)).toEqual(['nuevo@out.test']);
    row = (await getPublicVideoRow(v.share_id))!;
    expect(await consumeMagicToken(row, tokenIn(approved[0].text)!)).toBe('nuevo@out.test');
  });
});

describe('quién miró', () => {
  it('la lista dice quién miró y la analítica muestra su email', async () => {
    const v = await ready(owner, 'Vistas');
    await addPeople(owner, v.id, ['mira@out.test', 'nomira@out.test'], 'viewer');
    const row = (await getPublicVideoRow(v.share_id))!;
    await trackRecView(row, { key: 'i:mira@out.test', userId: null, name: 'mira@out.test', isAuthor: false }, { duration: 60, position: 10 });
    const people = await listPeople(owner, v.id, []);
    expect(people.find((p) => p.email === 'mira@out.test')!.viewedAt).toBeTruthy();
    expect(people.find((p) => p.email === 'nomira@out.test')!.viewedAt).toBeNull();
    const stats = await getAnalytics(owner, v.id);
    expect(stats.viewers.map((x) => x.email)).toContain('mira@out.test');
    await expect(listPeople(mate, v.id, [])).rejects.toMatchObject({ status: 404 });
  });
});
