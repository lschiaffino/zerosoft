import { NextResponse } from 'next/server';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str, strArr } from '@/lib/groups-http';
import { conditionalJson } from '@/lib/etag';
import { linesFiltersFromParam } from '@/lib/groups-filters';
import { cleanHsColumns, listGroupsTable, setGroupChats, setGroupProperty } from '@/lib/groups-table';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lines › Grupos: la tabla de grupos. Una fila por grupo de WhatsApp aunque
 * esté en varias líneas, con las líneas donde está (solo las que quien mira
 * ve), su empresa de HubSpot con el link y los valores de las propiedades de
 * la empresa pedidas en ?hs=name1,name2. ?f=<JSON> son los filtros del panel
 * (lib/groups-filters.ts; ?f={"lines":[...]} filtra por una o varias líneas),
 * ?status=open|closed (sin esto, los dos), ?q= busca y ?tz= (minutos al este de UTC) dice dónde empieza "hoy".
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const p = new URL(req.url).searchParams;
  const tz = Number(p.get('tz'));
  try {
    const dto = await listGroupsTable(s.ws, s.me, await sessionViewer(s), {
      filters: linesFiltersFromParam(p.get('f')),
      status: (p.get('status') ?? '').split(',').filter((x): x is 'open' | 'closed' => x === 'open' || x === 'closed'),
      q: (p.get('q') ?? '').slice(0, 200),
      tzOffsetMin: Number.isFinite(tz) ? tz : 0,
      hs: cleanHsColumns(p.get('hs') ?? ''),
    });
    return conditionalJson(req, dto);
  } catch (err) {
    return handleGroupsError(err);
  }
}

/**
 * Edición en la celda: { chatIds, key, value } pone el valor de una propiedad
 * de zerosoft en los chats del grupo (uno por línea) que quien edita ve.
 * { chatIds, labelIds } o { chatIds, status } cambian las etiquetas o el
 * estado (abierto o cerrado) de esos chats. Las propiedades de la empresa de
 * HubSpot se editan por PATCH /api/groups/hubspot/company.
 */
export async function PATCH(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  if (s.user.role === 'guest') return groupsError(403, 'forbidden');
  const b = await readJson(req);
  if (Array.isArray(b.labelIds) || b.status !== undefined) {
    if (b.status !== undefined && b.status !== 'open' && b.status !== 'closed') return groupsError(400, 'invalid_input');
    try {
      return NextResponse.json(
        await setGroupChats(s.ws, s.me, await sessionViewer(s), strArr(b.chatIds, 20), {
          ...(Array.isArray(b.labelIds) ? { labelIds: strArr(b.labelIds, 20) } : {}),
          ...(b.status === 'open' || b.status === 'closed' ? { status: b.status } : {}),
        }),
      );
    } catch (err) {
      return handleGroupsError(err);
    }
  }
  const key = str(b.key, 40) ?? '';
  if (!/^[a-z0-9_]{1,40}$/.test(key)) return groupsError(400, 'invalid_input');
  try {
    return NextResponse.json(await setGroupProperty(s.ws, s.me, await sessionViewer(s), strArr(b.chatIds, 20), key, b.value));
  } catch (err) {
    return handleGroupsError(err);
  }
}
