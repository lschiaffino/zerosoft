import { pjson, withPeople } from '@/lib/people-http';
import { listChangeRequests } from '@/lib/people-extras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: pedidos de cambio de datos pendientes (HR). */
export async function GET() {
  return withPeople(async (ctx) => pjson({ requests: await listChangeRequests(ctx) }));
}
