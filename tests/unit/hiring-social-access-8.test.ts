/**
 * Hiring y Social (todavía Próximamente): sus avisos, emails y eventos de Flow
 * solo llegan a quien hoy tiene la app en el workspace: sigue en el
 * workspace, la app en Miembros y en Apps del workspace. Miradas: otro
 * workspace, quien se fue, miembro sin la app en Miembros, miembro con la app
 * apagada para miembros (simulando que la app ya salió), admin y owner.
 * Datos inventados.
 */
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductKey } from '@/lib/products';
import { getDb } from '@/lib/db';
import { addMember, removeMember, setMemberApps } from '@/lib/teams';
import { saveWorkspaceAppRule } from '@/lib/workspace-apps';
import { ensureWorkspace } from '@/lib/workspace';
import { notifyTeam, personHasHiring } from '@/lib/hiring/events';
import { createJob, ensureSettings, listStages, setTeam, updateJob, updateSettings } from '@/lib/hiring/core';
import { applyPublic, moveApplication } from '@/lib/hiring/candidates';
import { sendFeedbackReminders } from '@/lib/hiring/evaluation';
import { createPost, personHasSocialApp, rejectPost, saveDiscoveredAccounts, setAccountMembers, setSocialRole, type SocialActor } from '@/lib/social';
import { workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

process.env.UPLOADS_DIR = path.join(os.tmpdir(), `zs-hs8-uploads-${process.pid}`);
process.env.RATE_LIMIT_DISABLED = 'true';
process.env.SOCIAL_FAKE = '1';

// Para probar Apps del workspace como el día que Hiring y Social salgan (hoy no se guardan reglas para apps en Próximamente).
const launch = vi.hoisted(() => ({ on: false }));
vi.mock('@/lib/products', async (orig) => {
  const real = await orig<typeof import('@/lib/products')>();
  return { ...real, isComingSoon: (app: ProductKey) => (launch.on && (app === 'hiring' || app === 'social') ? false : real.isComingSoon(app)) };
});
const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string }> }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: async (opts: { to: string }) => {
    mail.sent.push(opts);
    return { ok: true };
  },
}));

afterEach(() => {
  launch.on = false;
  mail.sent = [];
});

const adminsOnly = { mode: 'admins' as const, people: [], teams: [], denied: [] };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const admin = await makeUser(`${label}-admin`);
  await addMember(w.team.id, admin.id, 'admin');
  const leaver = await makeUser(`${label}-leaver`);
  await addMember(w.team.id, leaver.id, 'member');
  await removeMember(w.team.id, leaver.id);
  return { w, ws: w.owner.id, admin, leaver };
}

async function noticesFor(sourceId: string): Promise<string[]> {
  const rows = (await getDb().prepare('SELECT user_id FROM notifications WHERE source_id = ?').all(sourceId)) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id).sort();
}

