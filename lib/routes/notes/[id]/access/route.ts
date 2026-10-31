import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner } from '@/lib/notes';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';
import { z } from 'zod';
import { decideAccessRequest, listAccessRequests, noteAccessGate, requestNoteAccess } from '@/lib/notes-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Pedidos pendientes (solo el dueño). */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const requests = await listAccessRequests(noteOwner(user), id);
  if (!requests) return jsonError(404, 'not_found');
  return NextResponse.json({ requests });
}

/** Pedir acceso a una nota del workspace que no se puede abrir. */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:share', owner.personId, 30);
  if (limited) return limited;
  if (!(await requestNoteAccess(owner, id))) return jsonError(404, 'not_found');
  return NextResponse.json(await noteAccessGate(owner, id));
}

const decideSchema = z.object({ request_id: z.string().min(1).max(64), role: z.enum(['view', 'edit']).nullable() });

/** Aprobar con un rol o rechazar (role null). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:share', owner.personId, 60);
  if (limited) return limited;
  const parsed = decideSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const res = await decideAccessRequest(owner, id, parsed.data.request_id, parsed.data.role);
  if (res !== 'ok') return jsonError(res === 'not_found' ? 404 : 400, res);
  return NextResponse.json({ requests: await listAccessRequests(owner, id) });
}
