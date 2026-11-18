import { handleGroupsWebhook, handleGroupsWebhookVerify } from '@/lib/groups-webhook-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; secret: string }> };

/**
 * Ruta con el secreto en la URL. La usa la Cloud API de Meta (no deja mandar
 * headers propios; además firma cada evento) y la siguen usando las instancias
 * registradas antes del header (lib/wa-webhook-secret.ts).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id, secret } = await ctx.params;
  return handleGroupsWebhookVerify(req, id, secret);
}

export async function POST(req: Request, ctx: Ctx) {
  const { id, secret } = await ctx.params;
  return handleGroupsWebhook(req, id, secret);
}
