/**
 * CRM, bloque C4: anchos de columna de los índices (contactos, empresas,
 * deals), guardados en la URL y con la vista (`widths`). Lo que se prueba:
 * cómo se leen y escriben, que una vista compartida no nombra el ancho de una
 * propiedad oculta para quien la abre y quién ve una vista con anchos. Los
 * datos son inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCustomField } from '@/lib/crm';
import { getDb } from '@/lib/db';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  clampColumnWidth,
  parseWidths,
  pickViewState,
  redactViewQuery,
  resolveViewState,
  serializeWidths,
} from '@/lib/crm-views-shared';
import { CHECK_COLUMN_WIDTH, DEFAULT_COLUMN_WIDTH, INDEX_TABLES } from '@/components/crm/tableColumns';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, roles, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/server', async (orig) => ({ ...((await orig()) as object), after: () => undefined }));

const viewsRoute = await import('@/app/api/crm/views/route');
const viewRoute = await import('@/lib/routes/crm/views/[id]/route');

beforeEach(() => {
  session.user = null;
});

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

interface ViewOut {
  id: string;
  query: Record<string, string>;
}

async function create(user: SessionUser | null, body: Record<string, unknown>): Promise<Response> {
  session.user = user;
  return viewsRoute.POST(json('http://x/api/crm/views', 'POST', { entity: 'contacts', name: 'Anchos', ...body }));
}

async function list(user: SessionUser | null): Promise<ViewOut[] | null> {
  session.user = user;
  const res = await viewsRoute.GET(new NextRequest('http://x/api/crm/views?entity=contacts'));
  if (!res.ok) return null;
  return ((await res.json()) as { rows: ViewOut[] }).rows;
}

describe('anchos: lectura y escritura', () => {
  it('id:px separados por coma; el id de una propiedad propia lleva dos puntos', () => {
    expect(parseWidths('email:240,custom:plan:180,name:300')).toEqual({ email: 240, 'custom:plan': 180, name: 300 });
    expect(serializeWidths({ email: 240, 'custom:plan': 180 })).toBe('email:240,custom:plan:180');
    expect(parseWidths(serializeWidths({ name: 260, 'custom:x-y_1': 90 }))).toEqual({ name: 260, 'custom:x-y_1': 90 });
  });

  it('cada ancho queda entre el mínimo y el máximo; lo que no tiene forma de ancho se descarta', () => {
    expect(parseWidths('email:10,phone:99999,name:abc,:120,bad col:100,company:-5,owner:160,owner:300')).toEqual({
      email: MIN_COLUMN_WIDTH,
      owner: 160,
    });
    expect(clampColumnWidth(5000)).toBe(MAX_COLUMN_WIDTH);
    expect(clampColumnWidth(120.6)).toBe(121);
    expect(parseWidths('')).toEqual({});
    expect(parseWidths(null)).toEqual({});
    expect(serializeWidths({ 'no valid': 100, email: Number.NaN })).toBe('');
  });

  it('pickViewState guarda los anchos limpios; la URL gana sobre la vista y cambiarlos la deja modificada', () => {
    expect(pickViewState('contacts', { widths: 'email:240,junk,phone:5' })).toEqual({ widths: `email:240,phone:${MIN_COLUMN_WIDTH}` });
    expect(pickViewState('deals', { widths: 'amount:120' })).toEqual({ widths: 'amount:120' });
    expect(pickViewState('companies', { widths: 'garbage' })).toEqual({});
    const view = { cols: 'name,email', widths: 'email:240' };
    expect(resolveViewState('contacts', { sv: 'v1' }, view)).toEqual({ state: view, modified: false });
    expect(resolveViewState('contacts', { sv: 'v1', widths: 'email:300' }, view)).toEqual({
      state: { cols: 'name,email', widths: 'email:300' },
      modified: true,
    });
  });

  it('redactViewQuery quita el ancho de una columna oculta (ni su nombre queda)', () => {
    const out = redactViewQuery({ widths: 'name:260,custom:salary:200,custom:plan:120' }, new Set(['salary']));
    expect(out).toEqual({ widths: 'name:260,custom:plan:120' });
    expect(redactViewQuery({ widths: 'custom:salary:200' }, new Set(['salary']))).toEqual({});
  });

  it('las tres tablas tienen columnas propias y la del nombre primero', () => {
    for (const spec of Object.values(INDEX_TABLES)) {
      expect(spec.columns[0].id).toBe('name');
      expect(new Set(spec.columns.map((c) => c.id)).size).toBe(spec.columns.length);
    }
    expect(CHECK_COLUMN_WIDTH).toBeGreaterThan(0);
    expect(DEFAULT_COLUMN_WIDTH).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
  });
});

describe('anchos guardados con la vista: quién ve qué', () => {
  it('anónimo, otro workspace, compañero y owner', async () => {
    const w = await workspaceWithMember('c4w');
    const view = (await (await create(asOwner(w.owner), { visibility: 'everyone', query: { widths: 'name:280,email:220' } })).json()) as ViewOut;
    expect(view.query.widths).toBe('name:280,email:220');
    for (const r of roles(w)) {
      const rows = await list(r.user);
      if (r.name === 'anonymous') {
        expect(rows).toBeNull();
        continue;
      }
      const seen = rows?.find((v) => v.id === view.id);
      if (r.name === 'other_workspace') expect(seen).toBeUndefined();
      else expect(seen?.query.widths).toBe('name:280,email:220');
    }
    // Una privada de otra persona no se ve, tampoco sus anchos.
    const mine = (await (await create(asMember(w.owner, w.member), { visibility: 'private', query: { widths: 'phone:150' } })).json()) as ViewOut;
    const friendRows = await list(asMember(w.owner, w.friend));
    expect(friendRows?.some((v) => v.id === mine.id)).toBe(false);
    session.user = asOwner(w.stranger);
    expect((await viewRoute.GET(new NextRequest('http://x'), ctx(mine.id))).status).toBe(404);
  });

  it('un member con una propiedad oculta no ve su ancho ni lo guarda', async () => {
    const w = await workspaceWithMember('c4h');
    const field = await createCustomField(w.owner.id, { entity: 'contacts', name: 'salary', label: 'Salary', type: 'number' });
    await createCustomField(w.owner.id, { entity: 'contacts', name: 'plan', label: 'Plan', type: 'text' });
    await setFieldPermissions(w.owner.id, field.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);

    const view = (await (
      await create(asOwner(w.owner), { visibility: 'everyone', query: { cols: 'name,custom:salary,custom:plan', widths: 'name:260,custom:salary:200,custom:plan:120' } })
    ).json()) as ViewOut;
    // El owner (y un admin) ven todo.
    expect(view.query.widths).toBe('name:260,custom:salary:200,custom:plan:120');

    const member = asMember(w.owner, w.member);
    const seen = (await list(member))!.find((v) => v.id === view.id)!;
    expect(seen.query.widths).toBe('name:260,custom:plan:120');
    session.user = member;
    const body = JSON.stringify(await (await viewRoute.GET(new NextRequest('http://x'), ctx(view.id))).json());
    expect(body).not.toContain('salary');

    const own = (await (await create(member, { query: { widths: 'custom:salary:300,custom:plan:140' } })).json()) as ViewOut;
    const raw = (await getDb().prepare('SELECT query FROM crm_saved_views WHERE id = ?').get(own.id)) as { query: string };
    expect(JSON.parse(raw.query)).toEqual({ widths: 'custom:plan:140' });
  });
});
