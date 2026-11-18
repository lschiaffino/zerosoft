import { handleInboxWebhook } from '@/lib/inbox/webhook-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; secret: string }> };

/**
 * Ruta vieja, con el secreto en la URL (queda en los logs de requests). Se
 * acepta mientras haya instancias registradas con ella; las nuevas usan
 * /api/inbox/webhook/{id} con el header (lib/wa-webhook-secret.ts).
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id, secret } = await ctx.params;
  return handleInboxWebhook(req, id, secret);
}
