import { NextResponse } from 'next/server';
import { connectNumber, disconnectNumber, getNumberRow, refreshNumber, syncGroups } from '@/lib/groups';
import { groupsError, groupsSession, handleGroupsError } from '@/lib/groups-http';
import { getImportStatus, kickImport, reimport } from '@/lib/groups-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Estado de la conexión (y el QR mientras espera el escaneo). La pantalla lo consulta cada pocos segundos. */
export async function GET(_req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  // El QR vincula el número: solo lo ven los admins. Los demás ven el último estado guardado, sin consultar al proveedor.
  if (!s.isAdmin) {
    const row = await getNumberRow(s.ws, id);
    if (!row) return groupsError(404, 'not_found');
    return NextResponse.json({ status: row.status, phone: row.phone || undefined, import: await getImportStatus(s.ws, id) });
  }
  try {
    const state = await refreshNumber(s.ws, id);
    const imp = await getImportStatus(s.ws, id);
    // Mientras la pantalla mira el progreso, la importación avanza sin esperar al cron (claim por fila: no se pisa).
    if (imp && (imp.status === 'queued' || imp.status === 'running')) await kickImport(id);
    return NextResponse.json({ ...state, import: imp });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** { action: 'connect' | 'disconnect' | 'sync' | 'import' }. Conectar registra el webhook en el proveedor. */
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
    // Reimportar chats y mensajes desde el historial del gateway (lo que ya está no se duplica).
    if (body.action === 'import') {
      const st = await reimport(s.ws, id, (body as { perChat?: number }).perChat);
      if (!st) return groupsError(400, 'import_unsupported');
      return NextResponse.json({ import: st });
    }
    return NextResponse.json(await connectNumber(s.ws, id, new URL(req.url).origin));
  } catch (err) {
    return handleGroupsError(err);
  }
}
