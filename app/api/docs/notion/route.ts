import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId, userCanUseApp } from '@/lib/session';
import { docsError, forbidden, invalidBody, unauthorized } from '@/lib/docs-http';
import { logDocsAudit, requestIp } from '@/lib/docs-audit';
import { rateLimit } from '@/lib/rate-limit';
import { isAdminEmail } from '@/lib/feedback';
import {
  clearWebhookToken,
  connectNotion,
  disconnectNotion,
  getNotionSyncStatus,
  NotionSyncError,
  updateNotionSync,
} from '@/lib/notion-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const connectSchema = z.object({ token: z.string().min(1).max(500) });
const patchSchema = z.object({
  direction: z.enum(['two_way', 'import', 'to_notion']).optional(),
  paused: z.boolean().optional(),
  teamspace_id: z.string().max(100).nullable().optional(),
  roots: z.array(z.object({ id: z.string().max(64), enabled: z.boolean() })).max(500).optional(),
  clear_webhook_token: z.literal(true).optional(),
});

/**
 * Docs › Ajustes › Integraciones › Notion: estado, conectar con un token de
 * integración interna, cambiar dirección, pausa y raíces, y desconectar.
 * Solo admins del workspace. El token nunca vuelve en la respuesta.
 */
async function admin() {
  const user = await getCurrentUser();
  if (!user) return { error: unauthorized() } as const;
  if (!userCanUseApp(user, 'docs') || !isWorkspaceAdmin(user)) return { error: forbidden() } as const;
  return { user } as const;
}

/** Estado; quien administra la instancia (ADMIN_EMAILS) ve además el token de verificación del webhook. */
function status(user: { id: string; email: string; actingUser?: { email: string } }) {
  return getNotionSyncStatus(user.id, { operator: isAdminEmail((user.actingUser ?? user).email) });
}

function fail(e: unknown): NextResponse {
  if (e instanceof NotionSyncError) return docsError(e.status, e.code);
  throw e;
}

export async function GET() {
  const a = await admin();
  if ('error' in a) return a.error;
  return NextResponse.json(await status(a.user));
}

export async function POST(req: NextRequest) {
  const a = await admin();
  if ('error' in a) return a.error;
  const limit = await rateLimit(`notion-connect:${a.user.id}`, 10, 600);
  if (!limit.ok) return docsError(429, 'rate_limited');
  const parsed = connectSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    await connectNotion(a.user.id, realUserId(a.user), { kind: 'token', token: parsed.data.token });
  } catch (e) {
    return fail(e);
  }
  await logDocsAudit({ workspaceId: a.user.id, actor: a.user.actingUser ?? a.user, action: 'settings.notion', detail: 'connected', ip: requestIp(req.headers) });
  return NextResponse.json(await status(a.user));
}

export async function PATCH(req: NextRequest) {
  const a = await admin();
  if ('error' in a) return a.error;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const { clear_webhook_token, ...patch } = parsed.data;
  if (clear_webhook_token) {
    if (!isAdminEmail((a.user.actingUser ?? a.user).email)) return forbidden();
    await clearWebhookToken();
  }
  try {
    if (Object.keys(patch).length) await updateNotionSync(a.user.id, patch);
  } catch (e) {
    return fail(e);
  }
  const detail = Object.entries(patch)
    .filter(([k]) => k !== 'roots')
    .map(([k, v]) => `${k}=${String(v)}`)
    .concat(patch.roots ? [`roots=${patch.roots.length}`] : [])
    .join(', ');
  if (detail) await logDocsAudit({ workspaceId: a.user.id, actor: a.user.actingUser ?? a.user, action: 'settings.notion', detail, ip: requestIp(req.headers) });
  return NextResponse.json(await status(a.user));
}

export async function DELETE(req: NextRequest) {
  const a = await admin();
  if ('error' in a) return a.error;
  await disconnectNotion(a.user.id);
  await logDocsAudit({ workspaceId: a.user.id, actor: a.user.actingUser ?? a.user, action: 'settings.notion', detail: 'disconnected', ip: requestIp(req.headers) });
  return NextResponse.json(await status(a.user));
}
