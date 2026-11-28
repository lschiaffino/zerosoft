/**
 * Social (todavía Próximamente): el selector de personas (cuentas, asignar un
 * ítem del inbox) ofrece solo a quien hoy tiene Social: Social en Miembros,
 * Apps del workspace (simulando que la app ya salió) y los dos pasos si el
 * workspace los pide. Miradas: quien se fue, miembro sin Social, miembro con
 * Social solo para admins, excluido a mano, sin dos pasos, admin y owner.
 * Datos inventados.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductKey } from '@/lib/products';
import { getDb } from '@/lib/db';
import { addMember, removeMember, setMemberApps } from '@/lib/teams';
import { saveWorkspaceAppRule } from '@/lib/workspace-apps';
import { listSocialPeople, type SocialActor } from '@/lib/social';
import { workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

process.env.SOCIAL_FAKE = '1';

const launch = vi.hoisted(() => ({ on: false }));
vi.mock('@/lib/products', async (orig) => {
  const real = await orig<typeof import('@/lib/products')>();
  return { ...real, isComingSoon: (app: ProductKey) => (launch.on && app === 'social' ? false : real.isComingSoon(app)) };
});

afterEach(() => {
  launch.on = false;
});

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const admin = await makeUser(`${label}-admin`);
  await addMember(w.team.id, admin.id, 'admin');
  const leaver = await makeUser(`${label}-leaver`);
  await addMember(w.team.id, leaver.id, 'member');
  await removeMember(w.team.id, leaver.id);
  const owner: SocialActor = { workspaceId: w.owner.id, personId: w.owner.id, role: 'owner' };
  return { w, ws: w.owner.id, admin, leaver, owner };
}

const ids = async (actor: SocialActor) => (await listSocialPeople(actor)).map((p) => p.id).sort();

describe('selector de personas de Social: quien hoy tiene Social', () => {
  it('sin reglas: miembros con Social; ni quien se fue, ni otro workspace, ni quien no tiene Social en Miembros', async () => {
    const s = await setup('spick-base');
    await setMemberApps(s.w.team.id, s.w.friend.id, ['crm']);
    expect(await ids(s.owner)).toEqual([s.ws, s.w.member.id, s.admin.id].sort());
  });

  it('con Social solo para admins (cuando salga): el miembro no; admin y owner sí; un excluido a mano tampoco', async () => {
    const s = await setup('spick-rule');
    launch.on = true;
    await saveWorkspaceAppRule(s.ws, 'social', { mode: 'admins', people: [], teams: [], denied: [] }, s.ws);
    expect(await ids(s.owner)).toEqual([s.ws, s.admin.id].sort());
    await saveWorkspaceAppRule(s.ws, 'social', { mode: 'all', people: [], teams: [], denied: [s.w.friend.id] }, s.ws);
    expect(await ids(s.owner)).toEqual([s.ws, s.w.member.id, s.admin.id].sort());
  });

  it('con dos pasos obligatorios: quien no los tiene no aparece', async () => {
    const s = await setup('spick-mfa');
    await getDb().prepare('UPDATE users SET mfa_enabled_at = ? WHERE id IN (?, ?)').run(new Date().toISOString(), s.w.member.id, s.admin.id);
    await getDb().prepare('UPDATE teams SET require_mfa = 1 WHERE id = ?').run(s.w.team.id);
    expect(await ids(s.owner)).toEqual([s.ws, s.w.member.id, s.admin.id].sort());
  });
});
