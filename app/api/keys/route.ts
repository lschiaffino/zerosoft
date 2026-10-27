import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { createApiKey, listApiKeys } from '@/lib/api-auth';
import { API_SCOPES } from '@/lib/api-scopes';
import { logCalActivity } from '@/lib/calendar-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(80),
  /** Sin scopes = todos (compatibilidad con clientes anteriores). */
  scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length).optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // Admins ven todas las keys del workspace; un member solo las suyas.
  const onlyMine = isWorkspaceAdmin(user) ? undefined : realUserId(user);
  return NextResponse.json({ keys: await listApiKeys(user.id, onlyMine) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // The full key is returned only in this response; we store its sha256.
  const { id, key, scopes } = await createApiKey(
    user.id,
    parsed.data.name.trim(),
    realUserId(user),
    parsed.data.scopes ?? '*',
  );
  // Keys que pueden usar Cal (API v1 y servidor MCP): quedan en su registro de actividad.
  const calScopes = parsed.data.scopes === undefined || parsed.data.scopes.some((s) => s.startsWith('cal:'));
  if (calScopes) await logCalActivity(user.id, realUserId(user), 'api.key_created', { type: 'api_key', id, summary: parsed.data.name.trim() });
  return NextResponse.json({ id, key, scopes }, { status: 201 });
}
