import { handleGroupsWebhook } from '@/lib/groups-webhook-handler';
import { webhookSecretFromHeaders } from '@/lib/wa-webhook-secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Eventos del proveedor de un número de Lines, con el secreto en el header x-zerosoft-webhook-secret. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return handleGroupsWebhook(req, id, webhookSecretFromHeaders(req.headers));
}
