import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CARDS_STORAGE_KEY,
  COMPOSE_TYPES,
  LAYOUT_TABS,
  NARROW_ONLY_TABS,
  WIDE_MIN_PX,
  WIDE_QUERY,
  composeHref,
  layoutTabHref,
  middlePanelFor,
  parseCollapsed,
  parseCompose,
  parseLayoutTab,
  recordInitials,
  shownTab,
  withCollapsed,
} from '@/components/crm/recordLayout';
import en from '@/messages/en/crm.json';
import es from '@/messages/es/crm.json';
import pt from '@/messages/pt/crm.json';

describe('CRM: pestañas de la ficha en columnas', () => {
  it('cae en Actividad con cualquier valor que no sea una pestaña', () => {
    expect(parseLayoutTab(undefined)).toBe('activity');
    expect(parseLayoutTab('nope')).toBe('activity');
    expect(parseLayoutTab(['overview'])).toBe('activity');
    for (const tab of LAYOUT_TABS) expect(parseLayoutTab(tab)).toBe(tab);
  });

  it('los links de la ficha anterior siguen valiendo', () => {
    // ?tab=properties y ?tab=related existían antes de las columnas.
    expect(parseLayoutTab('properties')).toBe('properties');
    expect(parseLayoutTab('related')).toBe('related');
    expect(layoutTabHref('/app/crm/contacts/1', 'activity')).toBe('/app/crm/contacts/1');
    expect(layoutTabHref('/app/crm/contacts/1', 'related')).toBe('/app/crm/contacts/1?tab=related');
    expect(layoutTabHref('/app/crm/deals/9', 'overview')).toBe('/app/crm/deals/9?tab=overview');
  });

  it('el medio muestra Resumen o Actividad, también con las pestañas de una columna', () => {
    expect(middlePanelFor('overview')).toBe('overview');
    expect(middlePanelFor('activity')).toBe('activity');
    expect(middlePanelFor('properties')).toBe('activity');
    expect(middlePanelFor('related')).toBe('overview');
  });

  it('en tres columnas se marca la pestaña del panel del medio; en una, la pedida', () => {
    for (const tab of LAYOUT_TABS) expect(shownTab(tab, false)).toBe(tab);
    expect(shownTab('overview', true)).toBe('overview');
    expect(shownTab('activity', true)).toBe('activity');
    expect(shownTab('properties', true)).toBe('activity');
    expect(shownTab('related', true)).toBe('overview');
    // Lo que se marca en ancho siempre es una pestaña que está a la vista.
    for (const tab of LAYOUT_TABS) expect(NARROW_ONLY_TABS).not.toContain(shownTab(tab, true));
  });

  it('el corte de tres columnas es el mismo número en el CSS', () => {
    const css = readFileSync('styles/crm-record-layout.css', 'utf8');
    expect(WIDE_QUERY).toBe(`(min-width: ${WIDE_MIN_PX}px)`);
    expect(css).toContain(`@media (min-width: ${WIDE_MIN_PX}px)`);
    expect(css).toContain(`@media (max-width: ${WIDE_MIN_PX - 0.02}px)`);
  });

  it('el CSS de la ficha no trae colores sueltos (solo tokens)', () => {
    const css = readFileSync('styles/crm-record-layout.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/);
  });
});

describe('CRM: acciones rápidas de la ficha', () => {
  it('solo abre el composer con un tipo de actividad que existe', () => {
    for (const type of COMPOSE_TYPES) expect(parseCompose(type)).toBe(type);
    expect(parseCompose('sms')).toBeNull();
    expect(parseCompose(undefined)).toBeNull();
    expect(parseCompose(['note'])).toBeNull();
  });

  it('lleva a la pestaña Actividad con el tipo', () => {
    expect(composeHref('/app/crm/companies/7', 'call')).toBe('/app/crm/companies/7?tab=activity&compose=call');
  });
});

describe('CRM: tarjetas plegadas', () => {
  it('lee lo guardado y descarta lo que no entiende', () => {
    expect(parseCollapsed(null)).toEqual({});
    expect(parseCollapsed('')).toEqual({});
    expect(parseCollapsed('not json')).toEqual({});
    expect(parseCollapsed('[1,2]')).toEqual({});
    expect(parseCollapsed('"x"')).toEqual({});
    expect(parseCollapsed('{"contact.deals":true,"contact.files":false,"x":"yes","n":1}')).toEqual({ 'contact.deals': true });
    expect(parseCollapsed(JSON.stringify({ ['k'.repeat(81)]: true }))).toEqual({});
  });

  it('pliega y abre sin tocar el mapa de entrada; las abiertas no se guardan', () => {
    const start = parseCollapsed('{"contact.deals":true}');
    const more = withCollapsed(start, 'deal.files', true);
    expect(more).toEqual({ 'contact.deals': true, 'deal.files': true });
    expect(start).toEqual({ 'contact.deals': true });
    expect(withCollapsed(more, 'contact.deals', false)).toEqual({ 'deal.files': true });
    expect(withCollapsed(start, 'nope', false)).toEqual(start);
    // Ida y vuelta por el almacenamiento.
    expect(parseCollapsed(JSON.stringify(more))).toEqual(more);
    expect(CARDS_STORAGE_KEY).toMatch(/^zs\.crm\./);
  });
});

describe('CRM: iniciales del avatar', () => {
  it('dos palabras, una, un email o nada', () => {
    expect(recordInitials('Ada Lovelace')).toBe('AL');
    expect(recordInitials('  grace   brewster hopper ')).toBe('GB');
    expect(recordInitials('Plato')).toBe('P');
    expect(recordInitials('someone@example.com')).toBe('S');
    expect(recordInitials('"Quoted" (Name)')).toBe('QN');
    expect(recordInitials('Émile Zola')).toBe('ÉZ');
    expect(recordInitials('')).toBe('?');
    expect(recordInitials(null)).toBe('?');
    expect(recordInitials('—')).toBe('?');
  });
});

describe('CRM: textos de la ficha en los tres idiomas', () => {
  it('pestañas, tarjetas y acciones tienen las mismas claves', () => {
    for (const messages of [en, es, pt]) {
      expect(Object.keys(messages.record.layoutTabs)).toEqual([...LAYOUT_TABS]);
      expect(Object.keys(messages.record.cards)).toEqual(Object.keys(en.record.cards));
      for (const key of ['collapse', 'expand'] as const) expect(messages.record.cards[key]).toContain('{name}');
      for (const key of ['quickActions', 'highlights', 'recentActivity', 'seeAllActivity'] as const) {
        expect(messages.record[key]).toBeTruthy();
      }
      for (const type of COMPOSE_TYPES) expect(messages.enums.activityType[type]).toBeTruthy();
    }
  });
});
