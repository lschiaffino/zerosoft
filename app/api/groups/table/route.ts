import { NextResponse } from 'next/server';
import { groupsSession, handleGroupsError, sessionViewer } from '@/lib/groups-http';
import { conditionalJson } from '@/lib/etag';
import { linesFiltersFromParam } from '@/lib/groups-filters';
import { cleanHsColumns, listGroupsTable } from '@/lib/groups-table';

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
