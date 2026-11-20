import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { describeApps } from '@/lib/app-access-label';
import { ALWAYS_ON_APPS, APP_SWITCHER_ORDER, PRODUCT_KEYS, appAllowed, appFromPath, hrefAllowed, isAlwaysOnApp } from '@/lib/products';
import { canUseApp, ensureWorkspace, userCanUseApp } from '@/lib/workspace';
import { addMember } from '@/lib/teams';
import { blockedAppsFor, saveWorkspaceAppRule } from '@/lib/workspace-apps';
import { canUseTool } from '@/lib/assistant/registry';
import { homeAppGroups, type SidebarLabels } from '@/components/app/sidebar-nav';
import { makeUser } from './helpers';

/**
 * Inbox se prende, se apaga y se restringe en Ajustes › Workspace › Apps como
 * cualquier app (por defecto, para todos). Sigue sin toggle en Miembros: es
 * personal, y el acceso por persona va por las excepciones del workspace.
 */
const gate = await import('@/app/api/apps/blocked/route');
const rule = (mode: 'all' | 'some' | 'admins' | 'off', people: string[] = [], denied: string[] = []) => ({ mode, people, teams: [], denied });
const labels = new Proxy({} as SidebarLabels, { get: (_t, k) => (typeof k === 'string' ? new Proxy({}, { get: (_x, kk) => String(kk) }) : undefined) });

/** Lo que hace getCurrentUser con una ruta de API: la app de la ruta y si la persona la abre (si no, 403 en /api/apps/blocked). */
const apiOpen = (blocked: string[], role = 'member', path = '/api/inbox/threads') => {
  const app = appFromPath(path)!;
  return userCanUseApp({ role, apps: '*', blockedApps: blocked as never }, app);
};

async function setup(tag: string) {
  const owner = await makeUser(`${tag}o`);
  const team = await ensureWorkspace(owner.id);
  const member = await makeUser(`${tag}m`);
  const other = await makeUser(`${tag}x`);
  const admin = await makeUser(`${tag}a`);
  await addMember(team.id, member.id, 'member');
  await addMember(team.id, other.id, 'member');
  await addMember(team.id, admin.id, 'admin');
  const blocked = (p: { id: string; email: string }, role: string) => blockedAppsFor({ ownerId: owner.id, personId: p.id, role, email: p.email });
  return { owner, member, other, admin, blocked };
}

describe('Inbox, app del workspace', () => {
  it('sigue sin toggle en Miembros (capa de la persona)', () => {
    expect(ALWAYS_ON_APPS).toEqual(['inbox']);
    expect(isAlwaysOnApp('inbox')).toBe(true);
    for (const role of ['admin', 'member', 'guest']) expect(canUseApp({ role, apps: '["crm"]' }, 'inbox')).toBe(true);
    const workspaceApps = APP_SWITCHER_ORDER.filter((k) => k !== 'inbox');
    expect(describeApps(workspaceApps)).toEqual({ kind: 'all' });
  });

  it('por defecto la abren todos: sin reglas no se corta para nadie', async () => {
    const { owner, member, admin, blocked } = await setup('iwa1');
    for (const [p, role] of [[owner, 'owner'], [admin, 'admin'], [member, 'member'], [member, 'guest']] as const) {
      expect(await blocked(p, role)).not.toContain('inbox');
    }
    expect(apiOpen(await blocked(member, 'member'))).toBe(true);
  });

  it('apagada: su API se corta para todos, el owner incluido, y vuelve al prenderla', async () => {
    const { owner, member, blocked } = await setup('iwa2');
    await saveWorkspaceAppRule(owner.id, 'inbox', rule('off'), owner.id);
    expect(await blocked(owner, 'owner')).toContain('inbox');
    expect(apiOpen(await blocked(owner, 'owner'), 'owner')).toBe(false);
    expect(apiOpen(await blocked(member, 'member'), 'member', '/api/inbox/whatsapp')).toBe(false);
    const res = await gate.GET(new NextRequest('http://localhost/api/apps/blocked?app=inbox') as never);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'app_disabled', app: 'inbox' });
    await saveWorkspaceAppRule(owner.id, 'inbox', rule('all'), owner.id);
    expect(await blocked(member, 'member')).not.toContain('inbox');
  });

  it('"solo admins" corta a los members y deja a owner y admins', async () => {
    const { owner, member, admin, blocked } = await setup('iwa3');
    await saveWorkspaceAppRule(owner.id, 'inbox', rule('admins'), owner.id);
    expect(apiOpen(await blocked(member, 'member'))).toBe(false);
    expect(apiOpen(await blocked(admin, 'admin'), 'admin')).toBe(true);
    expect(apiOpen(await blocked(owner, 'owner'), 'owner')).toBe(true);
  });

  it('excepciones por persona: una persona elegida la abre, una excluida no', async () => {
    const { owner, member, other, blocked } = await setup('iwa4');
    await saveWorkspaceAppRule(owner.id, 'inbox', rule('some', [member.id]), owner.id);
    expect(apiOpen(await blocked(member, 'member'))).toBe(true);
    expect(apiOpen(await blocked(other, 'member'))).toBe(false);
    await saveWorkspaceAppRule(owner.id, 'inbox', rule('all', [], [other.id]), owner.id);
    expect(apiOpen(await blocked(member, 'member'))).toBe(true);
    expect(apiOpen(await blocked(other, 'member'))).toBe(false);
  });

  it('cortada, desaparece del switcher, Cmd+K y las herramientas del asistente', () => {
    const user = { role: 'member', apps: '*' as const, blockedApps: ['inbox' as const] };
    const allowed = PRODUCT_KEYS.filter((k) => userCanUseApp(user, k));
    expect(appAllowed(allowed, 'inbox')).toBe(false);
    expect(hrefAllowed(allowed, '/app/inbox/settings')).toBe(false);
    expect(hrefAllowed(allowed, '/app/docs')).toBe(true);
    const hrefs = homeAppGroups(labels, { allowed }).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs.some((h) => h.startsWith('/app/inbox'))).toBe(false);
    expect(canUseTool(user as never, { app: 'inbox' })).toBe(false);
    expect(canUseTool({ role: 'member', apps: '*' } as never, { app: 'inbox' })).toBe(true);
    // Abierta, la lista resuelta la trae aunque la persona tenga apps restringidas en Miembros.
    const restricted = PRODUCT_KEYS.filter((k) => userCanUseApp({ role: 'member', apps: ['crm'] }, k));
    expect(appAllowed(restricted, 'inbox')).toBe(true);
    expect(appAllowed(restricted, 'docs')).toBe(false);
  });
});
