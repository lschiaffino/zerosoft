import { describe, expect, it } from 'vitest';
import {
  companyPayload,
  contactPayload,
  creatableStages,
  dealPayload,
  deriveDomain,
  readCustomFields,
  type CustomFieldDef,
} from '@/components/crm/formPayload';
import { parseRecordTab, recordTabHref } from '@/components/crm/recordTab';
import es from '@/messages/es/crm.json';
import en from '@/messages/en/crm.json';
import pt from '@/messages/pt/crm.json';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

describe('CRM: tabs del detalle', () => {
  it('cae en Actividad con cualquier valor que no sea un tab', () => {
    expect(parseRecordTab(undefined)).toBe('activity');
    expect(parseRecordTab('nope')).toBe('activity');
    expect(parseRecordTab(['related'])).toBe('activity');
    expect(parseRecordTab('properties')).toBe('properties');
    expect(parseRecordTab('related')).toBe('related');
  });

  it('arma el href de cada tab (Actividad sin query)', () => {
    expect(recordTabHref('/app/crm/contacts/1', 'activity')).toBe('/app/crm/contacts/1');
    expect(recordTabHref('/app/crm/contacts/1', 'related')).toBe('/app/crm/contacts/1?tab=related');
  });
});

describe('CRM: alta de contacto', () => {
  const defs: CustomFieldDef[] = [
    { name: 'plan', label: 'Plan', type: 'select', options: ['pro'] },
    { name: 'seats', label: 'Seats', type: 'number', options: [] },
    { name: 'vip', label: 'VIP', type: 'boolean', options: [] },
    { name: 'notes', label: 'Notes', type: 'text', options: [] },
  ];

  it('con solo lo básico manda defaults de lifecycle y estado', () => {
    const body = contactPayload(fd({ firstName: ' Ana ', email: 'ana@acme.com', companyId: '' }), defs);
    expect(body).toMatchObject({
      firstName: 'Ana',
      email: 'ana@acme.com',
      lifecycleStage: 'lead',
      leadStatus: 'new',
      companyId: null,
      custom: {},
    });
    expect(body.jobTitle).toBeUndefined();
  });

  it('los campos de "Más campos" y los propios viajan con su tipo', () => {
    const body = contactPayload(
      fd({
        lastName: 'Paz',
        jobTitle: 'CTO',
        lifecycleStage: 'customer',
        'custom.plan': 'pro',
        'custom.seats': '12',
        'custom.vip': 'on',
        'custom.notes': '   ',
      }),
      defs,
    );
    expect(body.jobTitle).toBe('CTO');
    expect(body.lifecycleStage).toBe('customer');
    expect(body.custom).toEqual({ plan: 'pro', seats: 12, vip: true });
  });

  it('readCustomFields ignora números inválidos', () => {
    expect(readCustomFields(fd({ 'custom.seats': 'abc' }), defs)).toEqual({});
  });
});

describe('CRM: alta de empresa', () => {
  it('deriva el dominio del sitio web si quedó vacío', () => {
    expect(deriveDomain(undefined, 'https://www.Acme.com/about')).toBe('acme.com');
    expect(deriveDomain('Sub.Acme.io', 'https://otro.com')).toBe('sub.acme.io');
    expect(deriveDomain('acme.com:8080/x', undefined)).toBe('acme.com');
    expect(deriveDomain(undefined, undefined)).toBeUndefined();
  });

  it('manda strings vacíos y employees null como antes', () => {
    const body = companyPayload(fd({ name: 'Acme', website: 'https://acme.com' }));
    expect(body).toEqual({
      name: 'Acme',
      domain: 'acme.com',
      industry: '',
      employees: null,
      phone: '',
      website: 'https://acme.com',
      city: '',
      country: '',
      lifecycleStage: 'lead',
    });
    expect(companyPayload(fd({ name: 'A', employees: '40' })).employees).toBe(40);
  });
});

describe('CRM: alta de deal', () => {
  it('lo básico: nombre, monto, etapa y contacto; moneda en mayúsculas', () => {
    const body = dealPayload(
      fd({ name: 'Acme', amount: '1500', pipelineId: 'p1', stageId: 's1', contactId: 'c1', currency: 'eur' }),
    );
    expect(body).toMatchObject({
      name: 'Acme',
      amount: 1500,
      currency: 'EUR',
      pipelineId: 'p1',
      stageId: 's1',
      priority: 'medium',
      closeDate: null,
      contactIds: ['c1'],
    });
    expect(body).not.toHaveProperty('source');
  });

  it('el contacto fijo gana y el monto vacío es 0', () => {
    const body = dealPayload(fd({ name: 'X', pipelineId: 'p', stageId: 's', contactId: 'otro' }), 'fijo');
    expect(body.contactIds).toEqual(['fijo']);
    expect(body.amount).toBe(0);
    expect(body.currency).toBe('USD');
  });

  it('las etapas elegibles son las abiertas, o todas si no hay abiertas', () => {
    const open = { id: 'a', is_won: 0, is_lost: 0 };
    const won = { id: 'w', is_won: 1, is_lost: 0 };
    const lost = { id: 'l', is_won: 0, is_lost: 1 };
    expect(creatableStages({ stages: [open, won, lost] }).map((s) => s.id)).toEqual(['a']);
    expect(creatableStages({ stages: [won, lost] }).map((s) => s.id)).toEqual(['w', 'l']);
    expect(creatableStages(undefined)).toEqual([]);
  });
});

describe('CRM: strings del rediseño en los tres idiomas', () => {
  type Tree = { [k: string]: string | Tree };
  const keys = (o: Tree, prefix = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`)));
  const rec = (m: unknown) => ((m as { crm?: Tree }).crm ?? (m as Tree)).record as Tree;

  it('crm.record tiene las mismas claves en es, en y pt', () => {
    const base = keys(rec(es)).sort();
    expect(base.length).toBeGreaterThan(40);
    expect(keys(rec(en)).sort()).toEqual(base);
    expect(keys(rec(pt)).sort()).toEqual(base);
  });

  it('sin em dashes en los strings nuevos', () => {
    for (const m of [es, en, pt]) {
      const all = JSON.stringify(rec(m));
      expect(all).not.toContain('—');
    }
  });
});
