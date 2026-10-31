import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => ({ headers: new Map<string, string>(), signedIn: false }));

vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => request.headers.get(name.toLowerCase()) ?? null }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('@/lib/session', async (original) => ({
  ...(await original<typeof import('@/lib/session')>()),
  getCurrentUser: async () => (request.signedIn ? { id: 'someone' } : null),
}));

import { getDb } from '@/lib/db';
import { recipientLocale } from '@/lib/notification-copy';
import { ensurePeople, peopleContext, syncMembers } from '@/lib/people';
import { addMember, createTeam } from '@/lib/teams';
import { ensureWorkspace } from '@/lib/workspace';
import { makeUser } from './helpers';

const db = () => getDb();

beforeEach(() => {
  request.headers.clear();
  request.signedIn = false;
});

async function workspaceWithoutLocale() {
  const owner = await makeUser();
  const staff = await makeUser();
  const team = await createTeam(owner.id, 'Equipo');
  await addMember(team.id, staff.id, 'member');
  await db().prepare('UPDATE users SET locale = NULL WHERE id IN (?, ?)').run(owner.id, staff.id);
  return { owner, staff, team };
}

describe('idioma de los avisos del equipo', () => {
  it('un checkout público en pt-BR no decide el idioma de quien lo recibe', async () => {
    const { owner } = await workspaceWithoutLocale();
    request.headers.set('accept-language', 'pt-BR,pt;q=0.9');
    request.headers.set('referer', 'https://acme.example/store/acme/checkout');
    request.headers.set('x-zs-return-path', '/pt/store/acme');
    expect(await recipientLocale(owner.id)).toBe('en');
  });

  it('un webhook, sin página de origen, tampoco', async () => {
    const { owner } = await workspaceWithoutLocale();
    request.headers.set('accept-language', 'pt');
    request.signedIn = true;
    expect(await recipientLocale(owner.id)).toBe('en');
  });

  it('un Referer de la app sin sesión no alcanza', async () => {
    const { owner } = await workspaceWithoutLocale();
    request.headers.set('referer', 'https://zerosoft.ai/pt/app/shop');
    expect(await recipientLocale(owner.id)).toBe('en');
  });

  it('alguien con sesión dentro de la app sigue valiendo, a falta de otro dato', async () => {
    const { owner } = await workspaceWithoutLocale();
    request.headers.set('referer', 'https://zerosoft.ai/es/app/shop/orders');
    request.signedIn = true;
    expect(await recipientLocale(owner.id)).toBe('es');
  });

  it('orden: la persona, quien creó el workspace y después otro miembro', async () => {
    const { owner, staff, team } = await workspaceWithoutLocale();
    const other = await makeUser();
    await addMember(team.id, other.id, 'member');
    await db().prepare("UPDATE users SET locale = 'pt' WHERE id = ?").run(other.id);
    expect(await recipientLocale(owner.id)).toBe('pt');
    await db().prepare("UPDATE users SET locale = 'es' WHERE id = ?").run(owner.id);
    expect(await recipientLocale(staff.id)).toBe('es');
    await db().prepare("UPDATE users SET locale = 'en' WHERE id = ?").run(staff.id);
    expect(await recipientLocale(staff.id)).toBe('en');
  });
});

describe('guarda de People', () => {
  const count = async (ws: string) => ((await db().prepare('SELECT COUNT(*) AS n FROM people_employees WHERE workspace_id = ?').get(ws)) as { n: number }).n;

  it('la siembra de la primera vez crea la ficha de quien ya está', async () => {
    const owner = await makeUser();
    await ensurePeople(owner.id);
    expect(await count(owner.id)).toBeGreaterThanOrEqual(1);
  });

  it('leer el contexto no crea fichas: avisa con needsSync y el alta es explícita', async () => {
    const owner = await makeUser();
    const staff = await makeUser();
    await addMember((await ensureWorkspace(owner.id)).id, staff.id, 'member');
    await ensurePeople(owner.id);
    const before = await count(owner.id);
    await db().prepare('DELETE FROM people_employees WHERE workspace_id = ? AND user_id = ?').run(owner.id, staff.id);
    const ctx = await peopleContext(owner.id, owner.id, 'owner');
    expect(ctx.needsSync).toBe(true);
    expect(await count(owner.id)).toBe(before - 1);
    await syncMembers(owner.id);
    expect(await count(owner.id)).toBe(before);
    expect((await peopleContext(owner.id, owner.id, 'owner')).needsSync).toBe(false);
  });
});
