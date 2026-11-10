import { NextResponse } from 'next/server';
import {
  HUBSPOT_TYPES,
  chatHubspot,
  dismissHubspotSuggestion,
  linkHubspot,
  redactHubspot,
  unlinkHubspot,
  type ChatHubspotDto,
  type HubspotType,
} from '@/lib/groups-hubspot';
import { chatGuard, groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const typeOf = (v: unknown): HubspotType | undefined => HUBSPOT_TYPES.find((k) => k === v);

function redact(mask: boolean, dto: ChatHubspotDto): ChatHubspotDto {
  return {
    ...dto,
    links: dto.links.map((l) => redactHubspot(mask, l)),
    suggestions: dto.suggestions.map((sg) => ({ contact: redactHubspot(mask, sg.contact), company: sg.company })),
  };
}

/**
 * ?chat=<id>: la empresa, el negocio y el contacto de HubSpot vinculados a un
 * chat o grupo (con dueño, etapa y link al registro) y, para un chat 1 a 1 sin
 * contacto, los contactos de HubSpot con ese teléfono.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const chatId = new URL(req.url).searchParams.get('chat') ?? '';
  const guard = await chatGuard(s, chatId);
  if (guard instanceof NextResponse) return guard;
  try {
    return NextResponse.json(redact(guard.viewer.mask, await chatHubspot(s.ws, chatId)));
  } catch (err) {
    return handleGroupsError(err);
  }
}

/**
 * { chatId, type: company|deal|contact, objectId, withCompany? }: vincula el
 * chat a ese registro de HubSpot (reemplaza el del mismo tipo). Con
 * withCompany, un contacto trae su empresa principal. { chatId, dismiss: true }
 * descarta el contacto sugerido por teléfono.
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
    if (b.dismiss === true) {
      await dismissHubspotSuggestion(s.ws, chatId);
      return NextResponse.json({ ok: true });
    }
    const type = typeOf(b.type);
    if (!type) return groupsError(400, 'invalid_input');
    const links = await linkHubspot(s.ws, s.me, chatId, type, str(b.objectId, 30) ?? '', { withCompany: b.withCompany === true });
    return NextResponse.json({ links: links.map((l) => redactHubspot(guard.viewer.mask, l)) });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** ?chat=<id>&type=company|deal|contact: quita ese vínculo del chat. En HubSpot no se borra nada. */
export async function DELETE(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  if (s.user.role === 'guest') return groupsError(403, 'forbidden');
  const p = new URL(req.url).searchParams;
  const chatId = p.get('chat') ?? '';
  const guard = await chatGuard(s, chatId);
  if (guard instanceof NextResponse) return guard;
  const type = typeOf(p.get('type'));
  if (!type) return groupsError(400, 'invalid_input');
  try {
    return (await unlinkHubspot(s.ws, chatId, type)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
  } catch (err) {
    return handleGroupsError(err);
  }
}
