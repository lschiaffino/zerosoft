import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appProductFromPath,
  buildNav,
  buildNewItems,
  settingsNavItem,
  type AppProduct,
  type SidebarLabels,
} from '@/components/app/sidebar-nav';

/**
 * Navegación izquierda de la app: cada ítem apunta a una página que existe,
 * el menú "+ Nuevo" crea algo de verdad y los íconos no se repiten.
 */

const root = join(__dirname, '..', '..');
const appDir = join(root, 'app', '[locale]');

const PRODUCTS: AppProduct[] = ['link', 'crm', 'docs', 'calendar', 'track', 'chat', 'flow', 'notes', 'board', 'agents', 'robots'];

// Labels de prueba: cada hoja es su propia ruta ("crm.contacts"), así los
// ítems sin label se notan.
function fakeLabels(): SidebarLabels {
  const proxy = (prefix: string): unknown =>
    new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? `${prefix}${key}` : undefined) });
  const nested = ['link', 'crm', 'docs', 'calendar', 'track', 'chat', 'flow', 'notes', 'board', 'agents', 'robots', 'notifications'];
  return new Proxy({} as SidebarLabels, {
    get: (_t, key) => (typeof key === 'string' && nested.includes(key) ? proxy(`${key}.`) : String(key)),
  });
}

function pageExists(href: string): boolean {
  const path = href.split(/[?#]/)[0].replace(/^\//, '');
  return existsSync(join(appDir, path, 'page.tsx'));
}

describe('sidebar de la app', () => {
  const labels = fakeLabels();

  it('detecta el producto por la ruta', () => {
    expect(appProductFromPath('/app')).toBe('link');
    expect(appProductFromPath('/app/settings')).toBe('link');
    expect(appProductFromPath('/app/crm/deals')).toBe('crm');
    expect(appProductFromPath('/app/notes/clip')).toBe('notes');
    expect(appProductFromPath('/app/robots/recorder')).toBe('robots');
  });

  it.each(PRODUCTS)('cada ítem de %s apunta a una página existente', (product) => {
    const items = [...buildNav(product, '/app', labels).flatMap((g) => g.items), ...buildNewItems(product, labels)];
    for (const item of items) {
      expect(pageExists(item.href), `${product}: ${item.href}`).toBe(true);
      expect(item.label, item.href).toBeTruthy();
    }
  });

  it.each(PRODUCTS)('los íconos de %s no se repiten', (product) => {
    const icons = buildNav(product, '/app', labels).flatMap((g) => g.items.map((i) => i.icon));
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('Docs, Notes y Robots tienen más de un ítem', () => {
    for (const product of ['docs', 'notes', 'robots'] as const) {
      const items = buildNav(product, '/app', labels).flatMap((g) => g.items);
      expect(items.length, product).toBeGreaterThan(1);
    }
    const linkHrefs = buildNav('link', '/app', labels).flatMap((g) => g.items.map((i) => i.href));
    expect(linkHrefs).toContain('/app/links/bulk');
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
    expect(active('link', '/app/links/bulk')).toEqual(['/app/links/bulk']);
    expect(active('track', '/app/track/projects')).toEqual(['/app/track/projects']);
  });

  it('Track › Proyectos es una lista real y /app/chat/widgets no da 404', () => {
    const projects = readFileSync(join(appDir, 'app', 'track', 'projects', 'page.tsx'), 'utf8');
    // La página delega en ProjectsPage (compartida con el Resumen), que renderiza la lista.
    expect(projects).toContain('ProjectsPage');
    const shared = readFileSync(join(root, 'components', 'track', 'ProjectsPage.tsx'), 'utf8');
    expect(shared).toContain('ProjectList');
    expect(pageExists('/app/chat/widgets')).toBe(true);
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
      for (const key of ['title', 'lead', 'mapTitle', 'lines', 'open', 'linkSummary']) {
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
