import { NextResponse } from 'next/server';
import { groupsSession, readJson } from '@/lib/groups-http';
import { internalGet, internalPatch, internalPost } from '@/lib/internal-contacts-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Contactos internos del workspace (lib/internal-contacts.ts): ajustes y lista. Solo admins. */
export async function GET() {
  const s = await groupsSession({ admin: true });
  if (s instanceof NextResponse) return s;
  return internalGet(s.ws, s.me, s.user.role);
}

/** { lines?, domains? }: la regla del workspace. */
export async function PATCH(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  return internalPatch(s.ws, s.me, s.user.role, await readJson(req));
}

/** { handle | ref, internal: true | false | null, name? }: marca un contacto (o le saca la marca). */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  return internalPost(s.ws, s.me, s.user.role, await readJson(req));
}
