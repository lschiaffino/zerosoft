import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  activeRouteTab,
  DESKTOP_NATIVE_SECTIONS,
  groupState,
  matchesSettingsQuery,
  settingsSectionHref,
  legacySettingsTarget,
  quotaPct,
  SETTINGS_ELSEWHERE,
  settingsSections,
  toggleGroup,
  webhookEventGroups,
} from '@/lib/settings-nav';
import { PRODUCT_KEYS } from '@/lib/products';
import { isSettingsRoute, isSettingsEmbed } from '@/lib/settings-embed';
import { WEBHOOK_EVENTS } from '@/lib/webhooks-events';
import { pageExists } from './page-exists';

const root = join(__dirname, '..', '..');

describe('settings: secciones de la plataforma', () => {
  const account = (admin: boolean) => settingsSections(admin).flatMap((g) => (g.key === 'products' ? [] : g.items));

  it('cuatro grupos: Cuenta, Workspace (Admin solo para ADMIN_EMAILS), Este dispositivo y Productos', () => {
    expect(settingsSections(false).map((g) => g.key)).toEqual(['account', 'workspace', 'device', 'products']);
    expect(account(false).map((t) => t.key)).toEqual([
      'profile',
      'appearance',
      'notifications',
      'workspace',
      'members',
      'teams',
      'billing',
      'api',
      'connections',
      'import',
      'security',
      'offline',
      'desktop',
    ]);
    expect(settingsSections(true)[1].items.map((t) => t.key).at(-1)).toBe('admin');
    expect(settingsSectionHref('desktop')).toBe('/app/settings/desktop');
  });

  it('en la ventana del escritorio, Este dispositivo va primero con las secciones nativas y Sin conexión', () => {
    const groups = settingsSections(false, { desktop: true });
    expect(groups.map((g) => g.key)).toEqual(['device', 'account', 'workspace', 'products']);
    expect(groups[0].items.map((i) => i.native ?? i.key)).toEqual([...DESKTOP_NATIVE_SECTIONS, 'offline']);
    expect(groups[0].items[0].href).toBe('/app/settings/desktop/start');
    // La app intercepta esas rutas: son rutas de ajustes (y la página existe para el navegador).
    for (const i of groups[0].items) expect(isSettingsRoute(i.href), i.href).toBe(true);
  });

  it('las secciones nativas son las mismas en la web, en la ventana del escritorio y en Rust', () => {
    const ts = readFileSync(join(root, 'desktop', 'ui', 'settings.ts'), 'utf8');
    const tabs = /const TABS = \[([^\]]+)\] as const/.exec(ts)?.[1].match(/'([a-z]+)'/g)?.map((x) => x.slice(1, -1));
    expect(tabs).toEqual([...DESKTOP_NATIVE_SECTIONS]);
    const rs = readFileSync(join(root, 'desktop', 'src-tauri', 'src', 'nav.rs'), 'utf8');
    const native = /NATIVE_SECTIONS: \[&str; \d+\] = \[([^\]]+)\]/.exec(rs)?.[1].match(/"([a-z]+)"/g)?.map((x) => x.slice(1, -1));
    expect(native).toEqual([...DESKTOP_NATIVE_SECTIONS]);
    // Cada sección nativa tiene su nombre en la web (nav embebida) y en el escritorio.
    const desktop = JSON.parse(readFileSync(join(root, 'desktop', 'strings.json'), 'utf8'));
    for (const locale of ['en', 'es', 'pt']) {
      const m = JSON.parse(readFileSync(join(root, 'messages', locale, 'settings.json'), 'utf8'));
      for (const tab of DESKTOP_NATIVE_SECTIONS) {
        const cap = `${tab[0].toUpperCase()}${tab.slice(1)}`;
        expect(m.desktopSections[tab], `${locale}: desktopSections.${tab}`).toBeTruthy();
        expect(desktop[locale][`tab${cap}`], `${locale}: tab${cap}`).toBe(m.desktopSections[tab]);
        expect(desktop[locale][`kw${cap}`], `${locale}: kw${cap}`).toBeTruthy();
      }
    }
  });

  it('rutas de ajustes que la ventana del escritorio abre adentro', () => {
    for (const p of ['/app/settings', '/es/app/settings/offline', '/app/crm/settings', '/pt/app/track/settings', '/app/chat/widgets']) expect(isSettingsRoute(p), p).toBe(true);
    for (const p of ['/app/crm', '/app/settingsx', '/es/app/docs/abc', '/download']) expect(isSettingsRoute(p), p).toBe(false);
  });

  it('el filtro de la nav busca por nombre o palabra clave, sin tildes', () => {
    expect(matchesSettingsQuery('', 'Perfil')).toBe(true);
    expect(matchesSettingsQuery('conexion', 'Sin conexión')).toBe(true);
    expect(matchesSettingsQuery('dark', 'Appearance', 'theme, dark mode')).toBe(true);
    expect(matchesSettingsQuery('dark mode', 'Appearance', 'theme, dark mode')).toBe(true);
    expect(matchesSettingsQuery('billing', 'Members')).toBe(false);
  });

  it('Productos: una entrada por app hacia /app/<app>/settings, y cada ruta existe', () => {
    const products = settingsSections(false).find((g) => g.key === 'products')!.items;
    expect(products.map((p) => p.product)).toEqual(PRODUCT_KEYS);
    expect(products.find((p) => p.product === 'cal')?.href).toBe('/app/calendar/settings');
    expect(products.find((p) => p.product === 'link')?.href).toBe('/app/links/settings');
    for (const item of [...account(true), ...products]) expect(pageExists(item.href), item.href).toBe(true);
  });

  it('activa la sección de prefijo más largo, con las rutas extra de Admin', () => {
    const tabs = account(true);
    expect(activeRouteTab(tabs, '/app/settings')).toBe('profile');
    expect(activeRouteTab(tabs, '/app/settings/workspace')).toBe('workspace');
    expect(activeRouteTab(tabs, '/app/settings/api')).toBe('api');
    expect(activeRouteTab(tabs, '/app/settings/feedback')).toBe('admin');
    expect(activeRouteTab(tabs, '/app/settings/roadmap')).toBe('admin');
    expect(activeRouteTab(tabs, '/app/settings/changelog')).toBe('admin');
    expect(activeRouteTab(tabs, '/app/settingsx')).toBeUndefined();
    expect(activeRouteTab(tabs, '/app/crm')).toBeUndefined();
  });

  it('el user agent de la ventana del escritorio activa el modo embebido', () => {
    expect(isSettingsEmbed('Mozilla/5.0 (Macintosh) Safari/605.1.15 zerosoft-settings/0.3.2')).toBe(true);
    expect(isSettingsEmbed('Mozilla/5.0 (Macintosh) Safari/605.1.15')).toBe(false);
    expect(isSettingsEmbed(null)).toBe(false);
  });

  it('sin Admin, las rutas de admin caen en Perfil (el 404 lo da la página)', () => {
    expect(activeRouteTab(account(false), '/app/settings/roadmap')).toBe('profile');
  });

  it('los anchors viejos de /app/settings/workspace caen en su sección nueva', () => {
    expect(legacySettingsTarget('/app/settings/workspace', '#api')).toBe('/app/settings/api#api-keys');
    expect(legacySettingsTarget('/app/settings/workspace', '#webhooks')).toBe('/app/settings/api#webhooks');
    expect(legacySettingsTarget('/app/settings/workspace', '#ai')).toBe('/app/settings/billing#ai');
    expect(legacySettingsTarget('/app/settings/workspace', '#credentials')).toBe('/app/settings/connections#credentials');
    expect(legacySettingsTarget('/app/settings', '#domains')).toBe('/app/links/settings?tab=domains');
    expect(legacySettingsTarget('/app/settings/workspace', '')).toBeNull();
    expect(legacySettingsTarget('/app/settings/api', '#api')).toBeNull();
  });

  it('los links "hoy está en" de las secciones vacías apuntan a páginas que existen', () => {
    for (const links of Object.values(SETTINGS_ELSEWHERE)) for (const l of links ?? []) expect(pageExists(l.href), l.href).toBe(true);
  });

  it('cada sección y grupo tiene texto en en/es/pt', () => {
    for (const locale of ['en', 'es', 'pt']) {
      const m = JSON.parse(readFileSync(join(root, 'messages', locale, 'settings.json'), 'utf8'));
      for (const item of account(true)) {
        expect(m.sections[item.key], `${locale}: ${item.key}`).toBeTruthy();
        expect(m.keywords[item.key], `${locale}: keywords.${item.key}`).toBeTruthy();
      }
      for (const g of settingsSections(true)) expect(m.groups[g.key], `${locale}: ${g.key}`).toBeTruthy();
      for (const [section, links] of Object.entries(SETTINGS_ELSEWHERE)) {
        for (const key of ['title', 'desc', 'empty']) expect(m.soon[section][key], `${locale}: soon.${section}.${key}`).toBeTruthy();
        for (const l of links ?? []) expect(m.soon[section][l.label], `${locale}: soon.${section}.${l.label}`).toBeTruthy();
      }
    }
  });
});

