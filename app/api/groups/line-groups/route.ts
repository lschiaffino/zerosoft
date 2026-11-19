import { NextResponse } from 'next/server';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str, strArr } from '@/lib/groups-http';
import {
  createLineGroup,
  deleteLineGroup,
  getPersonLineAccess,
  listLineGroups,
  reorderLineGroups,
  setPersonLineAccess,
  updateLineGroup,
} from '@/lib/groups-line-groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Grupos de líneas. Cualquiera del workspace recibe los grupos donde ve alguna
 * línea (nombre y esas líneas). Un admin recibe todos, con a quién se le dio
 * cada uno; con `?person=<id>`, además lo que esa persona tiene dado a su nombre.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const groups = await listLineGroups(s.ws, await sessionViewer(s));
  const person = new URL(req.url).searchParams.get('person');
  if (!person) return NextResponse.json({ groups });
  if (!s.isAdmin) return groupsError(403, 'forbidden');
  return NextResponse.json({ groups, person: await getPersonLineAccess(s.ws, person.slice(0, 100)) });
}

/** { name }: crea un grupo. Solo admins. */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    return NextResponse.json(await createLineGroup(s.ws, s.me, { name: str(b.name, 200) }), { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/**
 * Solo admins. Tres formas:
 * - { id, name?, numberIds?, personIds?, teamIds? }: cambia un grupo.
 * - { order: [ids] }: el orden de los grupos.
 * - { personId, groupIds?, numberIds? }: lo que una persona tiene dado a su nombre.
 * Devuelve los grupos como quedaron.
 */
export async function PATCH(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    const personId = str(b.personId, 100);
    const id = str(b.id, 100);
    if (personId) {
      await setPersonLineAccess(s.ws, personId, {
        ...('groupIds' in b ? { groupIds: strArr(b.groupIds, 100) } : {}),
        ...('numberIds' in b ? { numberIds: strArr(b.numberIds, 200) } : {}),
      });
    } else if (id) {
      await updateLineGroup(s.ws, id, {
        ...('name' in b ? { name: str(b.name, 200) } : {}),
        ...('numberIds' in b ? { numberIds: strArr(b.numberIds, 200) } : {}),
        ...('personIds' in b ? { personIds: strArr(b.personIds, 200) } : {}),
        ...('teamIds' in b ? { teamIds: strArr(b.teamIds, 100) } : {}),
      });
    } else if ('order' in b) {
      await reorderLineGroups(s.ws, strArr(b.order, 100));
    } else return groupsError(400, 'invalid_request');
    const groups = await listLineGroups(s.ws, await sessionViewer(s));
    return NextResponse.json(personId ? { groups, person: await getPersonLineAccess(s.ws, personId) } : { groups });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** ?id=: borra el grupo. Las líneas quedan sin grupo. Solo admins. */
export async function DELETE(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  return (await deleteLineGroup(s.ws, id.slice(0, 100))) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}
