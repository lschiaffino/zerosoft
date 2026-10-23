import { NextResponse } from 'next/server';
import { createPropertyDef, deletePropertyDef, listPropertyDefs } from '@/lib/groups';
import { groupsError, groupsSession, handleGroupsError, readJson, str, strArr } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Propiedades propias de chats y grupos (texto, número, opción, fecha). */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ properties: await listPropertyDefs(s.ws) });
}

export async function POST(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    return NextResponse.json(await createPropertyDef(s.ws, { label: str(b.label, 60), type: str(b.type, 10), options: strArr(b.options, 50) }), {
      status: 201,
    });
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
