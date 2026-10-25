import { NextResponse } from 'next/server';
import { createPropertyDef, deletePropertyDef, listPropertyDefs, updatePropertyDef } from '@/lib/groups';
import { groupsError, groupsSession, handleGroupsError, readJson, str, strArr } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const scopeOf = (v: unknown) => (v === 'ticket' ? 'ticket' : 'chat');

/**
 * Propiedades propias de chats y grupos (?scope=chat) y campos propios de
 * los tickets (?scope=ticket): texto, número, opción, multiselección,
 * fecha, casilla, URL, archivo y desplegable dependiente.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ properties: await listPropertyDefs(s.ws, scopeOf(new URL(req.url).searchParams.get('scope'))) });
}

/** { label, type, options?, tree? (texto con sangría o árbol), scope?, required? } */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    return NextResponse.json(
      await createPropertyDef(s.ws, {
        label: str(b.label, 60),
        type: str(b.type, 12),
        options: strArr(b.options, 100),
        tree: typeof b.tree === 'string' ? b.tree.slice(0, 20_000) : b.tree,
        scope: scopeOf(b.scope),
        required: b.required === true,
      }),
      { status: 201 },
    );
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** { id, label?, options?, tree?, required? }: la clave no cambia. */
export async function PATCH(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    return NextResponse.json(
      await updatePropertyDef(s.ws, str(b.id, 100) ?? '', {
        label: str(b.label, 60),
        options: Array.isArray(b.options) ? strArr(b.options, 100) : undefined,
        tree: typeof b.tree === 'string' ? b.tree.slice(0, 20_000) : b.tree,
        required: typeof b.required === 'boolean' ? b.required : undefined,
      }),
    );
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** ?id=<id> */
export async function DELETE(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  return (await deletePropertyDef(s.ws, id)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}
