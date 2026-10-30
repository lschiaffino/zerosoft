import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appProductFromPath,
  buildNav,
  buildNewItems,
  homeAppGroups,
  HOME_APPS_LIMIT,
  settingsNavItem,
  SWITCHER_PRODUCTS,
  type AppProduct,
  type SidebarLabels,
} from '@/components/app/sidebar-nav';
import { pageExists } from './page-exists';

const SWITCHER_ORDER: AppProduct[] = ['link', 'crm', 'shop', 'books', 'forms', 'docs', 'calendar', 'track', 'chat', 'groups', 'social', 'flow', 'notes', 'board', 'design', 'talk', 'people', 'voice', 'rec', 'hiring', 'sign', 'agents', 'robots', 'analytics'];
const PRODUCTS: AppProduct[] = ['home', 'link', 'crm', 'docs', 'calendar', 'track', 'chat', 'flow', 'notes', 'board', 'agents', 'robots', 'groups', 'voice', 'rec', 'talk', 'design', 'shop', 'analytics', 'social', 'hiring', 'people', 'books', 'sign', 'forms'];


/**
 * Navegación izquierda de la app: cada ítem apunta a una página que existe,
 * el menú "+ Nuevo" crea algo de verdad y los íconos no se repiten.
 */

const root = join(__dirname, '..', '..');
const appDir = join(root, 'app', '[locale]');


// Labels de prueba: cada hoja es su propia ruta ("crm.contacts"), así los
// ítems sin label se notan.
function fakeLabels(): SidebarLabels {
  const proxy = (prefix: string): unknown =>
    new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? `${prefix}${key}` : undefined) });
  const nested = ['categories', 'link', 'crm', 'docs', 'calendar', 'track', 'chat', 'flow', 'notes', 'board', 'agents', 'robots', 'groups', 'voice', 'rec', 'talk', 'design', 'shop', 'analytics', 'social', 'hiring', 'people', 'books', 'sign', 'forms', 'notifications'];
  return new Proxy({} as SidebarLabels, {
    get: (_t, key) => (typeof key === 'string' && nested.includes(key) ? proxy(`${key}.`) : String(key)),
  });
}

