import { createHmac } from 'crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import {
  approvePost,
  createPost,
  getPost,
  listAccounts,
  listPosts,
  listSocialPeople,
  rejectPost,
  saveDiscoveredAccounts,
  setAccountMembers,
  setSocialRole,
  credsOf,
  reschedulePost,
  retryTarget,
  registerMedia,
  startOAuth,
  finishOAuth,
  type SocialActor,
} from '@/lib/social';
import { personRemoved } from '@/lib/workspace-lifecycle';
import { setMemberApps } from '@/lib/teams';
import { sniffMediaType } from '@/lib/social-media-sniff';
import { publishDue } from '@/lib/social-cron';
import { countText, validateForNetwork, type MediaItem } from '@/lib/social-networks';
import { backoffMs, bestTimes, isPermanentError, MAX_ATTEMPTS, nextSlots } from '@/lib/social-schedule';
import { verifyMetaChallenge, verifyMetaWebhook, handleMetaWebhook, listInbox, assignInbox } from '@/lib/social-inbox';
import { blueskyFacets, readMedia } from '@/lib/social-providers';
import { canUseTool } from '@/lib/assistant/registry';
import { ALL_TOOLS } from '@/lib/assistant/tools';
import { makeUser } from './helpers';

process.env.SOCIAL_FAKE = '1';

const db = () => getDb();
const img = (over: Partial<MediaItem> = {}): MediaItem => ({ url: '/uploads/social/a-photo.jpg', type: 'image', mime: 'image/jpeg', size: 200_000, name: 'photo.jpg', width: 1080, height: 1080, ...over });
const vid = (over: Partial<MediaItem> = {}): MediaItem => ({ url: '/uploads/social/a-clip.mp4', type: 'video', mime: 'video/mp4', size: 2_000_000, name: 'clip.mp4', width: 1080, height: 1920, duration: 20, ...over });

describe('validación por red', () => {
  it('X cuenta cada link como 23 y corta en 280', () => {
    expect(countText('x', `hola https://example.com/${'a'.repeat(200)}`)).toBe(5 + 23);
    expect(validateForNetwork('x', 'a'.repeat(281)).map((i) => i.code)).toContain('too_long');
    expect(validateForNetwork('x', 'a'.repeat(280))).toEqual([]);
  });

  it('Instagram pide foto o video, JPEG y proporción entre 4:5 y 1,91:1', () => {
    expect(validateForNetwork('instagram', 'solo texto').map((i) => i.code)).toEqual(['media_required']);
    expect(validateForNetwork('instagram', 'x', [img({ mime: 'image/png' })]).map((i) => i.code)).toContain('image_type');
    expect(validateForNetwork('instagram', 'x', [img({ width: 1000, height: 2000 })]).map((i) => i.code)).toContain('aspect_ratio');
    expect(validateForNetwork('instagram', 'x', [img()])).toEqual([]);
  });

  it('TikTok y YouTube piden video; X todavía no acepta video; no se mezclan fotos y video', () => {
    expect(validateForNetwork('tiktok', 'x', [img()]).map((i) => i.code)).toEqual(expect.arrayContaining(['video_required', 'images_not_supported']));
    expect(validateForNetwork('youtube', 'x', [vid()])).toEqual([]);
    expect(validateForNetwork('x', 'x', [vid()]).map((i) => i.code)).toContain('video_not_supported');
    expect(validateForNetwork('facebook', 'x', [img(), vid()]).map((i) => i.code)).toContain('mixed_media');
    expect(validateForNetwork('tiktok', 'x', [vid({ duration: 1 })]).map((i) => i.code)).toContain('video_too_short');
  });

  it('Bluesky cuenta grafemas (300) y fotos de hasta 1 MB; LinkedIn hasta 3000', () => {
    expect(countText('bluesky', '👍🏽'.repeat(300))).toBe(300);
    expect(validateForNetwork('bluesky', 'hola', [img({ size: 2_000_000 })]).map((i) => i.code)).toContain('image_too_large');
    expect(validateForNetwork('linkedin', 'a'.repeat(3001)).map((i) => i.code)).toContain('too_long');
    expect(validateForNetwork('facebook', '').map((i) => i.code)).toContain('empty');
  });

  it('facets de Bluesky: links y hashtags con offsets en bytes', () => {
    const f = blueskyFacets('ñ #lanzamiento https://x.com');
    expect(f.map((x) => x.features[0].$type)).toEqual(['app.bsky.richtext.facet#link', 'app.bsky.richtext.facet#tag']);
    expect(f[1].index.byteStart).toBe(3);
  });
});

