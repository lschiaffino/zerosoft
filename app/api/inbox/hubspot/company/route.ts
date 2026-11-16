import { iJson, withOwner } from '@/lib/inbox/http';
import { inboxHubspotScope } from '@/lib/inbox/contacts-http';
import { inboxThreadContact } from '@/lib/inbox/contacts';
import { companyById, type ChatCompanyDto } from '@/lib/groups-hubspot-sync';
import { limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * La empresa de HubSpot del contacto de un chat 1:1 de Inbox (la del contacto
 * vinculado a esa persona en el workspace activo), con todas sus propiedades,
 * para el panel de HubSpot. Solo lectura: las propiedades se editan desde
 * Lines. Un invitado no usa HubSpot.
 */
async function load(owner: string, threadId: string, refresh: 'missing' | 'stale' | 'force') {
  const scope = await inboxHubspotScope();
  if (!scope) return iJson({ error: 'forbidden' }, 403);
  const { row } = await inboxThreadContact(owner, scope, threadId.slice(0, 64));
  const companyId = row.hubspot?.company?.id ?? '';
  const dto: ChatCompanyDto = companyId
    ? await companyById(scope.ws, companyId, { refresh, mask: scope.mask })
    : { connected: Boolean(row.hubspot), company: null, values: {}, times: {}, syncedAt: null, refreshError: '', canWrite: false, log: [] };
  return { dto, res: null };
}

/** ?thread=<id>[&fresh=1]: sin `fresh` solo se lee de HubSpot si la empresa nunca se leyó (la tarjeta del chat); con `fresh`, si la copia tiene más de un minuto (el panel). */
export async function GET(req: Request) {
  return withOwner(async (owner) => {
    const sp = new URL(req.url).searchParams;
    const out = await load(owner, sp.get('thread') ?? '', sp.get('fresh') === '1' ? 'stale' : 'missing');
    if (!('dto' in out)) return out;
    return iJson({ ...out.dto, canEdit: false });
  });
}

/** { threadId }: "Sincronizar ahora". */
export async function POST(req: Request) {
  return withOwner(async (owner) => {
    const limited = await limitWrites('inbox', owner);
    if (limited) return limited;
    const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const out = await load(owner, typeof b.threadId === 'string' ? b.threadId : '', 'force');
    if (!('dto' in out)) return out;
    if (out.dto.refreshError) return iJson({ error: out.dto.refreshError }, out.dto.refreshError === 'hubspot_rate_limited' ? 429 : 502);
    return iJson({ ...out.dto, canEdit: false });
  });
}
