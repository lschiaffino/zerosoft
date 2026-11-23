/**
 * Import de deals: el aviso de una fila cuyo contacto no se vinculó dice lo
 * que pasó ("no se vinculó") sin afirmar que el email es inválido ni nombrar
 * el contacto que la persona no ve. Miradas: anónimo, otro workspace, miembro
 * con visibilidad "mine", admin y owner. Datos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createContact, createPipeline, createStage } from '@/lib/crm';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { addMember } from '@/lib/teams';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const importRoute = await import('@/app/api/crm/import/route');

beforeEach(() => {
  session.user = null;
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

type ImportOut = { created: number; errors: string[] };

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const adminPerson = await makeUser(`${label}-admin`);
  await addMember(w.team.id, adminPerson.id, 'admin');
  await setMemberVisibility(ws, 'mine');
  const pipeline = await createPipeline(ws, 'Sales');
  await createStage(ws, pipeline.id, { name: 'New' });
  const hidden = await createContact(ws, { firstName: 'Reserved', lastName: 'Buyer', email: `buyer-${label}@client.test`, ownerId: ws });
  return { w, ws, adminPerson, hidden };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function importDealsAs(user: SessionUser | null, rows: Array<Record<string, string>>): Promise<{ status: number; body: ImportOut | null }> {
  session.user = user;
  const res = await importRoute.POST(
    new NextRequest('http://localhost/api/crm/import', {
      method: 'POST',
      body: JSON.stringify({ entity: 'deals', mode: 'skip', rows }),
      headers: { 'content-type': 'application/json' },
    }),
  );
  return { status: res.status, body: res.status === 200 ? ((await res.json()) as ImportOut) : null };
}

const dealContacts = async (ws: string, name: string) =>
  (await getDb()
    .prepare('SELECT dc.contact_id FROM crm_deals d JOIN crm_deal_contacts dc ON dc.deal_id = d.id WHERE d.user_id = ? AND d.name = ?')
    .all(ws, name)) as Array<{ contact_id: string }>;

describe('import de deals: aviso del contacto que no se vinculó', () => {
  it('anónimo no importa', async () => {
    expect((await importDealsAs(null, [{ name: 'X', contactEmail: 'a@client.test' }])).status).toBe(401);
  });

  it('miembro: el email de un contacto que no ve no se vincula y el aviso no dice que es inválido ni lo nombra', async () => {
    const s = await setup('imp-mem');
    const member = asMember(s.w.owner, s.w.member);
    const { body } = await importDealsAs(member, [
      { name: 'Deal one', contactEmail: s.hidden.email },
      { name: 'Deal two', contactEmail: `${s.hidden.email}; fresh-imp-mem@client.test` },
      { name: 'Deal three', contactEmail: 'not an email' },
    ]);
    expect(body?.created).toBe(3);
    const errors = body?.errors ?? [];
    expect(errors).toContain(`Row 1: contact "${s.hidden.email}" not linked`);
    expect(errors).toContain(`Row 2: contact "${s.hidden.email}" not linked`);
    expect(errors.some((e) => e.startsWith('Row 1: no valid email'))).toBe(false);
    expect(errors.some((e) => e.startsWith('Row 3: no valid email'))).toBe(true);
    const text = JSON.stringify(body);
    expect(text).not.toContain(s.hidden.id);
    expect(text).not.toContain('Reserved');
    expect(await dealContacts(s.ws, 'Deal one')).toEqual([]);
    // El nuevo sí se crea y se vincula.
    expect(await dealContacts(s.ws, 'Deal two')).toHaveLength(1);
  });

  it('owner y admin vinculan el contacto existente sin aviso', async () => {
    const s = await setup('imp-own');
    for (const [user, name] of [
      [asOwner(s.w.owner), 'Owner deal'],
      [asMember(s.w.owner, s.adminPerson, 'admin'), 'Admin deal'],
    ] as const) {
      const { body } = await importDealsAs(user, [{ name, contactEmail: s.hidden.email }]);
      expect(body?.errors).toEqual([]);
      expect(await dealContacts(s.ws, name)).toEqual([{ contact_id: s.hidden.id }]);
    }
  });

  it('otro workspace importa en el suyo: no toca ni nombra el contacto de este', async () => {
    const s = await setup('imp-other');
    const theirs = await createPipeline(s.w.stranger.id, 'Theirs');
    await createStage(s.w.stranger.id, theirs.id, { name: 'New' });
    const { body } = await importDealsAs(asOwner(s.w.stranger), [{ name: 'Their deal', contactEmail: s.hidden.email }]);
    expect(body?.errors).toEqual([]);
    const linked = await dealContacts(s.w.stranger.id, 'Their deal');
    expect(linked).toHaveLength(1);
    expect(linked[0].contact_id).not.toBe(s.hidden.id);
  });
});
