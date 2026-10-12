import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { createApiKey, listApiKeys } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({ name: z.string().min(1).max(80) });

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
  const { id, key } = await createApiKey(user.id, parsed.data.name.trim(), realUserId(user));
  return NextResponse.json({ id, key }, { status: 201 });
}
