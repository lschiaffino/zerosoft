import { NextResponse } from 'next/server';
import { connectNumber, disconnectNumber, refreshNumber, syncGroups } from '@/lib/groups';
import { groupsSession, handleGroupsError } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Estado de la conexión (y el QR mientras espera el escaneo). La pantalla lo consulta cada pocos segundos. */
export async function GET(_req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  try {
    return NextResponse.json(await refreshNumber(s.ws, (await ctx.params).id));
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** { action: 'connect' | 'disconnect' | 'sync' }. Conectar registra el webhook en el proveedor. */
export async function POST(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  try {
    if (body.action === 'disconnect') {
      await disconnectNumber(s.ws, id);
      return NextResponse.json({ status: 'disconnected' });
    }
    if (body.action === 'sync') return NextResponse.json(await syncGroups(s.ws, id));
    return NextResponse.json(await connectNumber(s.ws, id, new URL(req.url).origin));
  } catch (err) {
    return handleGroupsError(err);
  }
}
