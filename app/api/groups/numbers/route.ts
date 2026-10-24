import { NextResponse } from 'next/server';
import { availableProviders, createNumber, listNumbers } from '@/lib/groups';
import { groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Números del workspace (sin credenciales) y los proveedores disponibles. */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ numbers: await listNumbers(s.ws), providers: availableProviders(), canEdit: s.isAdmin });
}

/** Agrega un número (admins). Las credenciales se guardan cifradas. */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  try {
    const config = body.config && typeof body.config === 'object' ? (body.config as Record<string, unknown>) : {};
    const number = await createNumber(s.ws, s.me, { name: str(body.name, 80), provider: str(body.provider, 20) ?? '', config });
    return NextResponse.json(number, { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
