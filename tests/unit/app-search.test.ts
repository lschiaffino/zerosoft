import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { searchApps } from '@/lib/app-search';
import { createBoard } from '@/lib/boards';
import { setBoardAccessMode } from '@/lib/board-access';
import { createIssue, createProject } from '@/lib/track-data';
import { createEventType, getOrCreateCalendarUser } from '@/lib/calendar';
import { createChatWidget } from '@/lib/chat-data';
import { createFlow } from '@/lib/flow';
import { createAgent } from '@/lib/agents';
import { createRobot } from '@/lib/robots';
import { createContact, listContacts, searchAll } from '@/lib/crm';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const searchRoute = await import('@/app/api/search/route');

/**
 * ⌘K en las apps sin búsqueda propia: pizarras, proyectos e issues de Track,
 * tipos de evento, widgets, flows, agentes y robots aparecen por nombre, con
 * el link a su detalle, y nunca los de otro workspace.
 */
async function seed(word: string) {
  const user = await makeUser('appsearch');
  await getOrCreateCalendarUser(user.id);
  const board = await createBoard(user.id, user.id, `Pizarra ${word}`);
  const project = await createProject(user.id, null, { name: `Proyecto ${word}` } as Parameters<typeof createProject>[2]);
  const issue = await createIssue(project.id, user.id, { title: `Issue ${word}` } as Parameters<typeof createIssue>[2]);
  const et = await createEventType(user.id, {
    slug: `s-${crypto.randomUUID().slice(0, 6)}`,
    title: `Llamada ${word}`,
    durationMin: 30,
    active: true,
  } as Parameters<typeof createEventType>[1]);
  const widget = await createChatWidget(user.id, null, { name: `Widget ${word}` } as Parameters<typeof createChatWidget>[2]);
  const flow = await createFlow(user.id, user.id, { name: `Flow ${word}` });
  const agent = await createAgent(user.id, user.id, { name: `Agente ${word}` });
  const robot = await createRobot(user.id, user.id, { name: `Robot ${word}` });
  if (!flow.ok || !robot.ok) throw new Error('seed');
  return { user, board, project, issue, et, widget, flow: flow.flow, agent, robot: robot.robot };
}

describe('búsqueda global en las apps', () => {
  it('encuentra cada tipo por nombre con el href de su detalle', async () => {
    const word = `kiwi${crypto.randomUUID().slice(0, 6)}`;
    const s = await seed(word);
    const items = await searchApps(s.user, word);
    const byGroup = Object.fromEntries(items.map((i) => [i.group, i.href]));
    expect(byGroup).toEqual({
      boards: `/app/board/${s.board.id}`,
      projects: `/app/track/projects/${s.project.id}`,
      issues: `/app/track/issues/${s.issue.id}`,
      eventTypes: `/app/calendar/event-types/${s.et.id}`,
      widgets: `/app/chat/widgets/${s.widget.id}`,
      flows: `/app/flow/${s.flow.id}`,
      agents: `/app/agents/${s.agent.id}`,
      robots: `/app/robots/${s.robot.id}`,
    });
    // El issue también se encuentra por su identificador.
    const byKey = await searchApps(s.user, s.issue.identifier);
    expect(byKey.find((i) => i.group === 'issues')?.id).toBe(s.issue.id);
  });

  it('no mezcla workspaces, escapa comodines y no busca vacío', async () => {
    const word = `mango${crypto.randomUUID().slice(0, 6)}`;
    await seed(word);
    const other = await makeUser('appsearch-other');
    expect(await searchApps(other, word)).toEqual([]);
    const s = await seed(`${word}x`);
    expect(await searchApps(s.user, '%')).toEqual([]);
    expect(await searchApps(s.user, '   ')).toEqual([]);
  });

  it('una pizarra restringida no aparece para un miembro sin acceso', async () => {
    const word = `uva${crypto.randomUUID().slice(0, 6)}`;
    const s = await seed(word);
    const mate = await makeUser('appsearch-mate');
    expect(await setBoardAccessMode(s.user.id, s.board.id, 'restricted')).toBe(true);
    const asMate = { id: s.user.id, actingUser: { id: mate.id }, role: 'member' as const };
    expect((await searchApps(asMate, word)).some((i) => i.group === 'boards')).toBe(false);
    // El resto del workspace sí, y el dueño sigue viendo la pizarra.
    expect((await searchApps(asMate, word)).some((i) => i.group === 'agents')).toBe(true);
    expect((await searchApps(s.user, word)).some((i) => i.group === 'boards')).toBe(true);
  });

  it('un contacto se encuentra por nombre completo, en ⌘K y en la lista', async () => {
    const u = await makeUser('appsearch-crm');
    const last = `Quiroga${crypto.randomUUID().slice(0, 6)}`;
    const c = await createContact(u.id, { firstName: 'Ana María', lastName: last });
    expect((await searchAll(u.id, `María ${last}`)).contacts.map((x) => x.id)).toEqual([c.id]);
    expect((await searchAll(u.id, last)).contacts.map((x) => x.id)).toEqual([c.id]);
    const list = await listContacts(u.id, { q: `Ana María ${last}` } as Parameters<typeof listContacts>[1]);
    expect(list.rows.map((x) => x.id)).toEqual([c.id]);
  });

  it('la ruta /api/search los devuelve junto al resto', async () => {
    const word = `pera${crypto.randomUUID().slice(0, 6)}`;
    const s = await seed(word);
    session.user = s.user;
    const res = await searchRoute.GET(new NextRequest(`http://x/api/search?q=${word}`));
    const data = (await res.json()) as { items: Array<{ group: string; id: string }> };
    expect(data.items.filter((i) => i.group === 'boards').map((i) => i.id)).toEqual([s.board.id]);
    expect(data.items.some((i) => i.group === 'robots' && i.id === s.robot.id)).toBe(true);
  });
});
