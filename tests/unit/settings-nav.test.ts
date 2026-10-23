import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeRouteTab, groupState, quotaPct, settingsTabs, toggleGroup, webhookEventGroups } from '@/lib/settings-nav';
import { WEBHOOK_EVENTS } from '@/lib/webhooks-events';

describe('settings: pestañas', () => {
  it('Cuenta y Workspace para todos; Admin solo para ADMIN_EMAILS', () => {
    expect(settingsTabs(false).map((t) => t.key)).toEqual(['account', 'workspace']);
    expect(settingsTabs(true).map((t) => t.key)).toEqual(['account', 'workspace', 'admin']);
  });

  it('activa la pestaña de prefijo más largo, con las rutas extra de Admin', () => {
    const tabs = settingsTabs(true);
    expect(activeRouteTab(tabs, '/app/settings')).toBe('account');
    expect(activeRouteTab(tabs, '/app/settings/workspace')).toBe('workspace');
    expect(activeRouteTab(tabs, '/app/settings/feedback')).toBe('admin');
    expect(activeRouteTab(tabs, '/app/settings/roadmap')).toBe('admin');
    expect(activeRouteTab(tabs, '/app/settings/changelog')).toBe('admin');
    expect(activeRouteTab(tabs, '/app/settingsx')).toBeUndefined();
    expect(activeRouteTab(tabs, '/app/crm')).toBeUndefined();
  });

  it('sin Admin, las rutas de admin caen en Cuenta (el 404 lo da la página)', () => {
    expect(activeRouteTab(settingsTabs(false), '/app/settings/roadmap')).toBe('account');
  });
});

describe('settings: eventos de webhooks agrupados', () => {
  it('los 25 eventos quedan en 7 grupos por recurso, sin perder ni repetir', () => {
    const groups = webhookEventGroups();
    expect(groups.map((g) => g.key)).toEqual(['booking', 'link', 'contact', 'deal', 'robot', 'chat', 'groups']);
    expect(groups.flatMap((g) => g.events)).toEqual([...WEBHOOK_EVENTS]);
    expect(WEBHOOK_EVENTS).toHaveLength(25);
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
