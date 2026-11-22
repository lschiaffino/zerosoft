import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { GroupsError } from '@/lib/groups';
import { parseWorkflowBody, sendFromHubspotWorkflow } from '@/lib/groups-hubspot-workflow';
import { v1Error, v1Json, v1Viewer } from '@/lib/groups-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/groups/hubspot/send: la acción "Send a webhook" de un workflow
 * de HubSpot. Manda `text` (admite {{propiedad}}) a los chats y grupos
 * vinculados al registro (companyId, dealId, contactId, o el cuerpo estándar
 * de HubSpot con objectId y propiedades) o al chat 1:1 con ese teléfono.
 * El texto y el destino también pueden ir en la URL (?text=&to=groups|dm&line=).
 * Ver lib/groups-hubspot-workflow.ts.
 */
export async function POST(req: Request) {
  const auth = await requireApiUser(req, 'groups:write');
  if ('res' in auth) return auth.res;
  const input = parseWorkflowBody(await v1Json(req), new URL(req.url).searchParams);
  if (!input.text) return apiError(400, 'invalid_input', 'text is required (in the body or as ?text=).');
  if (!input.objectId && !input.phone) return apiError(400, 'invalid_input', 'Send companyId, dealId, contactId, objectId or phone.');
  try {
    const res = await sendFromHubspotWorkflow(await v1Viewer(auth), auth.personId, input);
    return NextResponse.json({ data: res }, { status: res.sent.some((x) => !x.duplicate) ? 201 : 200 });
  } catch (err) {
    if (err instanceof GroupsError && err.code === 'no_chat') return apiError(404, 'no_chat', 'No chat in Lines is linked to that HubSpot record or phone, or this key cannot see it.');
    if (err instanceof GroupsError && err.code === 'empty_message') return apiError(400, 'empty_message', 'The message is empty after filling in the properties.');
    return v1Error(err);
  }
}