describe('tiempos', () => {
  it('backoff crece y los errores permanentes no se reintentan', () => {
    expect([1, 2, 3, 4, 9].map(backoffMs)).toEqual([60_000, 300_000, 900_000, 3_600_000, 3_600_000]);
    expect(isPermanentError('token_expired')).toBe(true);
    expect(isPermanentError('network')).toBe(false);
  });

  it('cola: el próximo horario libre salta los tomados', () => {
    const from = new Date('2026-11-02T08:00:00Z'); // lunes
    const slots = [{ weekday: 1, minute: 9 * 60, tz: 'UTC' }, { weekday: 1, minute: 15 * 60, tz: 'UTC' }];
    expect(nextSlots(slots, from)[0].toISOString()).toBe('2026-11-02T09:00:00.000Z');
    expect(nextSlots(slots, from, [Date.parse('2026-11-02T09:00:00Z')])[0].toISOString()).toBe('2026-11-02T15:00:00.000Z');
    expect(nextSlots([{ weekday: 1, minute: 9 * 60, tz: 'America/Argentina/Buenos_Aires' }], from)[0].toISOString()).toBe('2026-11-02T12:00:00.000Z');
  });

  it('mejores horarios: por defecto (y avisado) con pocos datos; con datos, por interacciones', () => {
    expect(bestTimes([], 'UTC').source).toBe('default');
    const samples = Array.from({ length: 12 }, (_, i) => ({ publishedAt: `2026-10-${String(5 + i).padStart(2, '0')}T${i % 2 ? '18' : '09'}:00:00.000Z`, engagement: i % 2 ? 50 : 5, impressions: 100 }));
    const res = bestTimes(samples, 'UTC');
    expect(res.source).toBe('data');
    expect(res.times[0].hour).toBe(18);
  });
});

describe('webhook de Meta', () => {
  it('verifica la firma con el app secret y el challenge con el verify token', () => {
    const body = '{"object":"page"}';
    const sig = `sha256=${createHmac('sha256', 'secret-x').update(body).digest('hex')}`;
    expect(verifyMetaWebhook(body, sig, 'secret-x')).toBe(true);
    expect(verifyMetaWebhook(body, sig, 'other')).toBe(false);
    expect(verifyMetaWebhook(`${body} `, sig, 'secret-x')).toBe(false);
    expect(verifyMetaWebhook(body, null, 'secret-x')).toBe(false);
    expect(verifyMetaChallenge(new URLSearchParams('hub.mode=subscribe&hub.verify_token=tok&hub.challenge=42'), 'tok')).toBe('42');
    expect(verifyMetaChallenge(new URLSearchParams('hub.mode=subscribe&hub.verify_token=bad&hub.challenge=42'), 'tok')).toBeNull();
    expect(verifyMetaChallenge(new URLSearchParams('hub.mode=subscribe&hub.verify_token=&hub.challenge=42'), '')).toBeNull();
  });
});

