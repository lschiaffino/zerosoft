import { iJson, withOwner } from '@/lib/inbox/http';
import { inboxHubspotScope } from '@/lib/inbox/contacts-http';
import { inboxThreadContact } from '@/lib/inbox/contacts';
import { companyById, type ChatCompanyDto } from '@/lib/groups-hubspot-sync';
import { contactDealId, hubspotObjectDto, isHubspotObjectType } from '@/lib/hubspot-objects';
import { limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 'company' (sin el parámetro), 'contact' o 'deal'; null si es otra cosa. */
const typeOf = (raw: unknown) => (raw === undefined || raw === null || raw === '' || raw === 'company' ? 'company' : isHubspotObjectType(raw) ? raw : null);

/**
 * La empresa de HubSpot del contacto de un chat 1:1 de Inbox (la del contacto
 * vinculado a esa persona en el workspace activo), con todas sus propiedades,
 * para el panel de HubSpot. Con `type`: el contacto mismo o su negocio (el
 * más nuevo que HubSpot le asocia). Solo lectura: las propiedades se editan
 * desde Lines. Un invitado no usa HubSpot.
 */
async function load(owner: string, threadId: string, type: 'company' | 'contact' | 'deal', refresh: 'missing' | 'stale' | 'force') {
  const scope = await inboxHubspotScope();
  if (!scope) return iJson({ error: 'forbidden' }, 403);
  const { row } = await inboxThreadContact(owner, scope, threadId.slice(0, 64));
  const empty: ChatCompanyDto = { connected: Boolean(row.hubspot), company: null, values: {}, times: {}, syncedAt: null, refreshError: '', canWrite: false, log: [] };
  if (type === 'company') {
    const companyId = row.hubspot?.company?.id ?? '';
    return { dto: companyId ? await companyById(scope.ws, companyId, { refresh, mask: scope.mask }) : empty, res: null };
  }
  const contact = row.hubspot?.contact ?? null;
  if (!contact) return { dto: empty, res: null };
  const id = type === 'contact' ? contact.id : await contactDealId(scope.ws, contact.id);
  if (!id) return { dto: empty, res: null };
  const dto = await hubspotObjectDto(scope.ws, type, id, { refresh: refresh === 'force' ? 'force' : 'cache', mask: scope.mask, name: type === 'contact' ? contact.name : '' });
  return { dto, res: null };
}

/**
 * ?thread=<id>[&fresh=1][&type=contact|deal]: sin `fresh` solo se lee de
 * HubSpot si la empresa nunca se leyó (la tarjeta del chat); con `fresh`, si
 * la copia tiene más de un minuto (el panel). El contacto y el negocio se
 * leen de HubSpot y sirven un minuto.
 */
export async function GET(req: Request) {
  return withOwner(async (owner) => {
    const sp = new URL(req.url).searchParams;
    const type = typeOf(sp.get('type'));
    if (!type) return iJson({ error: 'invalid_input' }, 400);
    const out = await load(owner, sp.get('thread') ?? '', type, sp.get('fresh') === '1' ? 'stale' : 'missing');
    if (!('dto' in out)) return out;
    return iJson({ ...out.dto, canEdit: false });
  });
}

/** { threadId, type? }: "Sincronizar ahora". */
export async function POST(req: Request) {
  return withOwner(async (owner) => {
    const limited = await limitWrites('inbox', owner);
    if (limited) return limited;
    const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const type = typeOf(b.type);
    if (!type) return iJson({ error: 'invalid_input' }, 400);
    const out = await load(owner, typeof b.threadId === 'string' ? b.threadId : '', type, 'force');
    if (!('dto' in out)) return out;
    if (out.dto.refreshError) return iJson({ error: out.dto.refreshError }, out.dto.refreshError === 'hubspot_rate_limited' ? 429 : 502);
    return iJson({ ...out.dto, canEdit: false });
  });
}
