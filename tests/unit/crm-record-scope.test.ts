import { describe, expect, it } from 'vitest';
import { createCompany, createDeal, createPipeline, createStage, getCompany, updateStage } from '@/lib/crm';
import { setParentCompany } from '@/lib/crm-assoc';
import { addMember, createTeam } from '@/lib/teams';
import { ownerScopeFor, scopeCompanyDetail, setMemberVisibility } from '@/lib/crm-visibility';
import { scopedCompanyRollup, visibleRecordIds } from '@/lib/crm-record-scope';
import { makeUser } from './helpers';

/**
 * Empresa de un member con dos hijas (una suya, una de otra persona) y deals
 * de los dos en la madre y en las hijas. Visibilidad del workspace: 'mine'.
 */
async function tree() {
  const owner = await makeUser('own');
  const mine = await makeUser('mine');
  const other = await makeUser('other');
  const team = await createTeam(owner.id, 'Sales');
  await addMember(team.id, mine.id, 'member');
  await addMember(team.id, other.id, 'member');
  await setMemberVisibility(owner.id, 'mine');

  const pipeline = await createPipeline(owner.id, 'Sales');
  const open = (await createStage(owner.id, pipeline.id, { name: 'Open' }))!;
  const won = (await createStage(owner.id, pipeline.id, { name: 'Won' }))!;
  await updateStage(owner.id, won.id, { isWon: true });

  const parent = await createCompany(owner.id, { name: 'Parent Co', ownerId: mine.id });
  const myChild = await createCompany(owner.id, { name: 'My Child Co', ownerId: mine.id });
  const hiddenChild = await createCompany(owner.id, { name: 'Hidden Child Co', ownerId: other.id });
  const grandchild = await createCompany(owner.id, { name: 'Grandchild Co', ownerId: mine.id });
  await setParentCompany(owner.id, myChild.id, parent.id);
  await setParentCompany(owner.id, hiddenChild.id, parent.id);
  // Una nieta visible debajo de una hija oculta: cuenta por sí misma.
  await setParentCompany(owner.id, grandchild.id, hiddenChild.id);

  const deal = async (name: string, ownerId: string, amount: number, companyId: string, stageId = open.id) => {
    const res = await createDeal(owner.id, { name, pipelineId: pipeline.id, stageId, ownerId, amount, companyId });
    if (!res.ok) throw new Error(`deal ${name}`);
    return res.deal;
  };
  await deal('Mine open on parent', mine.id, 100, parent.id);
  await deal('Mine won on parent', mine.id, 40, parent.id, won.id);
  await deal('Other open on parent', other.id, 1000, parent.id);
  await deal('Mine on my child', mine.id, 20, myChild.id);
  await deal('Other on my child', other.id, 2000, myChild.id);
  await deal('Other on hidden child', other.id, 4000, hiddenChild.id);
  await deal('Mine on hidden child', mine.id, 8000, hiddenChild.id);
  await deal('Mine on grandchild', mine.id, 7, grandchild.id);

  const scope = await ownerScopeFor({ workspaceId: owner.id, personId: mine.id, role: 'member' });
  return { owner, mine, other, parent, myChild, hiddenChild, grandchild, scope };
}

describe('CRM: ficha de empresa con alcance restringido', () => {
  it('sin restricción, el valor en deals es el de siempre (todo el árbol)', async () => {
    const w = await tree();
    const all = await scopedCompanyRollup(w.owner.id, w.parent.id, null);
    expect(all.own).toEqual({ open: 1100, won: 40, count: 3 });
    expect(all.total).toEqual({ open: 1100 + 20 + 2000 + 4000 + 8000 + 7, won: 40, count: 8 });
    expect(all.childCount).toBe(3);
    // Es exactamente lo que devuelve la ficha para quien ve todo.
    expect(all).toEqual((await getCompany(w.owner.id, w.parent.id))!.rollup);
  });

  it('un member que solo ve lo suyo: totales, cantidad de deals y de hijas sin nada oculto', async () => {
    const w = await tree();
    expect(w.scope).toEqual([w.mine.id]);
    const scoped = await scopedCompanyRollup(w.owner.id, w.parent.id, w.scope);
    // En la empresa: sus dos deals; el de 1000 de otra persona no suma ni cuenta.
    expect(scoped.own).toEqual({ open: 100, won: 40, count: 2 });
    // En el árbol: su hija y su nieta. La hija oculta no cuenta como hija, y ningún deal
    // colgado de ella entra (ni siquiera el propio, que la nombraría).
    expect(scoped.childCount).toBe(2);
    expect(scoped.total).toEqual({ open: 100 + 20 + 7, won: 40, count: 4 });
    expect(scoped.currency).toBe((await getCompany(w.owner.id, w.parent.id))!.rollup.currency);
  });

  it('la ficha no entrega hijas ni madre que la persona no ve', async () => {
    const w = await tree();
    const detail = scopeCompanyDetail((await getCompany(w.owner.id, w.parent.id))!, w.scope);
    expect(detail.children.map((c) => c.name)).toEqual(['My Child Co']);

    // La nieta es de la persona; su madre (la hija oculta) y su abuela (visible) vienen sin dueño.
    const grand = (await getCompany(w.owner.id, w.grandchild.id))!;
    expect(grand.ancestors.map((a) => a.name)).toEqual(['Hidden Child Co', 'Parent Co']);
    const visible = await visibleRecordIds(
      w.owner.id,
      'crm_companies',
      grand.ancestors.map((a) => a.id),
      w.scope,
    );
    expect([...visible]).toEqual([w.parent.id]);
    expect(visible.has(grand.parent!.id)).toBe(false);
  });

  it('visibleRecordIds: sin restricción devuelve todos; con alcance vacío, ninguno', async () => {
    const w = await tree();
    const ids = [w.parent.id, w.hiddenChild.id, w.hiddenChild.id];
    expect([...(await visibleRecordIds(w.owner.id, 'crm_companies', ids, null))].sort()).toEqual([w.parent.id, w.hiddenChild.id].sort());
    expect((await visibleRecordIds(w.owner.id, 'crm_companies', ids, [])).size).toBe(0);
    expect((await visibleRecordIds(w.owner.id, 'crm_companies', [], w.scope)).size).toBe(0);
    // Un id de otro workspace nunca es visible.
    const stranger = await makeUser('stranger');
    expect((await visibleRecordIds(stranger.id, 'crm_companies', ids, null)).size).toBe(0);
  });
});