describe('Social con datos', () => {
  let owner: SocialActor;
  let member: SocialActor;
  let outsider: SocialActor;
  let fb: string;
  let li: string;

  beforeAll(async () => {
    const o = await makeUser('owner');
    const m = await makeUser('member');
    const x = await makeUser('nosocial');
    const teamId = `t-${o.id}`;
    await db().prepare("INSERT INTO teams (id, name, owner_id) VALUES (?, 'T', ?)").run(teamId, o.id);
    await db().prepare('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)').run(teamId, m.id, 'member', '["social","crm"]');
    await db().prepare('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)').run(teamId, x.id, 'member', '["crm"]');
    owner = { workspaceId: o.id, personId: o.id, role: 'owner' };
    member = { workspaceId: o.id, personId: m.id, role: 'member' };
    outsider = { workspaceId: o.id, personId: x.id, role: 'member' };
    const secret = ['tok', 'live', 'abc123'].join('_');
    [fb, li] = await saveDiscoveredAccounts(o.id, o.id, [
      { network: 'facebook', kind: 'page', externalId: 'p1', name: 'Page', tokens: { accessToken: secret, expiresAt: null } },
      { network: 'linkedin', kind: 'profile', externalId: 'urn:li:person:1', name: 'Me', tokens: { accessToken: `${secret}2`, refreshToken: 'r', expiresAt: null }, meta: { author: 'urn:li:person:1' } },
    ]);
  });

  it('los tokens se guardan cifrados y no salen en los DTO', async () => {
    const row = (await db().prepare('SELECT * FROM social_accounts WHERE id = ?').get(fb)) as Parameters<typeof credsOf>[0];
    expect(String(row.access_token)).toMatch(/^enc:v1:/);
    expect(String(row.access_token)).not.toContain('abc123');
    expect(credsOf(row).accessToken).toBe(['tok', 'live', 'abc123'].join('_'));
    const dto = JSON.stringify(await listAccounts(owner));
    expect(dto).not.toContain('abc123');
    expect(dto).not.toMatch(/access_?token|refresh_?token/i);
  });

  it('un member solo ve y publica en las cuentas que le dieron', async () => {
    expect(await listAccounts(member)).toEqual([]);
    await expect(createPost(member, { text: 'hola', accountIds: [fb], action: 'draft' })).rejects.toMatchObject({ code: 'account_not_allowed' });
    await expect(setAccountMembers(member, fb, [member.personId])).rejects.toMatchObject({ code: 'admin_only' });
    await setAccountMembers(owner, fb, [member.personId, outsider.personId]);
    // Quien no tiene la app no queda con acceso a la cuenta.
    expect((await listAccounts(owner)).find((a) => a.id === fb)?.memberIds).toEqual([member.personId]);
    expect((await listAccounts(member)).map((a) => a.id)).toEqual([fb]);
    const people = await listSocialPeople(owner);
    expect(people.map((p) => p.id)).toContain(member.personId);
    expect(people.map((p) => p.id)).not.toContain(outsider.personId);
    // Una publicación del owner a LinkedIn no la ve el member.
    const other = await createPost(owner, { text: 'solo linkedin', accountIds: [li], action: 'draft' });
    expect((await listPosts(member)).map((p) => p.id)).not.toContain(other.id);
    await expect(getPost(member, other.id)).rejects.toMatchObject({ status: 404 });
  });

  it('el cron publica cada destino una sola vez aunque corra dos veces a la vez', async () => {
    const post = await createPost(owner, { text: 'lanzamiento', accountIds: [fb, li], overrides: { [li]: 'texto para LinkedIn' }, action: 'now' });
    expect(post.status).toBe('scheduled');
    await Promise.all([publishDue(), publishDue(), publishDue()]);
    const after = await getPost(owner, post.id);
    expect(after.status).toBe('published');
    expect(after.targets.every((t) => t.status === 'published' && t.attempts === 1 && t.externalUrl)).toBe(true);
    expect(after.targets.find((t) => t.accountId === li)?.textOverride).toBe('texto para LinkedIn');
  });

  it('reintenta con backoff los errores pasajeros y corta en los permanentes', async () => {
    const flaky = await createPost(owner, { text: 'casi [flaky]', accountIds: [fb], action: 'now' });
    await publishDue();
    let p = await getPost(owner, flaky.id);
    expect(p.targets[0].status).toBe('retry');
    expect(p.targets[0].errorCode).toBe('network');
    expect(new Date(p.targets[0].nextAttemptAt!).getTime()).toBeGreaterThan(Date.now() + 30_000);
    // Todavía no venció: no se toca.
    await publishDue();
    expect((await getPost(owner, flaky.id)).targets[0].attempts).toBe(1);
    await db().prepare("UPDATE social_post_targets SET next_attempt_at = '2000-01-01T00:00:00.000Z' WHERE post_id = ?").run(flaky.id);
    await publishDue();
    p = await getPost(owner, flaky.id);
    expect(p.status).toBe('published');
    expect(p.targets[0].attempts).toBe(2);

    const bad = await createPost(owner, { text: 'no va [fail]', accountIds: [fb], action: 'now' });
    await publishDue();
    p = await getPost(owner, bad.id);
    expect(p.status).toBe('failed');
    expect(p.targets[0]).toMatchObject({ status: 'failed', errorCode: 'invalid_content', attempts: 1 });
    const n = await db().prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'social_failed' AND source_id = ?").get(owner.personId, bad.id);
    expect(Number((n as { n: number }).n)).toBe(1);
    expect(MAX_ATTEMPTS).toBe(5);
  });

  it('aprobaciones: lo de un drafter espera, no se publica y el admin aprueba o rechaza con comentario', async () => {
    await expect(setSocialRole(member, member.personId, 'publisher')).rejects.toMatchObject({ code: 'admin_only' });
    await setSocialRole(owner, member.personId, 'drafter');
    const post = await createPost(member, { text: 'propuesta', accountIds: [fb], action: 'now' });
    expect(post.status).toBe('pending_approval');
    await publishDue();
    expect((await getPost(member, post.id)).status).toBe('pending_approval');
    await expect(approvePost(member, post.id)).rejects.toMatchObject({ code: 'admin_only' });
    await expect(rejectPost(owner, post.id, '  ')).rejects.toMatchObject({ code: 'comment_required' });
    const notified = await db().prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'social_approval' AND source_id = ?").get(owner.personId, post.id);
    expect(Number((notified as { n: number }).n)).toBe(1);

    const approved = await approvePost(owner, post.id, 'dale');
    expect(approved.status).toBe('scheduled');
    await publishDue();
    expect((await getPost(member, post.id)).status).toBe('published');

    const second = await createPost(member, { text: 'otra', accountIds: [fb], action: 'now' });
    const rejected = await rejectPost(owner, second.id, 'Cambiá el tono');
    expect(rejected.status).toBe('rejected');
    expect(rejected.approval?.comment).toBe('Cambiá el tono');
    const toAuthor = await db().prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'social_rejected'").get(member.personId);
    expect(Number((toAuthor as { n: number }).n)).toBe(1);
    await setSocialRole(owner, member.personId, 'publisher');
  });

  it('valida en el servidor y no acepta media de afuera', async () => {
    await expect(createPost(owner, { text: 'x'.repeat(70_000), accountIds: [li], action: 'now' })).rejects.toMatchObject({ code: 'validation' });
    await expect(createPost(owner, { text: 'x', accountIds: [fb], media: [img({ url: 'https://evil.example/a.jpg' })], action: 'draft' })).rejects.toMatchObject({ code: 'invalid_media' });
  });

  it('el webhook de Meta trae comentarios a la bandeja de la cuenta, sin duplicar', async () => {
    const body = { object: 'page', entry: [{ id: 'p1', changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c-1', message: 'hola!', from: { id: 'u9', name: 'Ana' }, post_id: 'p1_1' } }] }] };
    expect(await handleMetaWebhook(body)).toBe(1);
    expect(await handleMetaWebhook(body)).toBe(0);
    const items = await listInbox(member);
    expect(items.some((i) => i.text === 'hola!' && i.account.id === fb)).toBe(true);
  });

  it('herramientas del asistente: Social solo para quien tiene la app, revisar solo admins', () => {
    const social = ALL_TOOLS.filter((t) => t.app === 'social');
    expect(social.map((t) => t.name)).toEqual(expect.arrayContaining(['social_posts', 'propose_social_post', 'propose_social_review']));
    expect(social.every((t) => !canUseTool({ role: 'member', apps: ['crm'] }, t))).toBe(true);
    const review = social.find((t) => t.name === 'propose_social_review')!;
    expect(canUseTool({ role: 'member', apps: ['social'] }, review)).toBe(false);
    expect(canUseTool({ role: 'admin', apps: ['social'] }, review)).toBe(true);
  });
});

describe('Social: quien deja de poder publicar, claims colgados y archivos propios', () => {
  let owner: SocialActor;
  let member: SocialActor;
  let drafter: SocialActor;
  let teamId: string;
  let fb: string;
  let li: string;
  const soon = () => new Date(Date.now() + 120_000).toISOString();
  const due = (postId: string) => db().prepare("UPDATE social_post_targets SET next_attempt_at = '2000-01-01T00:00:00.000Z' WHERE post_id = ?").run(postId);
  const approvalNotes = async (postId: string) =>
    Number(((await db().prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'social_approval' AND source_id = ?").get(owner.personId, postId)) as { n: number }).n);

  beforeAll(async () => {
    const o = await makeUser('owner2');
    const m = await makeUser('member2');
    const d = await makeUser('drafter2');
    teamId = `t-${o.id}`;
    await db().prepare("INSERT INTO teams (id, name, owner_id) VALUES (?, 'T', ?)").run(teamId, o.id);
    for (const u of [m, d]) await db().prepare('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)').run(teamId, u.id, 'member', '["social"]');
    owner = { workspaceId: o.id, personId: o.id, role: 'owner' };
    member = { workspaceId: o.id, personId: m.id, role: 'member' };
    drafter = { workspaceId: o.id, personId: d.id, role: 'member' };
    [fb, li] = await saveDiscoveredAccounts(o.id, o.id, [
      { network: 'facebook', kind: 'page', externalId: 'b1-p', name: 'Page', tokens: { accessToken: 'a', expiresAt: null } },
      { network: 'linkedin', kind: 'profile', externalId: 'urn:li:person:b1', name: 'Me', tokens: { accessToken: 'b', expiresAt: null }, meta: { author: 'urn:li:person:b1' } },
    ]);
    await setAccountMembers(owner, fb, [m.id, d.id]);
    await setAccountMembers(owner, li, [m.id]);
    await setSocialRole(owner, d.id, 'drafter');
  });

  it('B1: al sacar a alguien del workspace, lo que programó vuelve a aprobación (con aviso) y no sale', async () => {
    const p = await createPost(member, { text: 'se va', accountIds: [fb], action: 'schedule', scheduledAt: soon() });
    expect(p.status).toBe('scheduled');
    await db().prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(teamId, member.personId);
    await personRemoved({ ownerId: owner.workspaceId, teamId, userId: member.personId });
    expect((await getPost(owner, p.id)).status).toBe('pending_approval');
    expect(await approvalNotes(p.id)).toBe(1);
    await due(p.id);
    await publishDue();
    expect((await getPost(owner, p.id)).status).toBe('pending_approval');
    // Si un admin la aprueba, responde el admin y sale.
    await approvePost(owner, p.id);
    await due(p.id);
    await publishDue();
    expect((await getPost(owner, p.id)).status).toBe('published');
    await db().prepare('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)').run(teamId, member.personId, 'member', '["social"]');
    await setAccountMembers(owner, fb, [member.personId, drafter.personId]);
  });

  it('B1: perder la cuenta o la app también la vuelve a aprobación; el cron vuelve a mirar antes de publicar', async () => {
    await setAccountMembers(owner, li, [member.personId]);
    const onLi = await createPost(member, { text: 'a linkedin', accountIds: [li], action: 'schedule', scheduledAt: soon() });
    await setAccountMembers(owner, li, []);
    expect((await getPost(owner, onLi.id)).status).toBe('pending_approval');

    const onFb = await createPost(member, { text: 'a facebook', accountIds: [fb], action: 'schedule', scheduledAt: soon() });
    await setMemberApps(teamId, member.personId, ['crm']);
    expect((await getPost(owner, onFb.id)).status).toBe('pending_approval');
    await setMemberApps(teamId, member.personId, ['social']);

    // Guard del cron: el acceso se pierde por fuera de Social (sin hook) y el cron no lo publica.
    const sneaky = await createPost(member, { text: 'por las dudas', accountIds: [fb], action: 'schedule', scheduledAt: soon() });
    await db().prepare('DELETE FROM social_account_members WHERE account_id = ? AND person_id = ?').run(fb, member.personId);
    await due(sneaky.id);
    await publishDue();
    const after = await getPost(owner, sneaky.id);
    expect(after.status).toBe('pending_approval');
    expect(after.targets[0].status).toBe('pending');
    await setAccountMembers(owner, fb, [member.personId, drafter.personId]);
  });

  it('J1: un claim colgado queda en "falló" (unknown_state) y no se vuelve a publicar solo', async () => {
    const p = await createPost(owner, { text: 'colgada', accountIds: [li], action: 'now' });
    await db().prepare("UPDATE social_post_targets SET status = 'publishing', attempts = 1, claimed_until = '2000-01-01T00:00:00.000Z' WHERE post_id = ?").run(p.id);
    await db().prepare("UPDATE social_posts SET status = 'publishing' WHERE id = ?").run(p.id);
    await publishDue();
    await publishDue();
    const after = await getPost(owner, p.id);
    expect(after.status).toBe('failed');
    expect(after.targets[0]).toMatchObject({ status: 'failed', errorCode: 'unknown_state', attempts: 1, externalUrl: null });
  });

  it('J2: si quien necesita aprobación reprograma algo aprobado, vuelve a aprobación', async () => {
    const p = await createPost(drafter, { text: 'para aprobar', accountIds: [fb], action: 'schedule', scheduledAt: soon() });
    await approvePost(owner, p.id);
    expect((await getPost(owner, p.id)).status).toBe('scheduled');
    const moved = await reschedulePost(drafter, p.id, new Date(Date.now() + 7_200_000).toISOString());
    expect(moved.status).toBe('pending_approval');
    expect(moved.approval).toBeNull();
    // Un admin reprogramando lo suyo no pasa por aprobación.
    const mine = await createPost(owner, { text: 'mía', accountIds: [fb], action: 'schedule', scheduledAt: soon() });
    expect((await reschedulePost(owner, mine.id, new Date(Date.now() + 7_200_000).toISOString())).status).toBe('scheduled');
  });

  it('J3: solo archivos subidos por este workspace', async () => {
    const url = `/uploads/social/${crypto.randomUUID()}-a.jpg`;
    await expect(createPost(owner, { text: 'x', accountIds: [fb], media: [img({ url })], action: 'draft' })).rejects.toMatchObject({ code: 'invalid_media' });
    const other = await makeUser('otherws');
    await registerMedia({ workspaceId: other.id, personId: other.id, role: 'owner' }, img({ url }));
    await expect(createPost(owner, { text: 'x', accountIds: [fb], media: [img({ url })], action: 'draft' })).rejects.toMatchObject({ code: 'invalid_media' });
    const mineUrl = `/uploads/social/${crypto.randomUUID()}-b.jpg`;
    await registerMedia(owner, img({ url: mineUrl }));
    expect((await createPost(owner, { text: 'x', accountIds: [fb], media: [img({ url: mineUrl })], action: 'draft' })).media[0].url).toBe(mineUrl);
    await expect(readMedia(img({ url: 'https://evil.public.blob.vercel-storage.com/social/x.jpg' }))).rejects.toMatchObject({ code: 'invalid_media' });
    expect(sniffMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(sniffMediaType(new Uint8Array([0, 0, 0, 0x14, ...[...'ftypqt  '].map((c) => c.charCodeAt(0))]))).toBe('video/quicktime');
    expect(sniffMediaType(new TextEncoder().encode('<html><script>x</script>'))).toBeNull();
  });

  it('m3: asignar solo a quien ve la cuenta; reintentar pide la cuenta', async () => {
    const x = await makeUser('nofb');
    await db().prepare('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)').run(teamId, x.id, 'member', '["social"]');
    await handleMetaWebhook({ object: 'page', entry: [{ id: 'b1-p', changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'b1-c', message: 'hey', from: { id: 'z', name: 'Z' }, post_id: 'b1-p_1' } }] }] });
    const item = (await listInbox(owner)).find((i) => i.text === 'hey')!;
    await expect(assignInbox(owner, item.id, x.id)).rejects.toMatchObject({ code: 'person_not_found' });
    expect((await assignInbox(owner, item.id, member.personId)).assignedTo).toBe(member.personId);

    const p = await createPost(owner, { text: 'falla [fail]', accountIds: [li], action: 'now' });
    await publishDue();
    const tgt = (await getPost(owner, p.id)).targets[0];
    await expect(retryTarget(member, p.id, tgt.id)).rejects.toBeTruthy();
  });

  it('OAuth: un state ajeno no se consume', async () => {
    const url = await startOAuth(owner, 'facebook');
    const state = new URL(url).searchParams.get('state')!;
    await expect(finishOAuth(member, state, 'fake-facebook')).rejects.toMatchObject({ code: 'invalid_state' });
    expect((await finishOAuth(owner, state, 'fake-facebook')).network).toBe('facebook');
    await expect(finishOAuth(owner, state, 'fake-facebook')).rejects.toMatchObject({ code: 'invalid_state' });
  });
});
