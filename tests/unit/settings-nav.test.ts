import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  activeRouteTab,
  groupState,
  legacySettingsTarget,
  quotaPct,
  SETTINGS_ELSEWHERE,
  settingsSections,
  toggleGroup,
  webhookEventGroups,
} from '@/lib/settings-nav';
import { PRODUCT_KEYS } from '@/lib/products';
import { WEBHOOK_EVENTS } from '@/lib/webhooks-events';

const root = join(__dirname, '..', '..');
const pageExists = (href: string) =>
  existsSync(join(root, 'app', '[locale]', href.split(/[?#]/)[0].replace(/^\//, ''), 'page.tsx'));

describe('settings: secciones de la plataforma', () => {
  const account = (admin: boolean) => settingsSections(admin)[0].items;

  it('dos grupos: Cuenta y workspace (Admin solo para ADMIN_EMAILS) y Productos', () => {
    expect(settingsSections(false).map((g) => g.key)).toEqual(['account', 'products']);
    expect(account(false).map((t) => t.key)).toEqual([
      'profile',
      'workspace',
      'members',
      'teams',
      'billing',
      'api',
      'connections',
      'import',
      'security',
      'notifications',
    ]);
    expect(account(true).map((t) => t.key).at(-1)).toBe('admin');
  });

  it('Productos: una entrada por app hacia /app/<app>/settings, y cada ruta existe', () => {
    const products = settingsSections(false)[1].items;
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
      for (const item of account(true)) expect(m.sections[item.key], `${locale}: ${item.key}`).toBeTruthy();
      for (const g of settingsSections(true)) expect(m.groups[g.key], `${locale}: ${g.key}`).toBeTruthy();
      for (const [section, links] of Object.entries(SETTINGS_ELSEWHERE)) {
        for (const key of ['title', 'desc', 'empty']) expect(m.soon[section][key], `${locale}: soon.${section}.${key}`).toBeTruthy();
        for (const l of links ?? []) expect(m.soon[section][l.label], `${locale}: soon.${section}.${l.label}`).toBeTruthy();
      }
    }
  });
});

describe('settings: eventos de webhooks agrupados', () => {
  it('los 59 eventos quedan en 16 grupos por recurso, sin perder ni repetir', () => {
    const groups = webhookEventGroups();
    expect(groups.map((g) => g.key)).toEqual(['booking', 'link', 'contact', 'company', 'deal', 'task', 'quote', 'form', 'robot', 'chat', 'groups', 'issue', 'comment', 'project', 'page', 'database']);
    expect(groups.flatMap((g) => g.events)).toEqual([...WEBHOOK_EVENTS]);
    expect(WEBHOOK_EVENTS).toHaveLength(59);
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
