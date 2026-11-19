import { NextResponse } from 'next/server';
import { getSelectedLine, setSelectedLine } from '@/lib/groups-lines';
import { groupsSession, handleGroupsError, readJson, sessionViewer, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Preferencias de la bandeja de quien mira: la línea elegida, 'g:<id>' (un grupo de líneas) o 'all' (todas). */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ line: await getSelectedLine(await sessionViewer(s)) });
}

/** { line: <id de línea> | 'g:<id de grupo>' | 'all' }: se recuerda por persona. Una línea que no ve, o un grupo donde no ve ninguna, da 404. */
export async function PUT(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    return NextResponse.json({ line: await setSelectedLine(await sessionViewer(s), str(b.line, 100) || 'all') });
  } catch (err) {
    return handleGroupsError(err);
  }
}
