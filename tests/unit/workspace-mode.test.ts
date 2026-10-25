import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appsByCategory,
  featuredApps,
  moreAppsByCategory,
  normalizeWorkspaceMode,
  showTeamUi,
} from '@/lib/workspace-mode';
import { PRODUCT_CATEGORIES, PRODUCT_CONFIG, PRODUCT_KEYS } from '@/lib/products';
import { CATEGORY_PRODUCTS } from '@/components/site/catalog';
import { productFromPath } from '@/lib/product-taxonomy';

/** Modo personal/equipo: qué apps se destacan y qué va a "Más apps". */
describe('workspace-mode', () => {
  it('sin dato el modo es equipo', () => {
    expect(normalizeWorkspaceMode(undefined)).toBe('team');
    expect(normalizeWorkspaceMode(null)).toBe('team');
    expect(normalizeWorkspaceMode('raro')).toBe('team');
    expect(normalizeWorkspaceMode('personal')).toBe('personal');
  });

  it('uso personal destaca Notes, Docs, Cal, Board, Link y Track', () => {
    expect(featuredApps({ mode: 'personal' })).toEqual(['notes', 'docs', 'cal', 'board', 'link', 'track']);
    const more = moreAppsByCategory({ mode: 'personal' }).flatMap((g) => g.apps);
    for (const k of ['chat', 'groups', 'agents', 'robots', 'crm'] as const) expect(more, k).toContain(k);
    expect(showTeamUi('personal')).toBe(false);
  });

  it('equipo muestra todo y deja invitar', () => {
    expect(showTeamUi('team')).toBe(true);
    const featured = featuredApps({ mode: 'team' });
    expect(featured).toContain('crm');
    expect(featured).toContain('chat');
  });

  it('destacadas + más apps = las 12, sin repetir, en cada modo', () => {
    for (const mode of ['personal', 'team'] as const) {
      const all = [...featuredApps({ mode }), ...moreAppsByCategory({ mode }).flatMap((g) => g.apps)];
      expect(new Set(all).size, mode).toBe(all.length);
      expect([...all].sort(), mode).toEqual([...PRODUCT_KEYS].sort());
    }
  });

  it('la app de entrada va primero aunque el modo no la destaque', () => {
    const featured = featuredApps({ mode: 'personal', entryApp: 'crm' });
    expect(featured[0]).toBe('crm');
    expect(moreAppsByCategory({ mode: 'personal', entryApp: 'crm' }).flatMap((g) => g.apps)).not.toContain('crm');
  });

  it('las categorías van en orden y cada una tiene título en en/es/pt', () => {
    expect(appsByCategory().map((g) => g.category)).toEqual(PRODUCT_CATEGORIES.filter((c) => PRODUCT_KEYS.some((k) => PRODUCT_CONFIG[k].category === c)));
    expect(CATEGORY_PRODUCTS.flatMap((g) => g.products).sort()).toEqual([...PRODUCT_KEYS].sort());
    const root = join(__dirname, '..', '..');
    for (const locale of ['en', 'es', 'pt']) {
      const common = JSON.parse(readFileSync(join(root, 'messages', locale, 'common.json'), 'utf8'));
      for (const c of PRODUCT_CATEGORIES) {
        expect(common.categories[c]?.title, `${locale}: categories.${c}.title`).toBeTruthy();
        expect(common.categories[c]?.desc, `${locale}: categories.${c}.desc`).toBeTruthy();
      }
      expect(common.home.suite.audienceTitle, locale).toBeTruthy();
      for (const k of ['greetingMorning', 'homeLead', 'featured', 'more', 'error', 'loading']) {
        expect(common.appHome[k], `${locale}: appHome.${k}`).toBeTruthy();
      }
      for (const k of ['featured', 'moreApps', 'groupApps', 'openApp', 'goHome', 'linkOverview']) {
        expect(common.sidebar[k], `${locale}: sidebar.${k}`).toBeTruthy();
      }
    }
  });

  it('el feedback desde el inicio es de la plataforma, no de Link', () => {
    expect(productFromPath('/es/app')).toBe('platform');
    expect(productFromPath('/es/app/links/overview')).toBe('link');
  });
});
