import { describe, expect, it } from 'vitest';
import { describeApps } from '@/lib/app-access-label';
import { ALWAYS_ON_APPS, APP_SWITCHER_ORDER, appAllowed, hrefAllowed, isAlwaysOnApp } from '@/lib/products';
import { canUseApp } from '@/lib/workspace';

/**
 * Inbox es personal (los mensajes de cada persona): la tiene todo el que
 * entra, en cualquier workspace, aunque su lista de apps no la nombre. No es
 * una app del workspace, así que no se cuenta al describir las apps de alguien.
 */
describe('Inbox, siempre disponible', () => {
  it('es la app personal que no depende de los permisos', () => {
    expect(ALWAYS_ON_APPS).toEqual(['inbox']);
    expect(isAlwaysOnApp('inbox')).toBe(true);
    expect(isAlwaysOnApp('crm')).toBe(false);
  });

  it('un miembro con apps restringidas la ve en el sidebar, el switcher y Cmd+K', () => {
    expect(appAllowed(['crm'], 'inbox')).toBe(true);
    expect(appAllowed([], 'inbox')).toBe(true);
    expect(appAllowed(['crm'], 'docs')).toBe(false);
    expect(appAllowed('*', 'docs')).toBe(true);
    expect(hrefAllowed(['crm'], '/app/inbox/settings')).toBe(true);
    expect(hrefAllowed(['crm'], '/app/docs')).toBe(false);
  });

  it('canUseApp la deja a admins, members y guests, sin importar la lista', () => {
    for (const role of ['admin', 'member', 'guest']) expect(canUseApp({ role, apps: '["crm"]' }, 'inbox')).toBe(true);
    expect(canUseApp({ role: 'member', apps: '["crm"]' }, 'docs')).toBe(false);
  });

  it('no cuenta como app del workspace al describir accesos', () => {
    const workspaceApps = APP_SWITCHER_ORDER.filter((k) => k !== 'inbox');
    expect(describeApps(workspaceApps)).toEqual({ kind: 'all' });
    expect(describeApps(['crm', 'inbox'])).toEqual({ kind: 'list', names: ['CRM'] });
  });
});
