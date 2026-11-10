import { describe, expect, it } from 'vitest';
import { homeAppGroups, buildNav, type SidebarLabels } from '@/components/app/sidebar-nav';
import { appFromPath, userCanUseApp } from '@/lib/workspace';
import { homeCanUse } from '@/lib/home';
import { desktopBadge, disabledAppsFor } from '@/lib/desktop-badge';
import { PRODUCT_KEYS, appAllowed, type ProductKey } from '@/lib/products';
import { makeUser } from './helpers';

/**
 * Una app apagada en Ajustes › Workspace › Apps (blockedApps) desaparece de
 * cada superficie que decide con userCanUseApp: sidebar y switcher, inicio,
 * Cmd+K (allowedApps), rutas, escritorio. La API y el MCP, en app-access.test.ts.
 */
const labels = new Proxy({} as SidebarLabels, { get: (_t, k) => (typeof k === 'string' ? new Proxy({}, { get: (_x, kk) => String(kk) }) : undefined) });
const blockedUser = (blockedApps: ProductKey[], role = 'member') => ({ role, apps: '*' as const, blockedApps });
const openable = (u: ReturnType<typeof blockedUser>) => PRODUCT_KEYS.filter((k) => userCanUseApp(u, k));

describe('app apagada: no aparece en ninguna superficie', () => {
  const u = blockedUser(['notes', 'crm']);

  it('sidebar y switcher del inicio no la listan', () => {
    const allowed = openable(u);
    const hrefs = homeAppGroups(labels, { allowed }).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs.some((h) => h.startsWith('/app/notes'))).toBe(false);
    expect(hrefs.some((h) => h.startsWith('/app/crm'))).toBe(false);
    expect(hrefs.some((h) => h.startsWith('/app/docs'))).toBe(true);
    const nav = JSON.stringify(buildNav('home', '/app', labels, { allowed }));
    expect(nav).not.toContain('"/app/notes');
  });

  it('inicio y Cmd+K (allowedApps) la descartan', () => {
    expect(homeCanUse(u as never, 'crm')).toBe(false);
    expect(homeCanUse(u as never, 'docs')).toBe(true);
    const allowed = openable(u);
    expect(appAllowed(allowed, 'notes')).toBe(false);
    expect(appAllowed(allowed, 'docs')).toBe(true);
  });

  it('las rutas de la app se cortan, los ajustes del workspace no son una app', () => {
    expect(appFromPath('/app/notes/abc')).toBe('notes');
    expect(userCanUseApp(u, appFromPath('/app/notes/abc')!)).toBe(false);
    expect(appFromPath('/app/settings/apps')).toBeNull();
    expect(appFromPath('/app/settings')).toBeNull();
  });

  it('owner y admin llegan siempre a Ajustes > Apps, aunque apaguen todo', () => {
    for (const role of ['owner', 'admin']) {
      const all = blockedUser(
        PRODUCT_KEYS.filter((k) => k !== 'inbox'),
        role,
      );
      expect(appFromPath('/app/settings/apps')).toBeNull();
      expect(userCanUseApp(all, 'inbox')).toBe(true);
    }
  });

  it('el escritorio recibe la lista de apps cortadas para esconder sus menús', async () => {
    const p = await makeUser('offdesk');
    const user = { ...p, role: 'owner', apps: '*', blockedApps: ['voice', 'rec'] } as never;
    expect(disabledAppsFor(user)).toEqual(expect.arrayContaining(['voice', 'rec']));
    expect(disabledAppsFor(user)).not.toContain('docs');
    const badge = await desktopBadge(user, null);
    expect(badge.disabledApps).toEqual(expect.arrayContaining(['voice', 'rec']));
  });
});
