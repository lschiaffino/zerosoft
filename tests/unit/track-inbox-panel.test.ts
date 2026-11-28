import { afterEach, describe, expect, it, vi } from 'vitest';
import { addMember, createTeam } from '@/lib/teams';
import { createPlan } from '@/lib/track-plans';
import { createInitiative } from '@/lib/track-initiatives';
import { initiativeCreateSchema, planCreateSchema } from '@/lib/track-planning-schema';
import { createProject } from '@/lib/track-data';
import { setGuest } from '@/lib/track-access';
import { inboxListHref, inboxPanelHref, inboxPanelOpen, inboxPanelTarget } from '@/lib/track-inbox-panel';
import { inboxEntityFor } from '@/lib/track-inbox-panel-server';
import { runAsTrackViewer } from '@/lib/track-access';
import { makeUser } from './helpers';

afterEach(() => vi.restoreAllMocks());

describe('Track: qué abre un aviso en el panel de la bandeja', () => {
  it('issue, project (con su pestaña) e iniciativa (con su ancla); lo demás va a su página', () => {
    expect(inboxPanelTarget({ issue: { id: 'i1' }, href: '/app/track/issues/i1' })).toEqual({ kind: 'issue', id: 'i1' });
    expect(inboxPanelTarget({ href: '/app/track/projects/p1?tab=updates' })).toEqual({ kind: 'project', id: 'p1', tab: 'updates', hash: undefined });
    expect(inboxPanelTarget({ href: '/es/app/track/projects/p2#comments' })).toEqual({ kind: 'project', id: 'p2', tab: null, hash: '#comments' });
    expect(inboxPanelTarget({ href: '/app/track/initiatives/n1#updates' })).toEqual({ kind: 'initiative', id: 'n1', tab: null, hash: '#updates' });
    expect(inboxPanelTarget({ href: '/app/track/projects/new' })).toBeNull();
    expect(inboxPanelTarget({ href: '/app/track/triage?team=WEB' })).toBeNull();
    expect(inboxPanelTarget({ href: null })).toBeNull();
    // Solo cuenta la ruta: un href con otro host abre igual el panel interno (nunca navega afuera).
    expect(inboxPanelTarget({ href: 'https://evil.example/app/track/projects/p1' })).toEqual({ kind: 'project', id: 'p1', tab: null, hash: undefined });
    // El recordatorio de update pide el composer; un tramo de más (link viejo de un team) va a su página.
    expect(inboxPanelTarget({ href: '/app/track/projects/p1?tab=updates&new=1' })).toEqual({ kind: 'project', id: 'p1', tab: 'updates', compose: true, hash: undefined });
    expect(inboxPanelTarget({ href: '/app/track/projects/team1/settings' })).toBeNull();
    // Un link roto no rompe la lista.
    expect(inboxPanelTarget({ href: '/app/track/projects/%E0%A4%A' })).toBeNull();
    expect(inboxPanelOpen('/app/track/inbox/%E0%A4%A')).toEqual({ kind: 'issue', id: '' });
  });

  it('rutas del panel, la ruta abierta y la vuelta a la lista', () => {
    const sp = new URLSearchParams({ tab: 'other', n: 'note1' });
    expect(inboxPanelHref({ kind: 'issue', id: 'i 1' }, sp)).toBe('/app/track/inbox/i%201?tab=other&n=note1');
    expect(inboxPanelHref({ kind: 'project', id: 'p1', tab: 'updates', hash: '#comments' }, sp)).toBe(
      '/app/track/inbox/project/p1?tab=other&n=note1&ptab=updates&pat=comments',
    );
    expect(inboxPanelHref({ kind: 'initiative', id: 'n1' }, new URLSearchParams())).toBe('/app/track/inbox/initiative/n1');
    expect(inboxPanelHref({ kind: 'project', id: 'p1', tab: 'updates', compose: true }, new URLSearchParams({ n: 'x' }))).toBe(
      '/app/track/inbox/project/p1?n=x&ptab=updates&pnew=1',
    );
    expect(inboxPanelOpen('/en/app/track/inbox/project/p1')).toEqual({ kind: 'project', id: 'p1' });
    expect(inboxPanelOpen('/app/track/inbox/initiative/n1')).toEqual({ kind: 'initiative', id: 'n1' });
    expect(inboxPanelOpen('/app/track/inbox/abc')).toEqual({ kind: 'issue', id: 'abc' });
    expect(inboxPanelOpen('/app/track/inbox')).toBeNull();
    expect(inboxListHref('?tab=other&n=x&ptab=updates&pnew=1&pat=comments&kind=mention')).toBe('/app/track/inbox?tab=other&kind=mention');
    expect(inboxListHref('')).toBe('/app/track/inbox');
  });

  it('acceso a los paneles de project e iniciativa: otro workspace, invitado, miembro y owner', async () => {
    const owner = await makeUser('ip-own');
    const member = await makeUser('ip-mem');
    const guest = await makeUser('ip-gst');
    const stranger = await makeUser('ip-str');
    const team = await createTeam(owner.id, 'Acme');
    await addMember(team.id, member.id);
    await addMember(team.id, guest.id);
    const web = await createProject(owner.id, team.id, { name: 'Web', slug: `ip-${crypto.randomUUID().slice(0, 6)}` });
    await setGuest(team.id, guest.email, [web.id], owner.id);
    const scope = { teamId: team.id, ownerId: owner.id };
    const created = await createPlan(scope, owner.id, planCreateSchema.parse({ name: 'Launch' }));
    if (!created.ok) throw new Error(created.error);
    const plan = created.plan;
    const initiative = await createInitiative(scope, owner.id, initiativeCreateSchema.parse({ name: 'Growth' }));
    const open = (user: { id: string; team?: { id: string } | null }, viewer: string) => ({
      project: () => runAsTrackViewer(viewer, () => inboxEntityFor('project', plan.id, user), 'app'),
      initiative: () => runAsTrackViewer(viewer, () => inboxEntityFor('initiative', initiative.id, user), 'app'),
    });
    // Anónimo: las rutas del panel piden sesión (requireUser) antes de llegar acá; sin workspace no hay nada.
    // Otro workspace e invitado (la planificación no es de su alcance): no se abre.
    const strangerSees = open({ id: stranger.id, team: null }, stranger.id);
    expect(await strangerSees.project()).toBeUndefined();
    expect(await strangerSees.initiative()).toBeUndefined();
    const guestSees = open({ id: owner.id, team }, guest.id);
    expect(await guestSees.project()).toBeUndefined();
    expect(await guestSees.initiative()).toBeUndefined();
    // Miembro y owner: sí.
    for (const viewer of [member.id, owner.id]) {
      const sees = open({ id: owner.id, team }, viewer);
      expect((await sees.project())?.id).toBe(plan.id);
      expect((await sees.initiative())?.id).toBe(initiative.id);
    }
    // Un id inventado responde igual que uno ajeno.
    expect(await runAsTrackViewer(owner.id, () => inboxEntityFor('project', crypto.randomUUID(), { id: owner.id, team }), 'app')).toBeUndefined();
  });
});
