import { NextResponse } from 'next/server';
import { canSeeChat } from '@/lib/groups-access';
import { hubspotConnected } from '@/lib/groups-hubspot';
import { listUnlinkedGroups, suggestCompaniesForGroups } from '@/lib/groups-hubspot-sync';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, strArr } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Grupos de WhatsApp que todavía no tienen una empresa de HubSpot (los que la
 * persona puede ver), con la empresa sugerida por parecido de nombre cuando
 * ya se buscó. ?q= filtra por nombre; ?offset= y ?limit= paginan. Para
 * vincular se usa POST /api/groups/hubspot/links.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  if (s.user.role === 'guest') return groupsError(403, 'forbidden');
  const p = new URL(req.url).searchParams;
  if (!(await hubspotConnected(s.ws))) return NextResponse.json({ connected: false, rows: [], total: 0 });
  const res = await listUnlinkedGroups(s.ws, await sessionViewer(s), { q: p.get('q') ?? '', limit: Number(p.get('limit')) || 25, offset: Number(p.get('offset')) || 0 });
  return NextResponse.json({ connected: true, ...res });
}

/**
 * { chatIds: [hasta 10] }: busca en HubSpot la empresa con el nombre más
 * parecido al de cada grupo y la devuelve como sugerencia. No vincula nada:
 * eso lo confirma una persona.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  if (s.user.role === 'guest') return groupsError(403, 'forbidden');
  const viewer = await sessionViewer(s);
  const ids: string[] = [];
  for (const id of strArr((await readJson(req)).chatIds, 10)) if (await canSeeChat(viewer, id)) ids.push(id);
  try {
    return NextResponse.json({ suggestions: await suggestCompaniesForGroups(s.ws, ids) });
  } catch (err) {
    return handleGroupsError(err);
  }
}
