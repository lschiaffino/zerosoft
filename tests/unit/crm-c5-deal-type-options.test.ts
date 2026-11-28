/**
 * CRM C5: las opciones de Deal type se editan como las de Lifecycle stage y
 * Lead status (agregar, renombrar, ordenar, archivar). Acceso a
 * /api/crm/property-options (anónimo, otro workspace, member, owner), la
 * escritura de un deal (una archivada o ajena no se guarda, '' lo deja sin
 * elegir), la edición en masa, el import y el uso por opción. Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createDeal, createPipeline, createStage, getDeal, updateDeal } from '@/lib/crm';
import { CrmRefError } from '@/lib/crm-refs';
import { getDb } from '@/lib/db';
import { buildBulkPatch } from '@/lib/crm-bulk';
import { importDeals } from '@/lib/crm-import';
import { addOption, listOptionSets, optionUsage, updateOption } from '@/lib/crm-property-options';
import { optionPropertyOf } from '@/lib/crm-property-options-shared';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const route = await import('@/app/api/crm/property-options/route');
const dealRoute = await import('@/lib/routes/crm/deals/[id]/route');

beforeEach(() => {
  session.user = null;
});

const uid = () => Math.random().toString(36).slice(2, 8);
const post = (body: unknown) =>
  new NextRequest('http://x/api/crm/property-options', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const patchDeal = (id: string, body: unknown) =>
  dealRoute.PATCH(new NextRequest(`http://x/api/crm/deals/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), {
    params: Promise.resolve({ id }),
  });

async function dealIn(ws: string, dealType?: string) {
  const p = await createPipeline(ws, `P ${uid()}`);
  const stage = (await createStage(ws, p.id, { name: 'Intro', probability: 10 }))!;
  const res = await createDeal(ws, { pipelineId: p.id, stageId: stage.id, name: `Deal ${uid()}`, amount: 100, ...(dealType !== undefined ? { dealType } : {}) });
  if (!res.ok) throw new Error(res.reason);
  return { deal: res.deal, pipelineId: p.id, stageId: stage.id };
}

describe('deal type: opciones del workspace', () => {
  it('por defecto las de fábrica; una propia se agrega, se renombra y se archiva', async () => {
    const w = await workspaceWithMember('c5-dt');
    const ws = w.owner.id;
    expect((await listOptionSets(ws)).dealType.map((o) => o.value)).toEqual(['newbusiness', 'existingbusiness']);
    expect(optionPropertyOf('dealType')).toBe('dealType');
    expect(optionPropertyOf('deal_type')).toBe('dealType');
    session.user = asOwner(w.owner);
    const res = await route.POST(post({ action: 'add', property: 'dealType', label: 'Renewal' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { options: Array<{ value: string; label: string | null }> };
    const renewal = body.options.find((o) => o.label === 'Renewal')!;
    expect(renewal.value).toMatch(/^opt_/);
    expect((await route.POST(post({ action: 'update', property: 'dealType', value: 'newbusiness', label: 'New logo' }))).status).toBe(200);
    expect((await listOptionSets(ws)).dealType.find((o) => o.value === 'newbusiness')?.label).toBe('New logo');
  });

  it('acceso: anónimo 401, member lee y no edita, otro workspace no ve las propias', async () => {
    const w = await workspaceWithMember('c5-dt-acc');
    await addOption(w.owner.id, 'dealType', 'Secret motion');
    expect((await route.POST(post({ action: 'add', property: 'dealType', label: 'X' }))).status).toBe(401);
    session.user = asMember(w.owner, w.member);
    const sets = (await (await route.GET()).json()) as { dealType: Array<{ label: string | null }> };
    expect(sets.dealType.some((o) => o.label === 'Secret motion')).toBe(true);
    expect((await route.POST(post({ action: 'add', property: 'dealType', label: 'Y' }))).status).toBe(403);
    session.user = asOwner(w.stranger);
    const theirs = (await (await route.GET()).json()) as { dealType: Array<{ label: string | null }> };
    expect(theirs.dealType.some((o) => o.label === 'Secret motion')).toBe(false);
  });

  it('un deal guarda una activa; una archivada o de otro workspace no; la que ya tenía se conserva; "" la quita', async () => {
    const w = await workspaceWithMember('c5-dt-write');
    const ws = w.owner.id;
    const renewal = await addOption(ws, 'dealType', 'Renewal');
    const other = await addOption(w.stranger.id, 'dealType', 'Their type');
    const { deal } = await dealIn(ws, renewal.value);
    expect((await getDeal(ws, deal.id))?.deal.deal_type).toBe(renewal.value);

    await expect(updateDeal(ws, deal.id, { dealType: other.value })).rejects.toBeInstanceOf(CrmRefError);
    await updateOption(ws, 'dealType', renewal.value, { archived: true });
    // La que ya tenía sigue valiendo (editar otra cosa no la borra)…
    expect(await updateDeal(ws, deal.id, { dealType: renewal.value, name: 'Renamed' })).not.toBeNull();
    // …pero otro deal no la puede tomar.
    const second = await dealIn(ws);
    await expect(updateDeal(ws, second.deal.id, { dealType: renewal.value })).rejects.toBeInstanceOf(CrmRefError);
    await expect(dealIn(ws, renewal.value)).rejects.toBeInstanceOf(CrmRefError);
    // '' deja el deal sin tipo.
    await updateDeal(ws, deal.id, { dealType: '' });
    expect((await getDeal(ws, deal.id))?.deal.deal_type).toBe('');

    // Por la API: 400 invalid_option con una ajena.
    session.user = asOwner(w.owner);
    const res = await patchDeal(second.deal.id, { dealType: other.value });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_option');
  });

  it('uso por opción: cuenta los deals del workspace', async () => {
    const w = await workspaceWithMember('c5-dt-usage');
    const ws = w.owner.id;
    const renewal = await addOption(ws, 'dealType', 'Renewal');
    await dealIn(ws, renewal.value);
    await dealIn(ws, renewal.value);
    await dealIn(ws, 'newbusiness');
    await dealIn(w.stranger.id, 'newbusiness');
    const usage = await optionUsage(ws, 'dealType');
    expect(usage[renewal.value]).toBe(2);
    expect(usage.newbusiness).toBe(1);
    expect(usage['']).toBeUndefined();
  });

  it('edición en masa e import: una propia por clave o nombre; una desconocida queda vacía', async () => {
    expect(buildBulkPatch('deal', 'dealType', 'opt_abc123')).toEqual({ kind: 'field', patch: { dealType: 'opt_abc123' } });
    expect(buildBulkPatch('deal', 'dealType', null)).toEqual({ kind: 'field', patch: { dealType: '' } });
    expect(buildBulkPatch('deal', 'dealType', 'otro')).toBeNull();

    const w = await workspaceWithMember('c5-dt-import');
    const ws = w.owner.id;
    const p = await createPipeline(ws, 'Ventas');
    await createStage(ws, p.id, { name: 'Abierto' });
    const renewal = await addOption(ws, 'dealType', 'Renewal');
    const res = await importDeals(
      ws,
      [
        { name: 'Imp A', dealType: 'renewal' },
        { name: 'Imp B', dealType: 'New Business' },
        { name: 'Imp C', dealType: 'mystery' },
      ],
      'skip',
    );
    expect(res.created).toBe(3);
    expect(res.errors.some((e) => e.includes('deal type') && e.includes('mystery'))).toBe(true);
    const rows = (await getDb().prepare("SELECT name, deal_type FROM crm_deals WHERE user_id = ? AND name LIKE 'Imp %'").all(ws)) as Array<{ name: string; deal_type: string }>;
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.deal_type]));
    expect(byName['Imp A']).toBe(renewal.value);
    expect(byName['Imp B']).toBe('newbusiness');
    expect(byName['Imp C']).toBe('');
  });
});
