import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCompany, createDeal, createPipeline, createStage, getDeal, updateStage } from '@/lib/crm';
import { getCrmSettings, updateCrmSettings } from '@/lib/crm-currency';
import { getDb } from '@/lib/db';
import {
  DEFAULT_CALL_OUTCOMES,
  DEFAULT_WHATSAPP_OUTCOMES,
  isDefaultOutcome,
  parseCallOutcomes,
  parseOutcomeConfig,
  serializeOutcomeConfig,
} from '@/lib/crm-calls';
import { quickCreateRedirect } from '@/lib/quick-create-redirect';
import { todayIso, wonRequirements } from '@/lib/crm-won-dialog';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role: string }) => u.role === 'owner' || u.role === 'admin',
}));
const moveRoute = await import('@/app/api/crm/deals/[id]/move/route');
const enrichRoute = await import('@/app/api/crm/companies/enrich/route');

beforeEach(() => {
  session.user = null;
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never;

describe('/new de las altas en modal', () => {
  it('redirige a la lista con ?new=1 solo sin query', () => {
    expect(quickCreateRedirect('/es/app/calendar/event-types/new', '')).toBe('/es/app/calendar/event-types?new=1');
    expect(quickCreateRedirect('/en/app/calendar/routing/new/', '')).toBe('/en/app/calendar/routing?new=1');
    expect(quickCreateRedirect('/pt/app/crm/companies/new', '')).toBe('/pt/app/crm/companies?new=1');
    expect(quickCreateRedirect('/es/app/crm/contacts/new', '')).toBe('/es/app/crm/contacts?new=1');
    expect(quickCreateRedirect('/es/app/crm/deals/new', '')).toBe('/es/app/crm/deals?new=1');
    expect(quickCreateRedirect('/en/app/track/projects/p1/issues/new', '')).toBe('/en/app/track/projects/p1?newIssue=1');
    // Sub-issue: la página manda al padre.
    expect(quickCreateRedirect('/en/app/track/projects/p1/issues/new', '?parentId=i1')).toBeNull();
    // Con parámetros decide la página (formulario completo, contexto).
    expect(quickCreateRedirect('/es/app/crm/companies/new', '?full=1')).toBeNull();
    expect(quickCreateRedirect('/es/app/crm/contacts/new', '?companyId=x')).toBeNull();
    // Otras rutas /new tienen su propia página.
    expect(quickCreateRedirect('/es/app/links/new', '')).toBeNull();
    expect(quickCreateRedirect('/es/app/crm/workflows/new', '')).toBeNull();
    expect(quickCreateRedirect('/de/app/crm/deals/new', '')).toBeNull();
  });
});

describe('Diálogo de ganado', () => {
  it('la fecha de cierre va primero y una sola vez', () => {
    expect(wonRequirements({ stage: 'Won', missing: [] }).missing).toEqual([{ key: 'closeDate', type: 'closeDate' }]);
    const merged = wonRequirements({
      stage: 'Won',
      missing: [
        { key: 'amount', type: 'amount' },
        { key: 'closeDate', type: 'closeDate' },
      ],
    });
    expect(merged.missing.map((f) => f.key)).toEqual(['closeDate', 'amount']);
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('dryRun dice qué falta sin mover y sin 422; con los campos se mueve en un paso', async () => {
    const u = await makeUser('won-dry');
    const p = await createPipeline(u.id, 'Sales');
    const open = await createStage(u.id, p.id, { name: 'Open' });
    const won = await createStage(u.id, p.id, { name: 'Won' });
    await updateStage(u.id, won!.id, { isWon: true, requiredFields: ['closeDate', 'amount'] });
    const d = await createDeal(u.id, { name: 'Big one', pipelineId: p.id, stageId: open!.id });
    if (!d.ok) throw new Error('deal');
    session.user = { ...u, role: 'owner', team: null };

    const dry = await moveRoute.POST(post(`http://x/api/crm/deals/${d.deal.id}/move`, { stageId: won!.id, dryRun: true }), ctx(d.deal.id));
    expect(dry.status).toBe(200);
    const body = (await dry.json()) as { stage: string; missing: Array<{ key: string }> };
    expect(body.stage).toBe('Won');
    expect(body.missing.map((f) => f.key).sort()).toEqual(['amount', 'closeDate']);
    expect((await getDeal(u.id, d.deal.id))?.deal.stage_id).toBe(open!.id);

    const ok = await moveRoute.POST(
      post(`http://x/api/crm/deals/${d.deal.id}/move`, { stageId: won!.id, fields: { closeDate: '2026-10-21', amount: 900 } }),
      ctx(d.deal.id),
    );
    expect(ok.status).toBe(200);
    const after = await getDeal(u.id, d.deal.id);
    expect(after?.deal).toMatchObject({ stage_id: won!.id, close_date: '2026-10-21', amount: 900 });

    // En la misma etapa no falta nada.
    const same = await moveRoute.POST(post(`http://x/api/crm/deals/${d.deal.id}/move`, { stageId: won!.id, dryRun: true }), ctx(d.deal.id));
    expect((await same.json()).missing).toEqual([]);
  });
});

describe('Aviso de empresa duplicada', () => {
  it('?check=1 responde solo si el dominio ya existe, sin ir al sitio', async () => {
    const u = await makeUser('dup-check');
    await createCompany(u.id, { name: 'Acme', domain: 'https://www.acme.com' });
    session.user = { ...u, role: 'owner', team: null };
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await enrichRoute.GET(new NextRequest('http://x/api/crm/companies/enrich?domain=ACME.com&check=1') as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ domain: 'acme.com', existing: { name: 'Acme' } });
    const none = await enrichRoute.GET(new NextRequest('http://x/api/crm/companies/enrich?domain=nueva.io&check=1') as never);
    expect(await none.json()).toEqual({ domain: 'nueva.io', existing: null });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('Resultados de WhatsApp aparte de los de llamada', () => {
  it('formato viejo (array) = llamadas; el nuevo guarda los dos canales', () => {
    expect(parseOutcomeConfig('["Demo"]')).toEqual({ call: ['Demo'], whatsapp: [] });
    expect(parseOutcomeConfig('{"whatsapp":["Visto"]}')).toEqual({ call: [], whatsapp: ['Visto'] });
    expect(parseOutcomeConfig('roto')).toEqual({ call: [], whatsapp: [] });
    expect(parseCallOutcomes(null, 'whatsapp')).toEqual([...DEFAULT_WHATSAPP_OUTCOMES]);
    expect(parseCallOutcomes('["Demo"]', 'whatsapp')).toEqual([...DEFAULT_WHATSAPP_OUTCOMES]);
    expect(serializeOutcomeConfig({ call: [], whatsapp: [] })).toBeNull();
    expect(serializeOutcomeConfig({ call: [], whatsapp: ['Visto'] })).toBe('{"whatsapp":["Visto"]}');
    // Los de siempre de WhatsApp no repiten los de llamada (buzón de voz, número equivocado).
    expect(DEFAULT_WHATSAPP_OUTCOMES).not.toContain('left_voicemail');
    expect(isDefaultOutcome('replied')).toBe(true);
    expect(isDefaultOutcome('connected')).toBe(true);
  });

  it('cada canal se configura y se resetea por separado', async () => {
    const u = await makeUser('wa-outcomes');
    expect(await getCrmSettings(u.id)).toMatchObject({
      callOutcomes: [...DEFAULT_CALL_OUTCOMES],
      whatsappOutcomes: [...DEFAULT_WHATSAPP_OUTCOMES],
      whatsappOutcomesCustom: false,
    });
    await updateCrmSettings(u.id, { callOutcomes: ['Demo agendada'] });
    await updateCrmSettings(u.id, { whatsappOutcomes: ['Pidió precio', 'Visto'] });
    expect(await getCrmSettings(u.id)).toMatchObject({
      callOutcomes: ['Demo agendada'],
      callOutcomesCustom: true,
      whatsappOutcomes: ['Pidió precio', 'Visto'],
      whatsappOutcomesCustom: true,
    });
    await updateCrmSettings(u.id, { callOutcomes: null });
    expect(await getCrmSettings(u.id)).toMatchObject({
      callOutcomes: [...DEFAULT_CALL_OUTCOMES],
      callOutcomesCustom: false,
      whatsappOutcomes: ['Pidió precio', 'Visto'],
    });
    // Una base con el formato viejo sigue leyendo sus llamadas.
    await getDb().prepare('UPDATE crm_settings SET call_outcomes = ? WHERE user_id = ?').run('["Viejo"]', u.id);
    expect(await getCrmSettings(u.id)).toMatchObject({ callOutcomes: ['Viejo'], whatsappOutcomes: [...DEFAULT_WHATSAPP_OUTCOMES] });
  });
});
