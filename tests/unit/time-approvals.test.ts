import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { nextSheetStatus, sheetLocked } from '@/lib/time/types';
import { createEntry, createProject, deleteEntry, ensureDefaultTasks, listTasks, updateEntry } from '@/lib/time/core';
import { actOnSheet, countPendingSheets, listSheets, sheetOf } from '@/lib/time/approvals';
import { timeActorOf } from '@/lib/time/http';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

describe('Time: aprobación, reglas puras', () => {
  it('traba la semana pendiente o aprobada', () => {
    expect(sheetLocked('submitted')).toBe(true);
    expect(sheetLocked('approved')).toBe(true);
    expect(sheetLocked('returned')).toBe(false);
    expect(sheetLocked('open')).toBe(false);
    expect(sheetLocked(null)).toBe(false);
  });

  it('cada acción sale de ciertos estados y es de quien corresponde', () => {
    const me = { admin: false, own: true };
    const admin = { admin: true, own: false };
    expect(nextSheetStatus('submit', 'open', me)).toBe('submitted');
    expect(nextSheetStatus('submit', 'returned', me)).toBe('submitted');
    expect(nextSheetStatus('submit', 'submitted', me)).toBe('bad_state');
    expect(nextSheetStatus('withdraw', 'submitted', me)).toBe('open');
    expect(nextSheetStatus('withdraw', 'approved', me)).toBe('bad_state');
    expect(nextSheetStatus('approve', 'submitted', me)).toBe('forbidden');
    expect(nextSheetStatus('approve', 'submitted', admin)).toBe('approved');
    expect(nextSheetStatus('return', 'submitted', admin)).toBe('returned');
    expect(nextSheetStatus('reopen', 'approved', admin)).toBe('returned');
    expect(nextSheetStatus('reopen', 'submitted', admin)).toBe('bad_state');
    // Ni quien administra envía la semana de otra persona.
    expect(nextSheetStatus('submit', 'open', admin)).toBe('forbidden');
  });
});