describe('sidebar de la app', () => {
  const labels = fakeLabels();

  it('detecta el producto por la ruta', () => {
    // /app es el inicio de la plataforma (shell neutro); Link vive en /app/links.
    expect(appProductFromPath('/app')).toBe('home');
    expect(appProductFromPath('/app/links')).toBe('link');
    expect(appProductFromPath('/app/links/overview')).toBe('link');
    // Ajustes de la plataforma: shell neutro, sin app activa.
    expect(appProductFromPath('/app/settings')).toBe('home');
    expect(appProductFromPath('/app/settings/api')).toBe('home');
    expect(appProductFromPath('/app/links/settings')).toBe('link');
    expect(appProductFromPath('/app/calendar/settings')).toBe('calendar');
    expect(appProductFromPath('/app/crm/deals')).toBe('crm');
    expect(appProductFromPath('/app/notes/clip')).toBe('notes');
    expect(appProductFromPath('/app/robots/recorder')).toBe('robots');
    expect(appProductFromPath('/app/groups/inbox/abc')).toBe('groups');
    expect(appProductFromPath('/app/voice')).toBe('voice');
    expect(appProductFromPath('/app/rec/settings')).toBe('rec');
    expect(appProductFromPath('/app/talk')).toBe('talk');
    expect(appProductFromPath('/app/social/posts')).toBe('social');
    expect(appProductFromPath('/app/design/abc')).toBe('design');
    expect(appProductFromPath('/app/analytics/insights')).toBe('analytics');
    expect(appProductFromPath('/app/links/analytics')).toBe('link');
    // El asistente es de la plataforma: shell neutro, nunca el de Link.
    expect(appProductFromPath('/app/assistant')).toBe('home');
  });

  it.each(PRODUCTS)('cada ítem de %s apunta a una página existente', (product) => {
    const items = [...buildNav(product, '/app', labels).flatMap((g) => g.items), ...buildNewItems(product, labels)];
    for (const item of items) {
      expect(pageExists(item.href), `${product}: ${item.href}`).toBe(true);
      expect(item.label, item.href).toBeTruthy();
    }
  });

  it.each(PRODUCTS)('los íconos de %s no se repiten', (product) => {
    // El hueco del árbol (branchOnly) no se ve como ítem: su ícono no cuenta.
    const icons = buildNav(product, '/app', labels).flatMap((g) => g.items.filter((i) => !i.branchOnly).map((i) => i.icon));
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('Docs, Notes y Robots tienen más de un ítem', () => {
    for (const product of ['docs', 'notes', 'robots'] as const) {
      const items = buildNav(product, '/app', labels).flatMap((g) => g.items);
      expect(items.length, product).toBeGreaterThan(1);
    }
    const linkHrefs = buildNav('link', '/app', labels).flatMap((g) => g.items.map((i) => i.href));
    expect(linkHrefs).toContain('/app/links/new');
    // Lote e importar son pestañas de "Nuevo"; dominios, importar y exportar viven en los ajustes de Link.
    expect(linkHrefs).not.toContain('/app/links/bulk');
    expect(linkHrefs).toContain('/app/links/settings');
  });

  it('"+ Nuevo" crea en vez de llevar a la lista', () => {
    for (const product of PRODUCTS) {
      for (const item of buildNewItems(product, labels)) {
        expect(/\/new$|[?&]new=1/.test(item.href), `${product}: ${item.href}`).toBe(true);
      }
    }
    expect(buildNewItems('crm', labels).map((i) => i.href)).toContain('/app/crm/tasks?new=1');
    expect(buildNewItems('docs', labels)[0].href).toBe('/app/docs?new=1');
    expect(buildNewItems('flow', labels)[0].href).toBe('/app/flow?new=1');
    expect(buildNewItems('agents', labels)[0].href).toBe('/app/agents?new=1');
  });

  it('las páginas destino de ?new=1 leen el parámetro', () => {
    const files = [
      'components/crm/TasksView.tsx',
      'components/flow/FlowsHome.tsx',
      'components/agents/AgentsHome.tsx',
      'components/robots/RobotsHome.tsx',
    ];
    for (const f of files) expect(readFileSync(join(root, f), 'utf8'), f).toMatch(/get\('new'\) === '1'/);
    expect(readFileSync(join(appDir, 'app', 'docs', 'page.tsx'), 'utf8')).toMatch(/sp\.new === '1'/);
  });

  it('el switcher sale de PRODUCT_CONFIG: las 24 apps, en el orden de siempre', () => {
    expect(SWITCHER_PRODUCTS.map((p) => p.key)).toEqual(PRODUCTS.filter((p) => p !== 'home').sort((a, b) => SWITCHER_ORDER.indexOf(a) - SWITCHER_ORDER.indexOf(b)));
    expect(SWITCHER_PRODUCTS.find((p) => p.key === 'calendar')).toMatchObject({ line: 'cal', name: 'Cal', href: '/app/calendar' });
    expect(SWITCHER_PRODUCTS[0]).toMatchObject({ key: 'link', href: '/app/links' });
    for (const p of SWITCHER_PRODUCTS) expect(p.href, p.key).not.toBe('/app');
  });

  it('Ajustes globales están en el pie, no dentro de un producto', () => {
    for (const product of PRODUCTS) {
      const hrefs = buildNav(product, '/app/settings', labels).flatMap((g) => g.items.map((i) => i.href));
      expect(hrefs, product).not.toContain('/app/settings');
    }
    const item = settingsNavItem('/app/settings', labels);
    expect(item.href).toBe('/app/settings');
    expect(item.active).toBe(true);
    expect(settingsNavItem('/app/crm', labels).active).toBe(false);
  });

  it('marca un solo ítem activo en subrutas', () => {
    const active = (product: AppProduct, path: string) =>
      buildNav(product, path, labels)
        .flatMap((g) => g.items)
        .filter((i) => i.active)
        .map((i) => i.href);
    expect(active('notes', '/app/notes/clip')).toEqual(['/app/notes/clip']);
    expect(active('robots', '/app/robots/recorder')).toEqual(['/app/robots/recorder']);
    expect(active('groups', '/app/groups/inbox/abc')).toEqual(['/app/groups/inbox']);
    expect(active('groups', '/app/groups/list/abc')).toEqual(['/app/groups/list']);
    expect(active('link', '/app/links/bulk')).toEqual(['/app/links/new']);
    expect(active('link', '/app/links/import')).toEqual(['/app/links/new']);
    expect(active('link', '/app/links/domains')).toEqual(['/app/links/settings']);
    expect(active('link', '/app/links/settings')).toEqual(['/app/links/settings']);
    for (const app of ['docs', 'notes', 'board', 'flow', 'agents', 'robots'] as const) {
      expect(active(app, `/app/${app}/settings`), app).toEqual([`/app/${app}/settings`]);
    }
    expect(active('link', '/app/links/abc123')).toEqual(['/app/links']);
    expect(active('track', '/app/track/teams')).toEqual(['/app/track/teams']);
    expect(active('link', '/app/links/overview')).toEqual(['/app/links/overview']);
    expect(active('link', '/app/links')).toEqual(['/app/links']);
    expect(active('home', '/app')).toEqual(['/app']);
    expect(active('home', '/app/assistant')).toEqual(['/app/assistant']);
  });

  it('Track › Proyectos es una lista real y /app/chat/widgets no da 404', () => {
    const projects = readFileSync(join(appDir, 'app', 'track', 'teams', 'page.tsx'), 'utf8');
    // La página delega en ProjectsPage (compartida con el Resumen), que renderiza la lista.
    expect(projects).toContain('ProjectsPage');
    const shared = readFileSync(join(root, 'components', 'track', 'ProjectsPage.tsx'), 'utf8');
    expect(shared).toContain('ProjectList');
    expect(pageExists('/app/chat/widgets')).toBe(true);
  });

  it('Docs, Board y Track cuelgan su lista del sidebar (un solo hueco por producto)', () => {
    const branches = (product: AppProduct) =>
      buildNav(product, '/app', labels)
        .flatMap((g) => g.items)
        .filter((i) => i.branch)
        .map((i) => i.href);
    expect(branches('docs')).toEqual(['/app/docs']);
    expect(branches('board')).toEqual(['/app/board']);
    expect(branches('track')).toEqual(['/app/track/teams']);
    for (const p of PRODUCTS) expect(branches(p).length, p).toBeLessThanOrEqual(1);
    // Y cada uno monta el componente que llena el hueco.
    const layout = (app: string) => readFileSync(join(appDir, 'app', app, 'layout.tsx'), 'utf8');
    expect(layout('board')).toContain('<BoardBranch />');
    expect(layout('track')).toContain('<TrackBranch />');
  });

  it('los strings nuevos del sidebar existen en en/es/pt', () => {
    for (const locale of ['en', 'es', 'pt']) {
      const common = JSON.parse(readFileSync(join(root, 'messages', locale, 'common.json'), 'utf8'));
      for (const key of ['settings', 'collapse', 'expand', 'menu', 'linkDomains', 'docsTemplates']) {
        expect(common.sidebar[key], `${locale}: sidebar.${key}`).toBeTruthy();
      }
      const docs = JSON.parse(readFileSync(join(root, 'messages', locale, 'docs.json'), 'utf8'));
      expect(docs.trash.empty, `${locale}: docs.trash.empty`).toBeTruthy();
    }
  });
});

describe('base compartida del rediseño', () => {
  it('los strings del shell y de components/ui existen en en/es/pt', () => {
    for (const locale of ['en', 'es', 'pt']) {
      const common = JSON.parse(readFileSync(join(root, 'messages', locale, 'common.json'), 'utf8'));
      for (const key of ['home', 'switchProduct', 'closeMenu']) {
        expect(common.sidebar[key], `${locale}: sidebar.${key}`).toBeTruthy();
      }
      for (const key of ['advanced', 'save', 'saving', 'saved', 'saveError', 'back', 'sections']) {
        expect(common.ui[key], `${locale}: ui.${key}`).toBeTruthy();
      }
      for (const key of ['title', 'lead', 'apps', 'open', 'linkSummary']) {
        expect(common.appHome[key], `${locale}: appHome.${key}`).toBeTruthy();
      }
    }
  });

  it('ui.css no trae sombras decorativas, mayúsculas ni radios de más de 2px', () => {
    const css = readFileSync(join(root, 'styles', 'ui.css'), 'utf8');
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
    expect(css).not.toMatch(/box-shadow:\s*\d+px\s+\d+px/);
    expect(css).not.toMatch(/border-radius:\s*([3-9]|\d{2,})px/);
    expect(css).not.toMatch(/gradient\(/);
  });
});

describe('sidebar del inicio: tus apps y "Más apps"', () => {
  const L = { yourApps: 'Your apps', moreApps: 'More apps' } as unknown as SidebarLabels;
  it('arriba hasta 8 (recientes primero, después las destacadas) y el resto plegado; ninguna se pierde', () => {
    const groups = homeAppGroups(L, { recentApps: ['robots', 'nope'], mode: 'team' });
    expect(groups[0].section).toBe('Your apps');
    expect(groups[0].items.length).toBe(HOME_APPS_LIMIT);
    expect(groups[0].items[0].href).toBe('/app/robots');
    expect(groups[1]).toMatchObject({ section: 'More apps', collapsible: true });
    expect(groups[0].items.length + groups[1].items.length).toBe(SWITCHER_PRODUCTS.length);
  });
  it('respeta el acceso por app y no muestra "Más apps" vacío', () => {
    const groups = homeAppGroups(L, { allowed: ['crm', 'social'] });
    expect(groups.map((g) => g.items.map((i) => i.href))).toEqual([['/app/crm', '/app/social']]);
  });
});