describe('settings: eventos de webhooks agrupados', () => {
  it('los 67 eventos quedan en 18 grupos por recurso, sin perder ni repetir', () => {
    const groups = webhookEventGroups();
    expect(groups.map((g) => g.key)).toEqual(['booking', 'link', 'contact', 'company', 'deal', 'task', 'quote', 'form', 'robot', 'chat', 'groups', 'issue', 'comment', 'project', 'page', 'database', 'talk', 'voice']);
    expect(groups.flatMap((g) => g.events)).toEqual([...WEBHOOK_EVENTS]);
    expect(WEBHOOK_EVENTS).toHaveLength(67);
  });

  it('el checkbox del grupo es todos, ninguno o indeterminado', () => {
    const deal = webhookEventGroups().find((g) => g.key === 'deal')!.events;
    expect(groupState(deal, [])).toBe('none');
    expect(groupState(deal, ['deal.won'])).toBe('some');
    expect(groupState(deal, [...deal])).toBe('all');
  });

  it('tocar el grupo agrega los que faltan (en orden) o saca todos', () => {
    const deal = webhookEventGroups().find((g) => g.key === 'deal')!.events;
    const some = toggleGroup(deal, ['link.created', 'deal.won']);
    expect(some).toEqual(['link.created', ...deal]);
    expect(toggleGroup(deal, some)).toEqual(['link.created']);
  });

  it('cada evento tiene su nombre en en, es y pt', () => {
    for (const locale of ['en', 'es', 'pt']) {
      const m = JSON.parse(readFileSync(join(__dirname, '..', '..', 'messages', locale, 'settings.json'), 'utf8'));
      for (const ev of WEBHOOK_EVENTS) expect(m.webhooks.eventLabels[ev.replace(/\./g, '_')], `${locale} ${ev}`).toBeTruthy();
      for (const g of webhookEventGroups()) expect(m.webhooks.groups[g.key], `${locale} ${g.key}`).toBeTruthy();
    }
  });
});

describe('settings: cuota de IA', () => {
  it('porcentaje acotado a 0–100', () => {
    expect(quotaPct(0, null)).toBe(0);
    expect(quotaPct(5, 0)).toBe(100);
    expect(quotaPct(0, 0)).toBe(0);
    expect(quotaPct(50_000, 200_000)).toBe(25);
    expect(quotaPct(400_000, 200_000)).toBe(100);
  });
});