describe('Time: aprobación con datos', () => {
  async function setup(label: string) {
    const w = await workspaceWithMember(label);
    const owner = timeActorOf(asOwner(w.owner));
    const member = timeActorOf(asMember(w.owner, w.member));
    const friend = timeActorOf(asMember(w.owner, w.friend));
    const stranger = timeActorOf(asOwner(w.stranger));
    await ensureDefaultTasks(owner.ws, 'en');
    const tasks = await listTasks(owner);
    const project = await createProject(owner, { name: 'Web' });
    return { w, owner, member, friend, stranger, tasks, project };
  }

  it('enviar traba la semana; retirarla la destraba', async () => {
    const { member, tasks, project } = await setup('time-sheet-lock');
    const e = await createEntry(member, { date: '2026-11-10', projectId: project.id, taskId: tasks[0].id, minutes: 60 });
    // Una semana sin horas no se envía.
    await expect(actOnSheet(member, { action: 'submit', week: '2026-11-02' })).rejects.toMatchObject({ code: 'empty_week' });
    const sent = await actOnSheet(member, { action: 'submit', week: '2026-11-12' });
    expect(sent).toMatchObject({ week: '2026-11-09', status: 'submitted' });
    await expect(createEntry(member, { date: '2026-11-15', projectId: project.id, taskId: tasks[0].id, minutes: 5 })).rejects.toMatchObject({ code: 'locked' });
    await expect(updateEntry(member, e.id, { minutes: 5 })).rejects.toMatchObject({ code: 'locked' });
    await expect(deleteEntry(member, e.id)).rejects.toMatchObject({ code: 'locked' });
    // Tampoco se mete una entrada de otra semana en la trabada.
    const other = await createEntry(member, { date: '2026-11-17', projectId: project.id, taskId: tasks[0].id, minutes: 5 });
    await expect(updateEntry(member, other.id, { date: '2026-11-11' })).rejects.toMatchObject({ code: 'locked' });
    await expect(actOnSheet(member, { action: 'submit', week: '2026-11-09' })).rejects.toMatchObject({ code: 'bad_state' });
    expect((await actOnSheet(member, { action: 'withdraw', week: '2026-11-09' })).status).toBe('open');
    expect((await updateEntry(member, e.id, { minutes: 30 })).minutes).toBe(30);
  });

  it('no se envía con un cronómetro corriendo en la semana', async () => {
    const { member, tasks, project } = await setup('time-sheet-timer');
    const e = await createEntry(member, { date: '2026-11-10', projectId: project.id, taskId: tasks[0].id, start: true });
    await expect(actOnSheet(member, { action: 'submit', week: '2026-11-10' })).rejects.toMatchObject({ code: 'timer_running' });
    await updateEntry(member, e.id, { running: false });
    expect((await actOnSheet(member, { action: 'submit', week: '2026-11-10' })).status).toBe('submitted');
  });

  it('quien administra aprueba, devuelve con nota y reabre; el miembro no', async () => {
    const { owner, member, friend, tasks, project } = await setup('time-sheet-admin');
    const e = await createEntry(member, { date: '2026-11-10', projectId: project.id, taskId: tasks[0].id, minutes: 60 });
    await actOnSheet(member, { action: 'submit', week: '2026-11-09' });
    expect(await countPendingSheets(owner)).toBe(1);
    expect(await countPendingSheets(member)).toBe(0);
    await expect(actOnSheet(friend, { action: 'approve', week: '2026-11-09', personId: member.person })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(actOnSheet(member, { action: 'approve', week: '2026-11-09' })).rejects.toMatchObject({ code: 'forbidden' });

    const returned = await actOnSheet(owner, { action: 'return', week: '2026-11-09', personId: member.person, note: '  Falta el viernes  ' });
    expect(returned).toMatchObject({ status: 'returned', note: 'Falta el viernes' });
    expect(returned.decidedByName).toBeTruthy();
    // Devuelta se edita y se vuelve a enviar, sin la nota vieja.
    await updateEntry(member, e.id, { minutes: 90 });
    expect(await actOnSheet(member, { action: 'submit', week: '2026-11-09' })).toMatchObject({ status: 'submitted', note: '' });
    expect((await actOnSheet(owner, { action: 'approve', week: '2026-11-09', personId: member.person })).status).toBe('approved');
    await expect(actOnSheet(member, { action: 'withdraw', week: '2026-11-09' })).rejects.toMatchObject({ code: 'bad_state' });
    await expect(updateEntry(member, e.id, { minutes: 5 })).rejects.toMatchObject({ code: 'locked' });
    expect((await actOnSheet(owner, { action: 'reopen', week: '2026-11-09', personId: member.person })).status).toBe('returned');
    expect((await updateEntry(member, e.id, { minutes: 5 })).minutes).toBe(5);

    // Un aviso para quien administra al enviar y otro para la persona al decidir.
    const kinds = (await getDb().prepare("SELECT user_id FROM notifications WHERE type = 'time_approval' AND source_id = ?").all(`${member.person}:2026-11-09`)) as Array<{ user_id: string }>;
    expect(kinds.some((n) => n.user_id === owner.person)).toBe(true);
    expect(kinds.some((n) => n.user_id === member.person)).toBe(true);
  });

  it('la lista: el admin ve las del equipo con horas; el miembro, solo las suyas', async () => {
    const { owner, member, friend, tasks, project } = await setup('time-sheet-list');
    await createEntry(member, { date: '2026-11-10', projectId: project.id, taskId: tasks[0].id, minutes: 60 });
    await createEntry(member, { date: '2026-11-11', projectId: project.id, taskId: tasks[0].id, minutes: 30 });
    await createEntry(friend, { date: '2026-11-10', projectId: project.id, taskId: tasks[0].id, minutes: 15 });
    await actOnSheet(member, { action: 'submit', week: '2026-11-09' });
    await actOnSheet(friend, { action: 'submit', week: '2026-11-09' });
    const all = await listSheets(owner, { status: 'submitted' });
    expect(all.map((s) => [s.personId, s.minutes]).sort()).toEqual([
      [friend.person, 15],
      [member.person, 90],
    ].sort());
    expect((await listSheets(member)).map((s) => s.personId)).toEqual([member.person]);
    expect(await listSheets(owner, { status: 'approved' })).toHaveLength(0);
  });

  it('nada se filtra entre workspaces', async () => {
    const { member, stranger, tasks, project } = await setup('time-sheet-ws');
    await createEntry(member, { date: '2026-11-10', projectId: project.id, taskId: tasks[0].id, minutes: 60 });
    await actOnSheet(member, { action: 'submit', week: '2026-11-09' });
    expect(await listSheets(stranger)).toHaveLength(0);
    expect(await countPendingSheets(stranger)).toBe(0);
    await expect(actOnSheet(stranger, { action: 'approve', week: '2026-11-09', personId: member.person })).rejects.toMatchObject({ code: 'not_found' });
    expect((await sheetOf(member.ws, member.person, '2026-11-09')).status).toBe('submitted');
  });

  it('las rutas por rol', async () => {
    const { w, member, tasks, project } = await setup('time-sheet-routes');
    await createEntry(member, { date: '2026-11-10', projectId: project.id, taskId: tasks[0].id, minutes: 60 });
    const route = await import('@/app/api/time/approvals/route');
    const entries = await import('@/app/api/time/entries/route');
    const post = (body: unknown) => route.POST(new NextRequest('http://x/api/time/approvals', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
    const get = (q: string) => route.GET(new NextRequest(`http://x/api/time/approvals${q}`));

    session.user = null;
    expect((await get('')).status).toBe(401);
    expect((await post({ action: 'submit', week: '2026-11-09' })).status).toBe(401);

    session.user = asMember(w.owner, w.member);
    expect((await post({ action: 'nope', week: '2026-11-09' })).status).toBe(400);
    expect((await post({ action: 'submit', week: '2026-11-09' })).status).toBe(200);
    const week = (await (await entries.GET(new NextRequest('http://x/api/time/entries?from=2026-11-09&to=2026-11-15'))).json()) as { sheet: { status: string } };
    expect(week.sheet.status).toBe('submitted');
    // Un miembro no mira el detalle de otra persona.
    session.user = asMember(w.owner, w.friend);
    expect((await get(`?person=${member.person}&week=2026-11-09`)).status).toBe(403);
    expect((await post({ action: 'approve', week: '2026-11-09', personId: member.person })).status).toBe(403);

    session.user = asOwner(w.stranger);
    expect(((await (await get('')).json()) as { sheets: unknown[] }).sheets).toHaveLength(0);
    expect((await post({ action: 'approve', week: '2026-11-09', personId: member.person })).status).toBe(404);

    session.user = asOwner(w.owner);
    const detail = (await (await get(`?person=${member.person}&week=2026-11-12`)).json()) as { entries: Array<{ minutes: number }> };
    expect(detail.entries.map((e) => e.minutes)).toEqual([60]);
    expect((await post({ action: 'approve', week: '2026-11-09', personId: member.person })).status).toBe(200);
    session.user = null;
  });
});
