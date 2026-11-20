import { NextResponse } from 'next/server';
import { createHubspotTicket, hubspotTicketPipelines } from '@/lib/groups-hubspot-tickets';
import { chatGuard, groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ?chat=<id>: los pipelines de tickets de HubSpot con sus etapas, para el formulario "Crear ticket en HubSpot". */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const guard = await chatGuard(s, new URL(req.url).searchParams.get('chat') ?? '');
  if (guard instanceof NextResponse) return guard;
  try {
    return NextResponse.json({ pipelines: await hubspotTicketPipelines(s.ws) });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/**
 * { chatId, subject, content?, priority?, pipeline?, stage?, ticketId? }: crea
 * un ticket en HubSpot asociado a la empresa, el contacto y el negocio
 * vinculados al chat. Con ticketId (un ticket de Lines del chat) guarda el
 * vínculo y no lo crea dos veces.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  if (s.user.role === 'guest') return groupsError(403, 'forbidden');
  const b = await readJson(req);
  const chatId = str(b.chatId, 100) ?? '';
  const guard = await chatGuard(s, chatId);
  if (guard instanceof NextResponse) return guard;
  try {
    const res = await createHubspotTicket(s.ws, chatId, {
      subject: str(b.subject, 300) ?? '',
      content: typeof b.content === 'string' ? b.content.slice(0, 10_000) : '',
      priority: str(b.priority, 10) ?? '',
      pipeline: str(b.pipeline, 60) ?? '',
      stage: str(b.stage, 60) ?? '',
      linesTicketId: str(b.ticketId, 100) ?? undefined,
    });
    return NextResponse.json(res, { status: res.created ? 201 : 200 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
