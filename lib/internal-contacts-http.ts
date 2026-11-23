/**
 * Contactos internos (lib/internal-contacts.ts): lo que responden las rutas de
 * Lines (/api/groups/internal) y de Inbox (/api/inbox/internal). Las dos piden
 * la sesión (y admin para leer la lista y cambiarla) antes de llegar acá; esto
 * solo arma la respuesta. El workspace es siempre el de la sesión.
 */
import { NextResponse } from 'next/server';
import { groupsViewer } from './groups-access';
import type { TeamRole } from './teams';
import {
  InternalContactError,
  getInternalSettings,
  handleForRef,
  listInternalContacts,
  normalizeHandle,
  setInternalContact,
  updateInternalSettings,
} from './internal-contacts';

const NO_STORE = { 'cache-control': 'private, no-store' };

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/** Los ajustes y la lista; los teléfonos van ocultos para quien tiene los números ocultos en Lines. */
export async function internalState(ws: string, me: string, role: TeamRole) {
  const viewer = await groupsViewer(ws, me, role);
  const [settings, contacts] = await Promise.all([getInternalSettings(ws), listInternalContacts(ws, { mask: viewer.mask })]);
  return { settings, contacts, masked: viewer.mask };
}

export async function internalGet(ws: string, me: string, role: TeamRole): Promise<NextResponse> {
  return NextResponse.json(await internalState(ws, me, role), { headers: NO_STORE });
}

/** { lines?: boolean, domains?: string[] } */
export async function internalPatch(ws: string, me: string, role: TeamRole, body: Record<string, unknown>): Promise<NextResponse> {
  const patch: { lines?: boolean; domains?: string[] } = {};
  if (typeof body.lines === 'boolean') patch.lines = body.lines;
  if (Array.isArray(body.domains)) patch.domains = body.domains.filter((d): d is string => typeof d === 'string').slice(0, 50);
  if (!Object.keys(patch).length) return fail(400, 'invalid_input');
  await updateInternalSettings(ws, patch);
  return internalGet(ws, me, role);
}

/**
 * { handle | ref, internal: true | false | null, name? }: marca un teléfono o correo como interno, como "no interno"
 * (la excepción a la regla), o le saca la marca (null). `ref` es la referencia de la lista (para quien no ve el número).
 */
export async function internalPost(ws: string, me: string, role: TeamRole, body: Record<string, unknown>): Promise<NextResponse> {
  const internal = body.internal === true ? true : body.internal === false ? false : body.internal === null ? null : undefined;
  if (internal === undefined) return fail(400, 'invalid_input');
  let handle: string | null = null;
  if (typeof body.ref === 'string') handle = await handleForRef(ws, body.ref.slice(0, 40));
  else if (typeof body.handle === 'string') handle = normalizeHandle(body.handle.slice(0, 320));
  if (!handle) return fail(400, 'invalid_handle');
  try {
    await setInternalContact(ws, me, handle, internal, typeof body.name === 'string' ? body.name.slice(0, 200) : '');
  } catch (err) {
    if (err instanceof InternalContactError) return fail(err.status, err.code);
    throw err;
  }
  return internalGet(ws, me, role);
}
