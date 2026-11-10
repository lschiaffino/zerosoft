import { NextResponse } from 'next/server';
import { fakeMode } from '@/lib/groups-integrations';
import { editFakeCompany, fakeHubspot, mergeFakeCompanies } from '@/lib/groups-hubspot-fake';
import { groupsError, groupsSession, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const props = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k.slice(0, 120)] = x.slice(0, 2000);
  return out;
};

/**
 * Solo tests (GROUPS_INTEGRATIONS_FAKE con NODE_ENV=test o DEMO_MODE): mira y
 * cambia el HubSpot falso en memoria, como si alguien editara en HubSpot.
 * Fuera de eso es un 404. ?company=<id> devuelve sus propiedades.
 */
export async function GET(req: Request) {
  if (!fakeMode()) return groupsError(404, 'not_found');
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const o = fakeHubspot().companies.get(new URL(req.url).searchParams.get('company') ?? '');
  return o ? NextResponse.json({ id: o.id, properties: o.properties }) : groupsError(404, 'not_found');
}

/**
 * { company, properties } edita una empresa; { create: { id, properties } }
 * agrega una; { remove: id } la borra; { merge: { from, into } } la fusiona;
 * { rateLimit: n } hace que las próximas n llamadas respondan 429.
 */
export async function POST(req: Request) {
  if (!fakeMode()) return groupsError(404, 'not_found');
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const fake = fakeHubspot();
  try {
    const company = str(b.company, 30);
    if (company) editFakeCompany(company, props(b.properties));
    const create = (b.create ?? null) as { id?: unknown; properties?: unknown } | null;
    if (create && /^\d{1,20}$/.test(String(create.id))) {
      const id = String(create.id);
      const at = new Date().toISOString();
      fake.companies.set(id, { id, properties: { ...props(create.properties), hs_object_id: id, createdate: at, hs_lastmodifieddate: at } });
    }
    if (typeof b.remove === 'string') fake.companies.delete(b.remove);
    const merge = (b.merge ?? null) as { from?: unknown; into?: unknown } | null;
    if (merge) mergeFakeCompanies(String(merge.from), String(merge.into));
    if (typeof b.rateLimit === 'number') fake.rateLimit = Math.max(0, Math.min(50, Math.floor(b.rateLimit)));
  } catch {
    return groupsError(400, 'invalid_input');
  }
  return NextResponse.json({ ok: true });
}