describe('Hiring: avisos y eventos solo a quien hoy tiene la app', () => {
  it('quien se fue, otro workspace y quien perdió Hiring en Miembros: nada; miembro, admin y owner sí', async () => {
    const s = await setup('hs8-hire');
    const src = `src-${crypto.randomUUID()}`;
    const everyone = [s.w.member.id, s.admin.id, s.ws, s.leaver.id, s.w.stranger.id];
    await notifyTeam(s.ws, everyone, { title: 'Candidate · Stage', href: '/app/hiring', sourceId: src });
    expect(await noticesFor(src)).toEqual([s.w.member.id, s.admin.id, s.ws].sort());
    // Lo mismo decide quién recibe los eventos de Flow.
    expect(await personHasHiring(s.ws, s.leaver.id)).toBeNull();
    expect(await personHasHiring(s.ws, s.w.stranger.id)).toBeNull();
    expect(await personHasHiring(s.ws, s.w.member.id)).toMatchObject({ role: 'member' });

    await setMemberApps(s.w.team.id, s.w.member.id, ['crm']);
    const src2 = `src-${crypto.randomUUID()}`;
    await notifyTeam(s.ws, [s.w.member.id, s.admin.id], { title: 'x', href: '/app/hiring', sourceId: src2 });
    expect(await noticesFor(src2)).toEqual([s.admin.id]);
    expect(await personHasHiring(s.ws, s.w.member.id)).toBeNull();
  });

  it('con Hiring solo para admins en Apps del workspace (cuando salga): el miembro no recibe', async () => {
    const s = await setup('hs8-hire-rule');
    launch.on = true;
    await saveWorkspaceAppRule(s.ws, 'hiring', adminsOnly, s.ws);
    const src = `src-${crypto.randomUUID()}`;
    await notifyTeam(s.ws, [s.w.member.id, s.admin.id, s.ws], { title: 'x', href: '/app/hiring', sourceId: src });
    expect(await noticesFor(src)).toEqual([s.admin.id, s.ws].sort());
  });

  it('recordatorio de feedback: a quien perdió Hiring no le llega ni el aviso ni el email', async () => {
    // El equipo del puesto sale del workspace del owner (el team que arma ensureWorkspace).
    const o = await makeUser('hs8-remind-owner');
    const team = await ensureWorkspace(o.id);
    const people = { admin: await makeUser('hs8-remind-admin'), member: await makeUser('hs8-remind-member'), friend: await makeUser('hs8-remind-friend') };
    await addMember(team.id, people.admin.id, 'admin');
    await addMember(team.id, people.member.id, 'member');
    await addMember(team.id, people.friend.id, 'member');
    const s = { ws: o.id, admin: people.admin, w: { team, member: people.member, friend: people.friend } };
    const owner = { ws: s.ws, person: s.ws, admin: true };
    const settings = await ensureSettings(s.ws);
    await updateSettings(owner, { published: true });
    const detail = await createJob(owner, { title: `Engineer ${crypto.randomUUID().slice(0, 6)}`, description: 'Role', questions: [] });
    await setTeam(owner, detail.job.id, [
      { userId: s.admin.id, role: 'recruiter' },
      { userId: s.w.member.id, role: 'interviewer' },
      { userId: s.w.friend.id, role: 'interviewer' },
    ]);
    await updateJob(owner, detail.job.id, { status: 'published' });
    const { applicationId } = await applyPublic(
      settings.handle,
      detail.job.slug,
      { name: 'Test Candidate', email: `cand-${crypto.randomUUID().slice(0, 8)}@example.com`, phone: '', linkedin: '', answers: {}, consent: true, keepConsent: false, utm: {}, referrer: '', source: null },
      { bytes: PDF, filename: 'cv.pdf' },
    );
    const notices = async (userId: string) =>
      Number(((await getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'hiring_activity' AND source_id = ?").get(userId, applicationId)) as { n: number }).n);
    // Con Hiring, el equipo del puesto sí recibe: el recruiter al postularse y el interviewer al pasar a entrevista.
    expect(await notices(s.admin.id)).toBeGreaterThan(0);
    const interview = (await listStages(detail.job.id)).find((st) => st.kind === 'interview')!;
    await moveApplication(owner, applicationId, interview.id);
    expect(await notices(s.w.member.id)).toBeGreaterThan(0);
    await setMemberApps(s.w.team.id, s.w.friend.id, ['crm']);
    await sendFeedbackReminders(new Date(Date.now() + 2 * 86_400_000));
    const reminded = (await getDb().prepare("SELECT user_id FROM notifications WHERE source_id = ? AND body = 'scorecard'").all(applicationId)) as Array<{ user_id: string }>;
    expect(reminded.map((r) => r.user_id)).toContain(s.w.member.id);
    expect(reminded.map((r) => r.user_id)).not.toContain(s.w.friend.id);
    expect(mail.sent.some((m) => m.to === s.w.member.email)).toBe(true);
    expect(mail.sent.some((m) => m.to === s.w.friend.email)).toBe(false);
  });
});

describe('Social: avisos de publicaciones solo a quien hoy tiene la app', () => {
  it('aprobaciones: un admin sin Social en Miembros no recibe; el autor que perdió Social tampoco', async () => {
    const s = await setup('hs8-social');
    const admin2 = await makeUser('hs8-social-admin2');
    await addMember(s.w.team.id, admin2.id, 'admin');
    await setMemberApps(s.w.team.id, admin2.id, ['crm']);
    const owner: SocialActor = { workspaceId: s.ws, personId: s.ws, role: 'owner' };
    const member: SocialActor = { workspaceId: s.ws, personId: s.w.member.id, role: 'member' };
    const [fb] = await saveDiscoveredAccounts(s.ws, s.ws, [{ network: 'facebook', kind: 'page', externalId: `p-${crypto.randomUUID()}`, name: 'Page', tokens: { accessToken: 'tok', expiresAt: null } }]);
    await setAccountMembers(owner, fb, [member.personId]);
    await setSocialRole(owner, member.personId, 'drafter');
    const post = await createPost(member, { text: 'draft for review', accountIds: [fb], action: 'now' });
    expect(post.status).toBe('pending_approval');
    const approvals = (await getDb().prepare("SELECT user_id FROM notifications WHERE type = 'social_approval' AND source_id = ?").all(post.id)) as Array<{ user_id: string }>;
    expect(approvals.map((r) => r.user_id).sort()).toEqual([s.ws, s.admin.id].sort());

    await setMemberApps(s.w.team.id, s.w.member.id, ['crm']);
    await rejectPost(owner, post.id, 'Not now');
    const toAuthor = (await getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'social_rejected' AND source_id = ?").get(post.id)) as { n: number };
    expect(Number(toAuthor.n)).toBe(0);
  });

  it('quien se fue y otro workspace no tienen Social; con Social solo para admins (cuando salga), el miembro tampoco', async () => {
    const s = await setup('hs8-social-rule');
    expect(await personHasSocialApp(s.ws, s.leaver.id)).toBe(false);
    expect(await personHasSocialApp(s.ws, s.w.stranger.id)).toBe(false);
    expect(await personHasSocialApp(s.ws, s.w.member.id)).toBe(true);
    launch.on = true;
    await saveWorkspaceAppRule(s.ws, 'social', adminsOnly, s.ws);
    expect(await personHasSocialApp(s.ws, s.w.member.id)).toBe(false);
    expect(await personHasSocialApp(s.ws, s.admin.id)).toBe(true);
    expect(await personHasSocialApp(s.ws, s.ws)).toBe(true);
  });
});
